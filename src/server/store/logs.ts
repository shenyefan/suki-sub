import { AsyncLocalStorage } from 'node:async_hooks'
import { redactDiagnostic } from '../core/utils/diagnostics'

import { normalizeLog, logOutcome, filterLogs } from '#/shared/logs'
import type { LogEntry } from '#/shared/logs'
import type { LogsQuery, LogsResponse } from '#/shared/api-contract'

export type ServerLog = Omit<LogEntry, 'id'>

export function discardRequestLogs(): void {
  const entries = scope.getStore()?.entries
  if (entries) entries.length = 0
}

const RETAIN = 2000
const scope = new AsyncLocalStorage<{
  entries: ServerLog[]
  metadata?: () => Record<string, unknown>
}>()
const ready = new WeakMap<D1Database, Promise<void>>()

export async function ensureLogSchema(db: D1Database): Promise<void> {
  let pending = ready.get(db)
  if (!pending) {
    pending = db
      .prepare(
        `CREATE TABLE IF NOT EXISTS runtime_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      time TEXT NOT NULL,
      level TEXT NOT NULL,
      message TEXT NOT NULL,
      details TEXT
    )`,
      )
      .run()
      .then(async () => {
        const columns = await db
          .prepare('PRAGMA table_info(runtime_logs)')
          .all<{ name: string }>()
        if (!columns.results.some((column) => column.name === 'details'))
          await db
            .prepare('ALTER TABLE runtime_logs ADD COLUMN details TEXT')
            .run()
      })
    ready.set(db, pending)
    pending.catch(() => ready.delete(db))
  }
  await pending
}

/** 摘要和详情分别存储，敏感字段永远不进入日志。 */
export function sanitizeLogValue(value: unknown): unknown {
  if (typeof value === 'string') return redactDiagnostic(value)
  if (Array.isArray(value)) return value.map(sanitizeLogValue)
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        /token|secret|password|authorization|cookie|api[-_]?key/i.test(key)
          ? '***'
          : sanitizeLogValue(item),
      ]),
    )
  return value
}

export function hasRecordedFailure(): boolean {
  return (
    scope
      .getStore()
      ?.entries.some(
        (entry) =>
          entry.level === 'error' || Number(entry.details?.httpStatus) >= 400,
      ) ?? false
  )
}

/** 引擎诊断仅警告和错误进入列表；普通过程信息不持久化。 */
export function writeServerLog(
  level: string,
  message: string,
  details?: unknown,
): void {
  emitLog(level, message, details, level === 'warn' || level === 'error')
}

/** 显式业务事件：成功操作也记录，但不记录普通读取和轮询。 */
export function writeServerEvent(
  level: string,
  message: string,
  details?: unknown,
): void {
  emitLog(level, message, details, true)
}

function emitLog(
  level: string,
  message: string,
  details: unknown,
  persist: boolean,
): void {
  const safe = redactDiagnostic(message)
  const payload =
    details == null
      ? {}
      : typeof details === 'object'
        ? details
        : { reason: details }
  const fields =
    details == null
      ? persist
        ? (sanitizeLogValue(scope.getStore()?.metadata?.() ?? {}) as Record<
            string,
            unknown
          >)
        : undefined
      : (sanitizeLogValue({
          ...payload,
          ...scope.getStore()?.metadata?.(),
        }) as Record<string, unknown>)
  if (
    fields &&
    fields.targetResourceName === fields.resourceName &&
    fields.targetResourceKind === fields.resourceKind
  ) {
    delete fields.targetResourceName
    delete fields.targetResourceKind
    if (fields.targetDisplayName === fields.resourceDisplayName)
      delete fields.targetDisplayName
  }
  const entries = scope.getStore()?.entries
  const comparable = (value: Record<string, unknown> | undefined) =>
    JSON.stringify(
      Object.fromEntries(
        Object.entries(value ?? {}).filter(([key]) => key !== 'durationMs'),
      ),
    )
  // 同一请求中重复上报同一诊断只保留一次，不合并不同请求的操作。
  if (
    persist &&
    entries?.some(
      (entry) =>
        entry.level === level &&
        entry.message === safe &&
        comparable(entry.details) === comparable(fields),
    )
  )
    return
  if (persist)
    entries?.push({
      time: new Date().toISOString(),
      level,
      message: safe,
      details: fields,
    })
  const write =
    level === 'error'
      ? console.error
      : level === 'warn'
        ? console.warn
        : level === 'debug'
          ? console.debug
          : console.info
  write(
    `[SUKI SUB:${level}] ${safe}${fields ? ` ${JSON.stringify(fields)}` : ''}`,
  )
}

