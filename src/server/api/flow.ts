/**
 * 流量信息与 age 密钥工具。
 */
import { Hono } from 'hono'
import { isLinkFlagEnabled } from '#/shared/resource-link'
import { errorResponse } from './http'
import { withApiStore } from '../store/bootstrap'
import { getSubscription, getCollection } from '../store/d1'
import { collectionFlow, subscriptionFlow } from './download-flow'
import { parseFlowHeaders } from '../core/utils/flow'
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
      const value = await subscriptionFlow(
        urlArg ? { ...sub, url: urlArg } : sub,
        noCache,
      )
      if (!value)
        throw new RequestInvalidError('NO_FLOW_INFO', '所选来源没有流量信息')
      const result = parseFlowHeaders(value)
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
