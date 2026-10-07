import { BaseError, errorMessage } from '../core/errors'
import { writeServerEvent, sanitizeLogValue } from '../store/logs'
import { redactDiagnostic } from '../core/utils/diagnostics'
import { LOG_ACTION_LABELS } from '#/shared/logs'
import {
  TELEGRAM_NOTIFICATIONS,
  telegramMasterMode,
  telegramCategoryMode,
  telegramOperationCategory,
} from '#/shared/telegram-notifications'
import { getAllSettings } from '../store/d1'
import type { ServerLog } from '../store/logs'
import type { Settings, Subscription, Collection } from '#/shared/types'

/** 通知开关:资源级(订阅/组合)与全局设置共用同一组键。 */
interface TelegramSwitches {
  telegramEnabled?: boolean
  telegramNotifySuccess?: boolean
}

interface TelegramTarget {
  chatId: string
  threadId?: number
}
interface TelegramConfig {
  token: string
  targets: TelegramTarget[]
  silent: boolean
}

/** Sub Store 同样使用 Shoutrrr 风格的环境变量；凭据不进入设置或日志。 */
export function parseTelegramConfig(
  value: string | undefined,
): TelegramConfig | null {
  if (!value?.trim()) return null
  const invalid = (message: string, field = 'url'): never => {
    throw new BaseError(
      'TELEGRAM_CONFIG_INVALID',
      `Telegram 通知配置：${message}`,
      { field: `SUKI_SUB_PUSH_SERVICE.${field}` },
    )
  }
  try {
    const input = value.trim()
    if (!/^telegram:\/\/[^/?#]+@telegram(?:[/?#]|$)/i.test(input))
      invalid('请使用 telegram://机器人Token@telegram?chats=会话ID')
    const url = new URL(input)
    if (url.protocol !== 'telegram:') invalid('协议应为 telegram://')
    if (url.hostname.toLowerCase() !== 'telegram')
      invalid('请使用 telegram://机器人Token@telegram?chats=会话ID')
    if (url.hash || (url.pathname && url.pathname !== '/'))
      invalid('不支持路径或 # 参数')
    const token = decodeURIComponent(
      url.username + (url.password ? ':' + url.password : ''),
    )
    if (!/^\d+:[\w-]+$/.test(token)) invalid('机器人 Token 格式不正确', 'bot')
    const params = new Map(
      [...url.searchParams].map(([key, item]) => [key.toLowerCase(), item]),
    )
    const chats = params.get('chats') || params.get('channels') || ''
    const values = [
      ...new Set(
        chats
          .split(',')
          .map((chat) => chat.trim())
          .filter(Boolean),
      ),
    ]
    if (!values.length) invalid('缺少通知会话，请设置 chats', 'chats')
    if (values.length > 10) invalid('通知会话数量不能超过 10 个', 'chats')
    const targets = values.map((chat, index) => {
      const match = /^(-?\d+|@[\w]+)(?::([1-9]\d*))?$/.exec(chat)
      if (!match)
        return invalid(`第 ${index + 1} 个会话或话题 ID 格式不正确`, 'chats')
      const threadId = match[2] ? Number(match[2]) : undefined
      if (threadId != null && !Number.isSafeInteger(threadId))
        invalid(`第 ${index + 1} 个话题 ID 无效`, 'chats')
      return { chatId: match[1], threadId }
    })
    return {
      token,
      targets,
      silent: /^(false|no|0)$/i.test(params.get('notification') || ''),
    }
  } catch (error) {
    if (error instanceof BaseError) throw error
    return invalid('链接或字符编码格式不正确')
  }
}

export function telegramConfigurationState(
  env: Pick<Env, 'SUKI_SUB_PUSH_SERVICE'>,
) {
  try {
    return parseTelegramConfig(env.SUKI_SUB_PUSH_SERVICE)
      ? 'configured'
      : 'missing'
  } catch {
    return 'invalid'
  }
}

const failed = (entry: ServerLog) =>
  entry.level === 'error' || Number(entry.details?.httpStatus) >= 400

const resourceKinds: Record<string, string> = {
  sub: '订阅',
  collection: '组合订阅',
  module: '脚本模块',
  share: '分享',
}
const fieldLabels: Record<string, string> = {
  name: '名称',
  url: '订阅链接',
  content: '本地内容',
  subscriptions: '组合成员',
  process: '节点操作',
  gistToken: '备份访问 Token',
  gistBackupName: '备份名称',
  syncPlatform: '备份平台',
  createItemPosition: '新建位置',
  telegramEnabled: '通知总范围',
  telegramNotificationMode: '通知总范围',
}
Object.assign(
  fieldLabels,
  Object.fromEntries(
    TELEGRAM_NOTIFICATIONS.map((item) => [item.key, item.label + '通知']),
  ),
)
const formatDuration = (ms: number) =>
  ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`
const actionLabel = (action: unknown) => {
  const key = String(action ?? '')
  return (
    LOG_ACTION_LABELS[key] ??
    (key.startsWith('processing.') ? '处理订阅' : '接口请求')
  )
}

/** Telegram HTML 只接受转义后的文本；结构化原因也保留实际内容。 */
const escapeTelegram = (value: unknown, limit = 300) => {
  const text =
    typeof value === 'object' && value !== null
      ? JSON.stringify(sanitizeLogValue(value))
      : String(value ?? '')
  return Array.from(redactDiagnostic(text))
    .slice(0, limit)
    .join('')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** 明确谁在何时对哪个资源做了什么，错误附来源、操作与定位信息。 */
export function formatTelegramEvent(entry: ServerLog): string {
  const d = entry.details ?? {}
  const outcome = failed(entry)
    ? '失败'
    : entry.level === 'warn'
      ? '警告'
      : '成功'
  const action = d.renamed
    ? '重命名' +
      (resourceKinds[String(d.resourceKind ?? d.targetResourceKind)] ?? '订阅')
    : actionLabel(d.action)
  const rows = [`<b>SUKI SUB · ${escapeTelegram(action)}${outcome}</b>`]
  const field = (label: string, value: unknown, limit = 300) => {
    if (value != null && value !== '')
      rows.push(`<b>${label}</b>：${escapeTelegram(value, limit)}`)
  }
  field('事件', entry.message, 200)
  const name =
    d.targetResourceName ?? d.resourceName ?? d.subscription ?? d.collection
  const displayName = d.targetDisplayName ?? d.resourceDisplayName
  field(
    '资源',
    [
      resourceKinds[String(d.targetResourceKind ?? d.resourceKind)],
      displayName || name,
    ]
      .filter(Boolean)
      .join(' · '),
    160,
  )
  if (name && displayName && name !== displayName) field('资源名称', name, 120)
  if (d.previousName) field('名称变更', `${d.previousName} → ${name}`, 250)
  field(
    '执行者',
    d.userName ||
      (d.action === 'backup.scheduled'
        ? '定时任务'
        : d.action === 'subscription.download'
          ? '订阅客户端'
          : '未识别用户'),
    100,
  )
  const time = new Date(entry.time)
  if (!Number.isNaN(time.getTime()))
    field(
      '时间',
      new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      }).format(time) + '（北京时间）',
    )
  field('输出格式', d.platform, 80)
  field(
    '备份平台',
    d.backupPlatform === 'gitlab'
      ? 'GitLab Snippet'
      : d.backupPlatform === 'gist'
        ? 'GitHub Gist'
        : undefined,
  )
  field('备份名称', d.backupName, 100)
  field('备份文件', d.backupFile, 120)
  if (d.subscriptionCount != null)
    field(
      '备份内容',
      `${d.subscriptionCount} 个订阅、${d.collectionCount ?? 0} 个组合、${d.moduleCount ?? 0} 个脚本模块`,
    )
  if (Array.isArray(d.changedFields))
    field(
      '修改项',
      d.changedFields.map((key: string) => fieldLabels[key] ?? key).join('、'),
      400,
    )
  if (Array.isArray(d.notificationChanges)) {
    const labels: Record<string, string> = {
      off: '关闭',
      errors: '仅异常',
      all: '全部',
    }
    for (const item of d.notificationChanges as Record<string, unknown>[])
      field(
        '通知范围',
        `${item.label}：${labels[String(item.before)] ?? item.before} → ${labels[String(item.after)] ?? item.after}`,
      )
  }
  if (d.nodeCount != null) field('节点数量', d.nodeCount)
  if (d.replaced != null) field('导入数量', d.replaced)
  if (d.count != null) field('分享次数上限', d.count)
  if (d.endAt) field('分享到期时间', new Date(Number(d.endAt)).toISOString())
  if (failed(entry) && d.path) {
    const path = String(d.path)
      .replace(/^\/s\/.*/, '/s/:share')
      .replace(/^\/api\/shares\/.*/, '/api/shares/:share')
    field('请求', [d.method, path].filter(Boolean).join(' '), 200)
  }
  if (d.httpStatus) field('接口状态', `HTTP ${d.httpStatus}`)
  if (d.status) field('上游状态', `HTTP ${d.status}`)
  if (d.durationMs != null) field('耗时', formatDuration(Number(d.durationMs)))
  field('错误代码', d.code, 100)
  if (d.operatorName || d.operatorIndex != null)
    field(
      '出错操作',
      [
        d.operatorIndex != null ? `第 ${Number(d.operatorIndex) + 1} 项` : '',
        d.operatorName,
      ]
        .filter(Boolean)
        .join(' · '),
    )
  const position = (item: Record<string, unknown>) =>
    [
      item.field
        ? `字段：${fieldLabels[String(item.field)] ?? item.field}`
        : '',
      item.operatorIndex != null
        ? `操作第 ${Number(item.operatorIndex) + 1} 项`
        : '',
      item.configLine != null ? `配置第 ${item.configLine} 行` : '',
      item.sourceLine != null ? `来源第 ${item.sourceLine} 行` : '',
      item.scriptLine != null
        ? `脚本第 ${item.scriptLine} 行${item.scriptColumn != null ? `第 ${item.scriptColumn} 列` : ''}`
        : '',
    ]
      .filter(Boolean)
      .join(' · ')
  field('定位', position(d), 250)
  if (failed(entry) || entry.level === 'warn')
    field('原因', d.reason || d.message || entry.message, 500)
  const problems = [
    ...(Array.isArray(d.failures) ? d.failures : []),
    ...(Array.isArray(d.issues) ? d.issues : []),
    ...(Array.isArray(d.processingDetails) ? d.processingDetails : []),
  ] as Record<string, unknown>[]
  if (problems.length) {
    rows.push('', `<b>异常详情（${problems.length} 项）</b>`)
    for (const [index, item] of problems.slice(0, 6).entries()) {
      const source =
        item.resourceDisplayName ||
        item.subscription ||
        item.source ||
        item.resourceName ||
        item.operatorName ||
        '当前资源'
      rows.push(`${index + 1}. ${escapeTelegram(source, 120)}`)
      const location = position(item)
      if (location) rows.push(escapeTelegram(location, 200))
      rows.push(
        escapeTelegram(
          item.reason || item.message || item.code || '详情见日志',
          400,
        ),
      )
      if (item.status) rows.push(`上游 HTTP ${escapeTelegram(item.status, 8)}`)
    }
    if (problems.length > 6) rows.push(`其余 ${problems.length - 6} 项见日志`)
  }
  field('请求编号', d.auditRequestId, 100)
  // 按完整行控制消息预算，不截断 HTML 实体或标签。
  const result: string[] = []
  let length = 0
  for (const row of rows) {
    if (length + row.length > 3700) {
      result.push('内容较长，完整原因与请求编号请查看日志页')
      break
    }
    result.push(row)
    length += row.length + 1
  }
  return result.join('\n')
}

export async function sendTelegramEvents(
  env: Pick<Env, 'SUKI_SUB_PUSH_SERVICE'>,
  entries: readonly ServerLog[],
  settings: TelegramSwitches,
  fetcher: typeof fetch = fetch,
): Promise<number> {
  if (settings.telegramEnabled !== true) return 0
  const candidates = entries.filter((entry) =>
    settings.telegramNotifySuccess === true
      ? entry.level !== 'debug'
      : failed(entry) || entry.level === 'warn',
  )
  if (!candidates.length) return 0
  const config = parseTelegramConfig(env.SUKI_SUB_PUSH_SERVICE)
  if (!config) return 0
  // 一个请求只发送一条摘要，优先失败事件，避免来源/操作层重复通知。
  const entry =
    candidates.find(
      (item) =>
        failed(item) &&
        telegramOperationCategory(String(item.details?.action ?? '')),
    ) ||
    candidates.find(failed) ||
    candidates.find((item) => item.level === 'warn') ||
    candidates[candidates.length - 1]
  const text = formatTelegramEvent(entry)
  let sent = 0
  const results = await Promise.allSettled(
    config.targets.map(async (target, index) => {
      const safeReason = (error: unknown) =>
        redactDiagnostic(
          errorMessage(error).split(config.token).join('***'),
        ).slice(0, 400)
      try {
        const response = await fetcher(
          `https://api.telegram.org/bot${config.token}/sendMessage`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              chat_id: target.chatId,
              message_thread_id: target.threadId,
              text,
              parse_mode: 'HTML',
              link_preview_options: { is_disabled: true },
              disable_notification: config.silent,
            }),
            signal: AbortSignal.timeout(8000),
          },
        )
        let result: {
          ok?: boolean
          error_code?: number
          description?: string
          parameters?: { retry_after?: number }
        }
        try {
          result = await response.json()
        } catch {
          throw new BaseError(
            'TELEGRAM_INVALID_RESPONSE',
            'Telegram 返回非 JSON 响应',
            { status: response.status },
          )
        }
        if (!response.ok || result.ok !== true)
          throw new BaseError(
            'TELEGRAM_API_ERROR',
            `${result.error_code || response.status}：${safeReason(result.description || 'Telegram 拒绝发送通知')}`,
            {
              status: result.error_code || response.status,
              ...(typeof result.parameters?.retry_after === 'number'
                ? { retryAfter: result.parameters.retry_after }
                : {}),
            },
          )
        sent++
      } catch (error) {
        if (error instanceof BaseError) {
          error.target = index + 1
          throw error
        }
        const timeout = ['TimeoutError', 'AbortError'].includes(
          error && typeof error === 'object' && 'name' in error
            ? String(error.name)
            : '',
        )
        throw new BaseError(
          timeout ? 'TELEGRAM_TIMEOUT' : 'TELEGRAM_NETWORK_ERROR',
          timeout
            ? 'Telegram 请求超时（8 秒）'
            : `无法连接 Telegram：${safeReason(error)}`,
          { target: index + 1 },
        )
      }
    }),
  )
  const failures = results.flatMap((result) =>
    result.status === 'rejected'
      ? [
          {
            target: result.reason.target,
            code: result.reason.code,
            message: result.reason.message,
            ...(result.reason.status != null
              ? { status: result.reason.status }
              : {}),
            ...(result.reason.retryAfter != null
              ? { retryAfter: result.reason.retryAfter }
              : {}),
          },
        ]
      : [],
  )
  if (failures.length === 1)
    throw new BaseError(failures[0].code, failures[0].message, {
      ...failures[0],
      sent,
      total: config.targets.length,
    })
  if (failures.length)
    throw new BaseError(
      'TELEGRAM_SEND_FAILED',
      `${failures.length} 个通知目标发送失败`,
      { failures, sent, total: config.targets.length },
    )
  return sent
}

