import { setResourceContext } from '../store/resource-context'
/**
 * 订阅下载:平台解析(路径 → query platform/target → UA 与 Accept)、流量头透传、
 * response-transformer 与 age 输出加密后处理，分享标识绑定具体订阅。
 */
import { Hono } from 'hono'
import type { Context } from 'hono'
import { errorResponse, failureResponse } from './http'
import { withApiStore } from '../store/bootstrap'
import { getToken, consumeToken } from '../store/tokens'
import { produceArtifact } from '../core/produce-artifact'
import { applyResponseTransformers } from '../core/response-transformer'
import {
  applyAgeOutputEncryption,
  createAgePublicKeyConfig,
  resolveAgePublicKey,
  SHARE_AGE_PUBLIC_KEY_HEADER,
} from '../core/age-output'
import { downloadMetadata } from './download-metadata'
import { downloadOptions, scriptOptions } from './download-options'
import {
  subscriptionFlow,
  collectionFlow,
  flowResponseHeaders,
} from './download-flow'
import type { TokenItem } from '#/shared/types'
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
      if (Number.isInteger(code) && code >= 200 && code <= 599)
        adapter.statusCode = code
      return adapter
    },
  }
  return adapter
}

function downloadHandler(
  kind: 'subscription' | 'collection',
  name: string,
  share: TokenItem,
) {
  return (c: Context<{ Bindings: Env }>) =>
    withApiStore(c.env, async () => {
      try {
        const options = downloadOptions(
          c.req.query(),
          c.req.param('target'),
          c.req.header('user-agent') || '',
          c.req.header('accept'),
        )
        const { platform } = options
        const $options = scriptOptions(c.req.query('$options'), {
          method: c.req.method,
          url: c.req.url,
          path: c.req.path,
          query: c.req.query(),
          params: c.req.param(),
          headers: Object.fromEntries(c.req.raw.headers.entries()),
        })
        const opt = { ...options, type: kind, name, $options }
        const sub =
          kind === 'subscription'
            ? await getSubscription(c.env.SUKI_SUB_DB, name)
            : null
        const collection =
          kind === 'collection'
            ? await getCollection(c.env.SUKI_SUB_DB, name)
            : null
        const resource = sub || collection
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
        const noFlow = options.noFlow || resource?.noFlow === true
        if (!noFlow) {
          const flowInfo = sub
            ? await subscriptionFlow(sub, options.noCache)
            : collection
              ? await collectionFlow(
                  collection,
                  collection.subscriptions[0]
                    ? await getSubscription(
                        c.env.SUKI_SUB_DB,
                        collection.subscriptions[0],
                      )
                    : null,
                  options.noCache,
                )
              : undefined
          for (const [key, value] of Object.entries(
            flowResponseHeaders(flowInfo),
          )) {
            if (value) res.set(key, value)
          }
        }
        const encryptionConfigs = [
          createAgePublicKeyConfig(
            share['age-public-key'] ||
              share.agePublicKey ||
              c.req.header(SHARE_AGE_PUBLIC_KEY_HEADER),
          ),
          resource || {},
        ]
        for (const [key, value] of Object.entries(
          downloadMetadata(
            resource?.displayName?.trim() || name,
            platform,
            options.produceType,
            !!resolveAgePublicKey(...encryptionConfigs),
          ),
        ))
          res.set(key, value)
        const customResponse = $options._res as
          { headers?: Record<string, unknown>; status?: unknown } | undefined
        if (customResponse?.headers) {
          for (const [key, value] of Object.entries(customResponse.headers)) {
            if (value == null) res.removeHeader(key)
            else res.set(key, String(value))
          }
        }
        const status = Number(customResponse?.status)
        if (Number.isInteger(status) && status >= 200 && status <= 599)
          res.status(status)

        // response-transformer 与 age 输出加密(脚本型 transformer 走沙箱,引擎内部处理)
        const body = await applyResponseTransformers({
          res,
          body: typeof output === 'string' ? output : JSON.stringify(output),
          process: resource?.process,
          targetPlatform: platform,
          source: resource ? { [name]: resource } : {},
          $options,
          executionContext: { noFlow },
        })
        const finalBody = await applyAgeOutputEncryption({
          res,
          body,
          configs: encryptionConfigs,
        })

        return new Response(
          [204, 205, 304].includes(res.statusCode)
            ? null
            : typeof finalBody === 'string' || finalBody == null
              ? finalBody
              : JSON.stringify(finalBody),
          {
            status: res.statusCode,
            headers: res.headers,
          },
        )
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
    share,
  )(c)
}

app.get('/s/:id', shareHandler)
app.get('/s/:id/:target', shareHandler)

export default app
