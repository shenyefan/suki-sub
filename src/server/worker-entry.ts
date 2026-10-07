import { Context } from 'hono'
import { errorResponse } from './api/http'
import {
  createStartHandler,
  defaultStreamHandler,
} from '@tanstack/react-start/server'
import apiApp from './app'
import { runScheduledJobs } from './jobs/scheduler'
import { notifyServerEvents } from './notifications/telegram'
import { withServerLogs } from './store/logs'

/** TanStack Start 的页面/SSR 请求处理(前端路由、静态资源、server functions) */
const tanstackFetch = createStartHandler(defaultStreamHandler)

/** 后端 API 的路径前缀;其余请求全部交给 TanStack */
const API_PREFIXES = ['/api/', '/auth/', '/s/']

const isApiPath = (pathname: string) =>
  API_PREFIXES.some(
    (p) => pathname === p.slice(0, -1) || pathname.startsWith(p),
  )

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const { pathname } = new URL(request.url)
    if (isApiPath(pathname)) {
      return apiApp.fetch(request, env, ctx)
    }
    return withServerLogs(env.SUKI_SUB_DB, async () => {
      try {
        return await tanstackFetch(request, { context: { nonce: undefined } })
      } catch (error) {
        return errorResponse(new Context(request), error)
      }
    })
  },

  async scheduled(
    controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    ctx.waitUntil(
      withServerLogs(
        env.SUKI_SUB_DB,
        () => runScheduledJobs(controller, env),
        () => ({ userName: '定时任务' }),
        (entries) => notifyServerEvents(env, entries),
      ),
    )
  },
} satisfies ExportedHandler<Env>
