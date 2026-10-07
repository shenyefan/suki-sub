import type { Context } from 'hono'
import { ApiRoutes } from '#/shared/api-contract'
import {
  discardRequestLogs,
  hasRecordedFailure,
  writeServerEvent,
} from './logs'

interface Operation {
  action: string
  label: string
  resourceKind?: string
  resourceName?: string
  failuresOnly?: boolean
}

/** 显式记录业务操作，避免 GET、轮询和引擎内部步骤刷屏。 */
export function logOperation(method: string, path: string): Operation | null {
  const parts = path.split('/').filter(Boolean)
  if (parts[0] === 's')
    return {
      action: 'subscription.download',
      label: '拉取订阅',
    }
  if (path === '/auth/callback')
    return { action: 'session.login', label: '登录' }
  if (path === '/auth/logout')
    return { action: 'session.logout', label: '退出登录' }
  if (path === ApiRoutes.backupSync && method === 'POST')
    return { action: 'backup.manual', label: '手动备份' }
  if (path === '/api/backup' && ['GET', 'POST'].includes(method))
    return {
      action: method === 'GET' ? 'backup.export' : 'backup.restore',
      label: method === 'GET' ? '导出备份' : '恢复备份',
    }
  if (path === '/api/settings' && method === 'PATCH')
    return { action: 'settings.update', label: '保存设置' }
  if (parts[1] === 'preview' && method === 'POST')
    return {
      action: 'subscription.preview',
      label: '预览订阅',
      resourceKind: parts[2],
      failuresOnly: true,
    }
  const resources: Record<string, { kind: string; label: string }> = {
    subs: { kind: 'sub', label: '订阅' },
    collections: { kind: 'collection', label: '组合订阅' },
    modules: { kind: 'module', label: '脚本模块' },
    shares: { kind: 'share', label: '分享' },
  }
  const resource = parts[0] === 'api' ? resources[parts[1]] : undefined
  if (!resource || !['POST', 'PUT', 'PATCH', 'DELETE'].includes(method))
    return null
  const verb =
    parts[2] === 'order'
      ? '调整排序'
      : parts[3] === 'clone'
        ? '克隆'
        : method === 'POST'
          ? '创建'
          : method === 'PUT'
            ? '导入'
            : method === 'DELETE'
              ? '删除'
              : '保存'
  return {
    action: `${resource.kind}.${({ 调整排序: 'reorder', 克隆: 'clone', 创建: 'create', 导入: 'import', 删除: 'delete', 保存: 'update' } as Record<string, string>)[verb]}`,
    label: `${verb}${resource.label}`,
    resourceKind: resource.kind,
    ...(parts[2] && parts[2] !== 'order' && resource.kind !== 'share'
      ? { resourceName: decodeURIComponent(parts[2]) }
      : {}),
  }
}

export async function recordOperation(
  c: Context,
  startedAt: number,
): Promise<void> {
  const operation = logOperation(c.req.method, c.req.path)
  if (!operation) return
  const failed = c.res.status >= 400
  if (!failed && operation.action === 'subscription.preview') {
    discardRequestLogs()
    return
  }
  if (
    !failed &&
    (operation.action.endsWith('.reorder') ||
      c.get('operationUnchanged' as never))
  )
    return
  if ((!failed && operation.failuresOnly) || (failed && hasRecordedFailure()))
    return
  const details: Record<string, unknown> = {
    action: operation.action,
    resourceKind: operation.resourceKind,
    resourceName: operation.resourceName,
    ...(c.get('operationDetails' as never) as
      Record<string, unknown> | undefined),
    durationMs: Date.now() - startedAt,
    httpStatus: c.res.status,
  }
  if (operation.action === 'subscription.preview') {
    try {
      const request: { draft?: { name?: string; displayName?: string } } =
        await c.req.json()
      if (request.draft?.name) details.resourceName = request.draft.name
      if (request.draft?.displayName?.trim())
        details.resourceDisplayName = request.draft.displayName.trim()
    } catch {
      /* 不记录请求正文。 */
    }
  }
  // 只选取操作上下文；从不存储配置内容、分享 ID 或凭据。
  if (c.res.headers.get('content-type')?.includes('application/json')) {
    try {
      const result: Record<string, unknown> = await c.res.clone().json()
      if (failed) {
        for (const key of [
          'code',
          'message',
          'url',
          'reason',
          'status',
          'subscription',
          'collection',
          'field',
          'operatorName',
          'operatorIndex',
          'sourceLine',
          'configLine',
          'scriptLine',
          'scriptColumn',
          'issues',
          'failures',
        ])
          if (result[key] != null)
            details[key === 'message' ? 'reason' : key] = result[key]
      } else {
        if (Array.isArray(result.after)) details.nodeCount = result.after.length
        for (const key of [
          'name',
          'displayName',
          'type',
          'replaced',
          'endAt',
          'count',
          'order',
        ])
          if (result[key] != null)
            details[
              key === 'name'
                ? 'resourceName'
                : key === 'displayName'
                  ? 'resourceDisplayName'
                  : key
            ] = result[key]
      }
    } catch {
      /* 操作已完成，不让日志影响响应。 */
    }
  }
  writeServerEvent(
    failed ? 'warn' : 'info',
    `${operation.label}${failed ? '失败' : '成功'}`,
    details,
  )
}
