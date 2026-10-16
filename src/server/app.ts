/**
 * 后端 Hono 应用。
 * 由 src/server/worker-entry.ts 分发:/api、/s 前缀进来。
 *
 * 鉴权:
 * - /api/*:OIDC Bearer JWT(OIDC_ISSUER / OIDC_AUDIENCE 环境变量)
 * - /s/:id：仅访问绑定订阅的分享链接
 */
import { Hono } from 'hono'
import { getResourceContext } from './store/resource-context'
import { notifyServerEvents } from './notifications/telegram'
import { recordOperation } from './store/operation-logs'
import { withServerLogs } from './store/logs'
import { requestAuditDetails } from './store/request-audit'
import { errorResponse, failureResponse } from './api/http'
import loginApp, { oidcMiddleware } from './auth/login'
import subscriptionsApp from './api/subscriptions'
import collectionsApp from './api/collections'
import modulesApp from './api/modules'
import settingsApp from './api/settings'
import sharesApp from './api/shares'
import miscsApp from './api/miscs'
import previewApp from './api/preview'
import flowApp from './api/flow'
import logsApp from './api/logs'
import downloadApp from './api/download'

const app = new Hono<{ Bindings: Env }>()
app.use('*', (c, next) => {
  if (c.req.path.startsWith('/api/')) c.header('Cache-Control', 'no-store')
  const startedAt = Date.now()
  const requestId = crypto.randomUUID()
  c.set('auditRequestId' as never, requestId as never)
  c.header('X-Request-ID', requestId)
  return withServerLogs(
    c.env.SUKI_SUB_DB,
    async () => {
      await next()
      try {
        await recordOperation(c, startedAt)
      } catch {
        /* 记录失败不影响操作结果。 */
      }
    },
    () => requestAuditDetails(c, startedAt),
    async (entries) => {
      const metadata = requestAuditDetails(c, startedAt)
      const task = withServerLogs(
        c.env.SUKI_SUB_DB,
        () =>
          notifyServerEvents(c.env, entries, getResourceContext(c)?.resource, {
            path: c.req.path,
            method: c.req.method,
            status: c.res.status,
          }),
        () => metadata,
      )
      try {
        c.executionCtx.waitUntil(task)
      } catch {
        await task
      }
    },
  )
})

// --- 公开端点(浏览器 OIDC 登录流) ---
app.route('/', loginApp)

// --- 公开端点(订阅分享) ---

// 分享只访问其绑定的订阅或组合订阅
app.route('/', downloadApp)

// --- 管理端点(OIDC) ---

const api = new Hono<{ Bindings: Env }>()
api.use('*', oidcMiddleware())
api.route('/', subscriptionsApp)
api.route('/', collectionsApp)
api.route('/', modulesApp)
api.route('/', settingsApp)
api.route('/', sharesApp)
api.route('/', miscsApp)
api.route('/', previewApp)
api.route('/', flowApp)
api.route('/', logsApp)

app.route('/', api)

app.notFound((c) => failureResponse(c, 'NOT_FOUND', '请求的资源不存在', 404))

app.onError((err, c) => errorResponse(c, err))

export default app
