export interface LogEntry {
  id: number
  time: string
  level: string
  message: string
  details?: Record<string, unknown>
}

export interface LogFilters {
  action: string
  userId: string
  requestId: string
  outcome: string
}

export function logOutcome(entry: Pick<LogEntry, 'level' | 'details'>): string {
  if (entry.level === 'error' || Number(entry.details?.httpStatus) >= 400)
    return 'failure'
  return entry.level === 'warn' ? 'warning' : 'success'
}

export function filterLogs(
  entries: LogEntry[],
  filters: LogFilters,
): LogEntry[] {
  return entries.filter((entry) => {
    const details = entry.details ?? {}
    return (
      (!filters.action ||
        filters.action === 'all' ||
        String(
          details.action ??
            (logOutcome(entry) === 'failure'
              ? 'processing.failure'
              : 'processing.warning'),
        ) === filters.action) &&
      (!filters.userId.trim() ||
        String(details.userId ?? '') === filters.userId.trim() ||
        String(details.userName ?? '')
          .toLocaleLowerCase()
          .includes(filters.userId.trim().toLocaleLowerCase())) &&
      (!filters.requestId.trim() ||
        [
          details.auditRequestId,
          details.requestId,
          ...(Array.isArray(details.relatedRequests)
            ? details.relatedRequests.flatMap(
                (request: Record<string, unknown>) => [
                  request.auditRequestId,
                  request.requestId,
                ],
              )
            : []),
        ].some((id) => String(id ?? '') === filters.requestId.trim())) &&
      (!filters.outcome ||
        filters.outcome === 'all' ||
        logOutcome(entry) === filters.outcome)
    )
  })
}

/** 旧记录与新记录使用同一套展示和筛选规则。 */
export function normalizeLog<T extends Omit<LogEntry, 'id'>>(
  entry: T,
): T | null {
  const action = String(entry.details?.action ?? '')
  const failed = logOutcome(entry) === 'failure'
  if (entry.details?.code === 'NO_FLOW_INFO') return null
  if (
    !failed &&
    (action.endsWith('.reorder') || action === 'subscription.preview')
  )
    return null
  if (
    (!action || action === 'diagnostic') &&
    /UUID may be invalid|乐观缓存.*更新缓存发生错误|乐观缓存.*异步更新缓存发生错误|当前(?:运行)?环境不支持|建议.*并发|并发.*建议/.test(
      entry.message,
    )
  )
    return null
  if (
    (!action || action === 'diagnostic') &&
    ['warn', 'error'].includes(entry.level)
  )
    return {
      ...entry,
      details: {
        ...entry.details,
        action: failed ? 'processing.failure' : 'processing.warning',
      },
    }
  return entry
}

export const LOG_ACTION_LABELS: Record<string, string> = {
  'session.login': '登录',
  'session.logout': '退出登录',
  'subscription.preview': '预览订阅',
  'subscription.download': '拉取订阅',
  'backup.export': '导出备份',
  'backup.restore': '恢复备份',
  'backup.scheduled': '定时备份',
  'settings.update': '保存设置',
  'processing.failure': '处理异常',
  'processing.warning': '处理提醒',
  'notification.telegram': '通知异常',
  'share.create': '创建分享',
  'share.delete': '删除分享',
}
for (const [kind, label] of Object.entries({
  sub: '订阅',
  collection: '组合订阅',
})) {
  for (const [verb, text] of Object.entries({
    create: '创建',
    update: '保存',
    delete: '删除',
    import: '导入',
    clone: '克隆',
    reorder: '调整排序',
  }))
    LOG_ACTION_LABELS[`${kind}.${verb}`] = `${text}${label}`
}