export async function notifyServerEvents(
  env: Env,
  entries: readonly ServerLog[],
  resource?: Subscription | Collection,
): Promise<void> {
  if (!env.SUKI_SUB_PUSH_SERVICE || !entries.length) return
  let globalSettings: Settings = {}
  try {
    globalSettings = await getAllSettings(env.SUKI_SUB_DB)
  } catch {
    // 设置表读取失败时退回资源级开关发送,通知不依赖设置表可用。
  }
  // 全局总开关:显式关闭时全部静默(未设置视为开启,保持既有行为)。
  const master = telegramMasterMode(globalSettings)
  if (master === 'off') return
  // 操作类请求按各自通知范围；总范围为仅异常时再过滤成功事件。
  // 其余带资源上下文的请求(订阅拉取/预览)按资源级开关;都不匹配时仅接口异常兜底。
  let opCategory: string | undefined
  for (const entry of entries) {
    const action = String(entry.details?.action ?? '')
    opCategory = telegramOperationCategory(action)
    if (opCategory) break
  }
  const mode = opCategory
    ? telegramCategoryMode(globalSettings, opCategory)
    : resource
      ? resource.telegramEnabled === true
        ? resource.telegramNotifySuccess === true
          ? 'all'
          : 'errors'
        : 'off'
      : telegramCategoryMode(globalSettings, 'telegramNotifySystemErrors')
  const switches: TelegramSwitches = {
    telegramEnabled: mode !== 'off',
    telegramNotifySuccess: mode === 'all' && master === 'all',
  }
  if (switches.telegramEnabled !== true) return
  try {
    await sendTelegramEvents(env, entries, switches)
  } catch (error) {
    writeServerEvent('warn', 'Telegram 通知发送失败', {
      action: 'notification.telegram',
      reason: errorMessage(error),
      ...(error instanceof BaseError
        ? Object.fromEntries(
            Object.entries(error).filter(
              ([key]) => !['message', 'name', 'type', 'stack'].includes(key),
            ),
          )
        : {}),
    })
  }
}
