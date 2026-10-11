/**
 * 订阅分享管理 —— /s/:id 的访问凭据(D1 存储)。
 * 语义参考官方 restful/token.js(绑定 type/name、时长/次数过期),存储使用 D1。
 */
import { Hono } from 'hono'
import { nanoid } from 'nanoid'
import type { TokenItem } from '#/shared/types'
import { errorResponse, failureResponse } from './http'
import { deleteToken, getToken, listTokens, saveToken } from '../store/tokens'
import { ensureSchema, getSubscription, getCollection } from '../store/d1'
import { setResourceContext } from '../store/resource-context'
import { RequestInvalidError } from '../core/errors'

const app = new Hono<{ Bindings: Env }>()

app.post('/api/shares', async (c) => {
  try {
    const body = await c.req.json()
    const type = body.type
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!['sub', 'collection'].includes(type)) {
      throw new RequestInvalidError('INVALID_TYPE', '请选择单条订阅或组合订阅')
    }
    if (!name || name === '*')
      throw new RequestInvalidError('INVALID_RESOURCE', '请选择要分享的订阅')
    await ensureSchema(c.env.SUKI_SUB_DB)
    const resource =
      type === 'sub'
        ? await getSubscription(c.env.SUKI_SUB_DB, name)
        : await getCollection(c.env.SUKI_SUB_DB, name)
    if (!resource)
      throw new RequestInvalidError('INVALID_RESOURCE', '订阅不存在')
    setResourceContext(c, type, resource)
    if (
      body.endAt != null &&
      (typeof body.endAt !== 'number' ||
        !Number.isFinite(body.endAt) ||
        body.endAt <= Date.now())
    )
      throw new RequestInvalidError('INVALID_EXPIRY', '有效期必须晚于当前时间')
    if (
      body.count != null &&
      (!Number.isSafeInteger(body.count) || body.count <= 0)
    )
      throw new RequestInvalidError('INVALID_COUNT', '可用次数必须为正整数')
    const duration = typeof body.endAt === 'number' ? body.endAt : undefined
    const token: TokenItem = {
      id: nanoid(21),
      type,
      name,
      createdAt: Date.now(),
      ...(duration != null ? { endAt: duration } : {}),
      ...(typeof body.count === 'number'
        ? { count: body.count, usedCount: 0 }
        : {}),
    }
    await saveToken(c.env, token)
    return c.json(token, 201)
  } catch (err) {
    return errorResponse(c, err)
  }
})

app.get('/api/shares', async (c) => {
  try {
    return c.json(await listTokens(c.env))
  } catch (err) {
    return errorResponse(c, err)
  }
})

app.get('/api/shares/:id', async (c) => {
  try {
    const token = await getToken(c.env, c.req.param('id'))
    if (!token) return failureResponse(c, 'SHARE_NOT_FOUND', '分享不存在', 404)
    return c.json(token)
  } catch (err) {
    return errorResponse(c, err)
  }
})

app.delete('/api/shares/:id', async (c) => {
  try {
    const token = await getToken(c.env, c.req.param('id'))
    if (token?.name) {
      const resource =
        token.type === 'sub'
          ? await getSubscription(c.env.SUKI_SUB_DB, token.name)
          : await getCollection(c.env.SUKI_SUB_DB, token.name)
      if (resource) setResourceContext(c, token.type, resource)
    }
    await deleteToken(c.env, c.req.param('id'))
    return c.json({ deleted: true, name: token?.name, type: token?.type })
  } catch (err) {
    return errorResponse(c, err)
  }
})

export default app