/** Request-scoped queues prevent concurrent requests from consuming each other's logs. */
export async function withServerLogs<T>(
  db: D1Database,
  handler: () => Promise<T>,
  metadata?: () => Record<string, unknown>,
  onEntries?: (entries: readonly ServerLog[]) => Promise<void> | void,
): Promise<T> {
  const entries: ServerLog[] = []
  return scope.run({ entries, metadata }, async () => {
    try {
      return await handler()
    } finally {
      const retained = entries
        .map(normalizeLog)
        .filter((entry): entry is ServerLog => entry != null)
      entries.splice(0, entries.length, ...summarizeRequestLogs(retained))
      if (entries.length && onEntries) {
        try {
          await onEntries([...entries])
        } catch {
          /* 推送不影响业务响应。 */
        }
      }
      if (entries.length) {
        try {
          await ensureLogSchema(db)
          const rowsToInsert = await aggregateDownloads(db, entries)
          for (let offset = 0; offset < rowsToInsert.length; offset += 25) {
            const rows = rowsToInsert.slice(offset, offset + 25)
            await db
              .prepare(
                `INSERT INTO runtime_logs (time, level, message, details) VALUES ${rows.map(() => '(?, ?, ?, ?)').join(', ')}`,
              )
              .bind(
                ...rows.flatMap((row) => [
                  row.time,
                  row.level,
                  row.message,
                  row.details ? JSON.stringify(row.details) : null,
                ]),
              )
              .run()
          }
          await db
            .prepare(
              'DELETE FROM runtime_logs WHERE id NOT IN (SELECT id FROM runtime_logs ORDER BY time DESC, id DESC LIMIT ?)',
            )
            .bind(RETAIN)
            .run()
        } catch (error) {
          // A logging storage failure must not replace the result of a subscription operation.
          console.error(
            '[SUKI SUB] 日志写入失败',
            redactDiagnostic(error instanceof Error ? error.message : error),
          )
        }
      }
    }
  })
}

/** 按时间和 ID 翻页，新增记录不会导致后续页面整体偏移。 */
export async function listServerLogs(
  db: D1Database,
  query: LogsQuery,
): Promise<LogsResponse> {
  await ensureLogSchema(db)
  const pageSize = 50
  const batchSize = 100
  let cursor: { time: string; id: number } | undefined = query.cursor
    ? JSON.parse(query.cursor)
    : undefined
  const entries: LogEntry[] = []
  const seen = new Map<string, LogEntry>()
  let nextCursor: string | null = null

  // 旧记录仍需归一化；按小批次扫描，凑够一页后立即停止。
  for (;;) {
    const result = await db
      .prepare(
        `SELECT id, time, level, message, details FROM runtime_logs
         WHERE (level IN ('warn', 'error') OR details IS NOT NULL)
         ${cursor ? 'AND (time < ? OR (time = ? AND id < ?))' : ''}
         ORDER BY time DESC, id DESC LIMIT ?`,
      )
      .bind(...(cursor ? [cursor.time, cursor.time, cursor.id] : []), batchSize)
      .all<Omit<LogEntry, 'details'> & { details: string | null }>()
    for (const row of result.results) {
      cursor = { time: row.time, id: row.id }
      const entry = normalizeLog({
        ...row,
        message: redactDiagnostic(row.message),
        details: row.details
          ? (sanitizeLogValue(JSON.parse(row.details)) as Record<
              string,
              unknown
            >)
          : undefined,
      })
      if (!entry) continue
      const details = entry.details ?? {}
      if (
        details.auditRequestId &&
        details.action &&
        logOutcome(entry) === 'success'
      ) {
        const key = JSON.stringify([
          details.auditRequestId,
          details.action,
          details.targetResourceName ?? details.resourceName,
        ])
        const previous = seen.get(key)
        if (previous) {
          previous.details = { ...details, ...previous.details }
          continue
        }
        seen.set(key, entry)
      }
      if (!filterLogs([entry], query).length) continue
      // 多找一条匹配记录，避免有下一页却显示为空。
      if (entries.length === pageSize) return { logs: entries, nextCursor }
      entries.push(entry)
      nextCursor = JSON.stringify(cursor)
    }
    if (result.results.length < batchSize)
      return { logs: entries, nextCursor: null }
  }
}

