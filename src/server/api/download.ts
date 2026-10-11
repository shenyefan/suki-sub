import { setResourceContext } from '../store/resource-context'
/**
 * 订阅下载:平台解析(query target/platform → UA 嗅探 → JSON)、流量头透传、
 * response-transformer 与 age 输出加密后处理，分享标识绑定具体订阅。
 */
import { Hono } from 'hono'
import $ from '../core/app'
import type { Context } from 'hono'
import { errorResponse, failureResponse } from './http'
import { withApiStore } from '../store/bootstrap'
import { getToken, consumeToken } from '../store/tokens'
import { produceArtifact } from '../core/produce-artifact'
import { applyResponseTransformers } from '../core/response-transformer'
import { applyAgeOutputEncryption } from '../core/age-output'
import { getFlowHeaders, normalizeFlowHeader } from '../core/utils/flow'
import { getCollection, getSubscription } from '../store/d1'

const app = new Hono<{ Bindings: Env }>()

/** express 形态 res 适配器(Headers + 状态码),供 response-transformer / age-output 使用 */
function createResAdapter() {
  const headers = new Headers()
  const adapter = {
    headers,
    statusCode: 200 as number,
    set(key: string, value: string) {
      headers.set(key, value)
    },
    removeHeader(key: string) {
      headers.delete(key)
    },
    getHeaders(): Record<string, string> {
      return Object.fromEntries(headers.entries())
    },
    status(code: number) {
      adapter.statusCode = code
      return adapter
    },
  }
  return adapter
}

const UA_PLATFORMS: [RegExp, string][] = [
  [/clash(?:\.meta| veronica)?/i, 'clashmeta'],
  [/clash/i, 'clash'],
  [/stash/i, 'stash'],
  [/surge\/\d+(\.\d+)* mac/i, 'surgemac'],
  [/surge/i, 'surge'],
  [/surfboard/i, 'surfboard'],
  [/loon/i, 'loon'],
  [/shadowrocket/i, 'shadowrocket'],
  [/quantumult%20x|quantumult-x|qx/i, 'qx'],
  [/sing-box|singbox/i, 'sing-box'],
  [/egern/i, 'egern'],
  [/v2ray\/?\d*/i, 'v2ray'],
]

function detectPlatform(ua: string | undefined): string | undefined {
  if (!ua) return undefined
  for (const [re, platform] of UA_PLATFORMS) {
    if (re.test(ua)) return platform
  }
  return undefined
}

function resolvePlatform(c: {
  req: {
    param: (k: string) => string | undefined
    query: (k: string) => string | undefined
    header: (k: string) => string | undefined
  }
}): string {
  // 分享链接的目标平台优先，其次 query，再按客户端自动识别
  const pathTarget = c.req.param('target')
  if (pathTarget) return pathTarget
  return (
    c.req.query('target') ||
    c.req.query('platform') ||
    detectPlatform(c.req.header('user-agent')) ||
    'JSON'
  )
}

function downloadHandler(kind: 'subscription' | 'collection', name: string) {
  return (c: Context<{ Bindings: Env }>) =>
    withApiStore(c.env, async () => {
      try {
        const platform = resolvePlatform(c)
        const opt: Record<string, unknown> = {
          type: kind,
          name,
          platform,
          ua: c.req.header('user-agent'),
          noFlow:
            c.req.query('noFlow') === 'true' || c.req.query('noFlow') === '1',
        }
        const sub =
          kind === 'subscription'
            ? await getSubscription(c.env.SUKI_SUB_DB, name)
            : null
        const resource =
          kind === 'subscription'
            ? sub
            : await getCollection(c.env.SUKI_SUB_DB, name)
        if (resource)
          setResourceContext(
            c,
            kind === 'subscription' ? 'sub' : 'collection',
            resource,
          )
        c.set(
          'operationDetails' as never,
          {
            resourceKind: kind === 'subscription' ? 'sub' : 'collection',
            resourceName: name,
            resourceDisplayName: resource?.displayName?.trim() || name,
            platform,
          } as never,
        )
        const output = await produceArtifact(opt)

        const res = createResAdapter()
        // 流量信息头
        if (sub && !opt.noFlow) {
          try {
            const flowInfo =
              sub.source !== 'local' && sub.url?.trim()
                ? await getFlowHeaders(
                    sub.url,
                    sub.ua ?? undefined,
                    undefined,
                    undefined,
                    undefined,
                  )
                : undefined
            if (sub.subUserinfo || flowInfo) {
              const normalized = normalizeFlowHeader(
                [sub.subUserinfo, flowInfo].filter((i) => i).join(';'),
                true,
              ) as Record<string, string>
              if (normalized['subscription-userinfo'])
                res.set(
                  'subscription-userinfo',
                  normalized['subscription-userinfo'],
                )
              if (normalized['profile-web-page-url'])
                res.set(
                  'profile-web-page-url',
                  normalized['profile-web-page-url'],
                )
              if (normalized['plan-name'])
                res.set('plan-name', normalized['plan-name'])
            }
          } catch (err) {
            $.warn(
              '流量信息暂不可用',
              err instanceof Error ? err.message : String(err),
            )
          }
        }

        res.set(
          'content-type',
          platform === 'JSON'
            ? 'application/json;charset=utf-8'
            : 'text/plain; charset=utf-8',
        )

        // response-transformer 与 age 输出加密(脚本型 transformer 走沙箱,引擎内部处理)
        const body = await applyResponseTransformers({
          res,
          body: output,
          process: resource?.process,
          targetPlatform: platform,
          source: resource ? { [name]: resource } : {},
        })
        const finalBody = await applyAgeOutputEncryption({
          res,
          body,
          configs: [resource ?? {}],
        })

        return new Response(finalBody as BodyInit, {
          status: res.statusCode,
          headers: res.headers,
        })
      } catch (err) {
        return errorResponse(c, err)
      }
    })
}

async function shareHandler(c: Context<{ Bindings: Env }>) {
  const id = c.req.param('id') ?? ''
  const share = await getToken(c.env, id)
  if (
    !share ||
    !(await consumeToken(c.env, id, {
      type: share.type,
      name: share.name,
    }))
  ) {
    return failureResponse(c, 'INVALID_SHARE', '分享链接无效或已过期', 401)
  }
  return downloadHandler(
    share.type === 'sub' ? 'subscription' : 'collection',
    share.name,
  )(c)
}

app.get('/s/:id', shareHandler)
app.get('/s/:id/:target', shareHandler)

export default app
