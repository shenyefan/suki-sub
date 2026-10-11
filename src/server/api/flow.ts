/**
 * 流量信息与 age 密钥工具。
 */
import { Hono } from 'hono'
import { isLinkFlagEnabled, parseResourceLink } from '#/shared/resource-link'
import { errorResponse } from './http'
import { withApiStore } from '../store/bootstrap'
import { getSubscription, getCollection } from '../store/d1'
import { collectionFlow } from './download-flow'
import { getFlowHeaders, parseFlowHeaders } from '../core/utils/flow'
import {
  AGE_PUBLIC_KEY,
  AGE_SECRET_KEY,
  derivePublicKey,
  generateKeyPair,
} from '../core/utils/age'
import { RequestInvalidError, ResourceNotFoundError } from '../core/errors'

const app = new Hono<{ Bindings: Env }>()

/** 订阅流量信息 */
app.get('/api/subs/:name/flow', async (c) =>
  withApiStore(c.env, async () => {
    try {
      const name = c.req.param('name')
      const urlArg = c.req.query('url')
      const sub = await getSubscription(c.env.SUKI_SUB_DB, name)
      if (!sub)
        throw new ResourceNotFoundError(
          'RESOURCE_NOT_FOUND',
          `Subscription ${name} does not exist!`,
        )
      const noCache =
        isLinkFlagEnabled(c.req.query('noCache')) || sub.noCache === true
      if (isLinkFlagEnabled(c.req.query('noFlow')) || sub.noFlow) {
        throw new RequestInvalidError(
          'NO_FLOW_INFO',
          `Subscription ${name}: noFlow`,
        )
      }
      if (
        sub.source === 'local' &&
        !['localFirst', 'remoteFirst'].includes(sub.mergeSources ?? '')
      ) {
        if (!sub.subUserinfo)
          throw new RequestInvalidError(
            'NO_FLOW_INFO',
            `Local subscription ${name} has no flow information!`,
          )
        let subUserInfo: string | undefined
        if (/^https?:\/\//.test(sub.subUserinfo)) {
          subUserInfo = await getFlowHeaders(
            sub.subUserinfo,
            undefined,
            undefined,
            sub.subUserinfo,
            undefined,
            noCache,
          )
        } else {
          subUserInfo = sub.subUserinfo
        }
        return c.json(parseFlowHeaders(subUserInfo))
      }
      const firstUrl =
        (urlArg || sub.url || '')
          .split(/[\r\n]+/)
          .map((i) => i.trim())
          .filter((i) => i.length)[0] ?? ''
      if (!/^https?/.test(firstUrl))
        throw new RequestInvalidError(
          'NO_FLOW_INFO',
          `Subscription ${name}: noFlow`,
        )
      const flowArgs = parseResourceLink(firstUrl).arguments
      let flowHeaders: string | undefined
      try {
        flowHeaders = await getFlowHeaders(
          firstUrl,
          flowArgs.flowUserAgent || sub.ua,
          undefined,
          flowArgs.flowUrl,
          flowArgs.flowHeaders,
          noCache,
        )
      } catch (err) {
        // 订阅地址不可达时回落到 subUserinfo
        flowHeaders = undefined
        if (!sub.subUserinfo) throw err
      }
      if (!flowHeaders && !sub.subUserinfo)
        throw new RequestInvalidError(
          'NO_FLOW_INFO',
          'Failed to fetch flow headers',
        )
      let subUserInfo: string | undefined
      if (sub.subUserinfo && /^https?:\/\//.test(sub.subUserinfo)) {
        subUserInfo = await getFlowHeaders(
          sub.subUserinfo,
          undefined,
          undefined,
          sub.subUserinfo,
          undefined,
          noCache,
        )
      } else if (sub.subUserinfo) {
        subUserInfo = sub.subUserinfo
      }
      const result = parseFlowHeaders(
        [subUserInfo, flowHeaders].filter((i) => i).join('; '),
      )
      return c.json(result)
    } catch (err) {
      return errorResponse(c, err)
    }
  }),
)

/** 组合卡片与分享下载共用流量来源及汇总规则。 */
app.get('/api/collections/:name/flow', async (c) =>
  withApiStore(c.env, async () => {
    try {
      const collection = await getCollection(
        c.env.SUKI_SUB_DB,
        c.req.param('name'),
      )
      if (!collection)
        throw new ResourceNotFoundError(
          'COLLECTION_NOT_FOUND',
          '组合订阅不存在',
        )
      if (isLinkFlagEnabled(c.req.query('noFlow')) || collection.noFlow)
        throw new RequestInvalidError('NO_FLOW_INFO', '组合订阅已关闭流量信息')
      const value = await collectionFlow(
        collection,
        (name) => getSubscription(c.env.SUKI_SUB_DB, name),
        isLinkFlagEnabled(c.req.query('noCache')),
      )
      if (!value)
        throw new RequestInvalidError(
          'NO_FLOW_INFO',
          '所选来源没有完整的流量信息',
        )
      return c.json(parseFlowHeaders(value))
    } catch (error) {
      return errorResponse(c, error)
    }
  }),
)

/** age 密钥对生成 */
app.post('/api/age/keys', async (c) => {
  try {
    const keys = await generateKeyPair()
    // 前端契约是 camelCase;age.ts 内部常量是 kebab-case,这里做一次映射。
    return c.json({
      publicKey: keys[AGE_PUBLIC_KEY],
      secretKey: keys[AGE_SECRET_KEY],
    })
  } catch (err) {
    return errorResponse(c, err)
  }
})

/** age 公钥推导 */
app.post('/api/age/public-key', async (c) => {
  try {
    const { secretKey } = await c.req.json()
    if (!secretKey)
      throw new RequestInvalidError('INVALID_BODY', 'secretKey is required')
    return c.json(await derivePublicKey(secretKey))
  } catch (err) {
    return errorResponse(c, err)
  }
})

export default app