/** 设置页只读取最近一次推送失败摘要，不把运行状态混进持久设置。 */
export async function lastTelegramFailure(
  db: D1Database,
): Promise<string | null> {
  await ensureLogSchema(db)
  const row = await db
    .prepare(
      "SELECT time, details FROM runtime_logs WHERE json_extract(details, '$.action') = 'notification.telegram' ORDER BY time DESC, id DESC LIMIT 1",
    )
    .first<{ time: string; details: string }>()
  if (!row) return null
  const details = JSON.parse(row.details) as Record<string, unknown>
  const reason = redactDiagnostic(details.reason ?? '详情请查看日志')
  return `${row.time} · ${reason}`
}

export async function clearServerLogs(db: D1Database): Promise<void> {
  await ensureLogSchema(db)
  await db.prepare('DELETE FROM runtime_logs').run()
}

function summarizeRequestLogs(entries: ServerLog[]): ServerLog[] {
  const diagnostics = entries.filter((entry) =>
    String(entry.details?.action ?? '').startsWith('processing.'),
  )
  if (!diagnostics.length) return entries
  const failure = entries.find(
    (entry) =>
      entry.level === 'error' || Number(entry.details?.httpStatus) >= 400,
  )
  const summary = failure ?? diagnostics[0]
  const related = diagnostics.filter((entry) => entry !== summary)
  if (related.length)
    summary.details = {
      ...summary.details,
      processingDetails: related.map((entry) => ({
        message: entry.message,
        ...Object.fromEntries(
          Object.entries(entry.details ?? {}).filter(
            ([key]) =>
              ![
                'action',
                'auditRequestId',
                'userId',
                'userName',
                'userEmail',
                'ip',
                'clientUserAgent',
                'durationMs',
                'method',
                'path',
                'requestHost',
                'cfRay',
                'country',
                'region',
                'city',
                'colo',
                'asn',
                'asOrganization',
              ].includes(key),
          ),
        ),
      })),
    }
  if (!failure && diagnostics.length > 1)
    summary.message = `订阅处理出现 ${diagnostics.length} 项提醒`
  return entries.filter(
    (entry) => !diagnostics.includes(entry) || entry === summary,
  )
}

/** 只合并相同来源、用户、客户端在一分钟内的重复拉取失败；手动编辑/预览逐次保留。 */
async function aggregateDownloads(
  db: D1Database,
  entries: ServerLog[],
): Promise<ServerLog[]> {
  const result: ServerLog[] = []
  for (const entry of entries) {
    const details = entry.details ?? {}
    if (
      details.action !== 'subscription.download' ||
      !(entry.level === 'error' || Number(details.httpStatus) >= 400)
    ) {
      result.push(entry)
      continue
    }
    const key = JSON.stringify([
      entry.message,
      details.targetResourceName ?? details.resourceName,
      details.platform,
      details.failures,
      details.url,
      details.code,
      details.status,
      details.userId,
      details.ip,
      details.clientUserAgent,
    ])
    const request = {
      auditRequestId: details.auditRequestId,
      requestId: details.requestId,
      time: entry.time,
      durationMs: details.durationMs,
      cfRay: details.cfRay,
    }
    const existing = await db
      .prepare(
        "SELECT id FROM runtime_logs WHERE json_extract(details, '$.aggregationKey') = ? AND json_extract(details, '$.firstTime') >= ? AND json_array_length(json_extract(details, '$.relatedRequests')) < 100 ORDER BY id DESC LIMIT 1",
      )
      .bind(key, new Date(Date.parse(entry.time) - 60_000).toISOString())
      .all<{ id: number }>()
    if (existing.results[0]) {
      await db
        .prepare(
          "UPDATE runtime_logs SET time = ?, details = json_set(details, '$.repeatCount', coalesce(json_extract(details, '$.repeatCount'), 1) + 1, '$.lastTime', ?, '$.relatedRequests', json_insert(coalesce(json_extract(details, '$.relatedRequests'), '[]'), '$[#]', json(?))) WHERE id = ?",
        )
        .bind(
          entry.time,
          entry.time,
          JSON.stringify(request),
          existing.results[0].id,
        )
        .run()
    } else {
      entry.details = {
        ...details,
        aggregationKey: key,
        repeatCount: 1,
        firstTime: entry.time,
        lastTime: entry.time,
        relatedRequests: [request],
      }
      result.push(entry)
    }
  }
  return result
}
