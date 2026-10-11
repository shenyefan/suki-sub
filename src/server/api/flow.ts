/**
 * 流量信息与 age 密钥工具。
 */
import { Hono } from 'hono'
import { errorResponse } from './http'
import { withApiStore } from '../store/bootstrap'
import { getSubscription } from '../store/d1'
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
      const noCache = c.req.query('noCache') === 'true'
      const sub = await getSubscription(c.env.SUKI_SUB_DB, name)
      if (!sub)
        throw new ResourceNotFoundError(
          'RESOURCE_NOT_FOUND',
          `Subscription ${name} does not exist!`,
        )
      if (c.req.query('noFlow') === 'true' || sub.noFlow) {
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
            undefined,
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
      let flowHeaders: string | undefined
      try {
        flowHeaders = await getFlowHeaders(
          firstUrl,
          sub.ua ?? undefined,
          undefined,
          undefined,
          undefined,
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
          undefined,
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
