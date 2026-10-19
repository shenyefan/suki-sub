import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { clearServerLogs, listServerLogs } from '../store/logs'

const app = new Hono<{ Bindings: Env }>()

app.get('/api/logs', async (c) => {
  const cursor = c.req.query('cursor')
  if (cursor) {
    try {
      const value = JSON.parse(cursor)
      if (
        typeof value.time !== 'string' ||
        !Number.isFinite(Date.parse(value.time)) ||
        !Number.isSafeInteger(value.id) ||
        value.id <= 0
      )
        throw new Error()
    } catch {
      throw new HTTPException(400, { message: '日志分页参数无效' })
    }
  }
  return c.json(
    await listServerLogs(c.env.SUKI_SUB_DB, {
      cursor,
      action: c.req.query('action') ?? 'all',
      userId: c.req.query('userId') ?? '',
      requestId: c.req.query('requestId') ?? '',
      outcome: c.req.query('outcome') ?? 'all',
    }),
  )
})

app.delete('/api/logs', async (c) => {
  await clearServerLogs(c.env.SUKI_SUB_DB)
  return c.json({ cleared: true })
})

export default app
