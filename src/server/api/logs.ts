import { Hono } from 'hono'
import { clearServerLogs, listServerLogs } from '../store/logs'

const app = new Hono<{ Bindings: Env }>()

app.get('/api/logs', async (c) =>
  c.json({ logs: await listServerLogs(c.env.SUKI_SUB_DB) }),
)

app.delete('/api/logs', async (c) => {
  await clearServerLogs(c.env.SUKI_SUB_DB)
  return c.json({ cleared: true })
})

export default app
