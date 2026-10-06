import { BaseError, errorMessage } from '../core/errors'
import { writeServerEvent } from '../store/logs'
import { redactDiagnostic } from '../core/utils/diagnostics'
import { LOG_ACTION_LABELS } from '#/shared/logs'
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

const escapeMarkdown = (value: unknown, limit = 300) =>
  Array.from(redactDiagnostic(String(value ?? '')))
    .slice(0, limit)
    .join('')
    .replace(/[\\_*[\]()~`>#+\-=|{}.!]/g, '\\$&')
const failed = (entry: ServerLog) =>
  entry.level === 'error' || Number(entry.details?.httpStatus) >= 400

const resourceKinds: Record<string, string> = {
  sub: '订阅',
  collection: '集合',
  share: '分享',
}

const formatDuration = (ms: number) =>
  ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`

/** 动作代码转中文标签（与日志页同源），未收录的保留原值便于排查。 */
const actionLabel = (action: unknown) => {
  const key = String(action ?? '')
  return key ? (LOG_ACTION_LABELS[key] ?? key) : ''
}

/** 不发送凭据、完整 URL、请求正文或 IP；来源失败详情折叠在同一条消息中。 */
export function formatTelegramEvent(entry: ServerLog): string {
  const details = entry.details ?? {}
  const resource =
    details.resourceDisplayName ||
    details.targetDisplayName ||
    details.collection ||
    details.subscription ||
    details.resourceName
  const problems: Record<string, unknown>[] = Array.isArray(details.failures)
    ? details.failures
    : Array.isArray(details.issues)
      ? details.issues
      : []
  const level = failed(entry)
    ? '失败'
    : entry.level === 'warn'
      ? '警告'
      : '成功'
  const rows = [`*SUKI SUB · ${level}通知*`, '━'.repeat(14)]
  const field = (label: string, value: string) => {
    if (value) rows.push(`*${label}*：${value}`)
  }
  field('事件', escapeMarkdown(entry.message, 160))
  field(
    '资源',
    [
      escapeMarkdown(resource, 120),
      resourceKinds[
        String(details.resourceKind ?? details.targetResourceKind ?? '')
      ],
    ]
      .filter(Boolean)
      .join(' · '),
  )
  field('格式', escapeMarkdown(details.platform, 80))
  field(
    '操作',
    [
      details.operatorIndex != null
        ? `第 ${Number(details.operatorIndex) + 1} 项`
        : '',
      escapeMarkdown(details.operatorName, 100),
    ]
      .filter(Boolean)
      .join(' · '),
  )
  field('用户', escapeMarkdown(details.userName, 100))
  field('动作', escapeMarkdown(actionLabel(details.action), 120))
  const status = Number(details.httpStatus)
  if (Number.isFinite(status) && status > 0) field('状态', `HTTP ${status}`)
  const durationMs = Number(details.durationMs)
  if (Number.isFinite(durationMs) && durationMs >= 0)
    // formatDuration 的 toFixed 会产生小数点,MarkdownV2 中必须转义。
    field('耗时', escapeMarkdown(formatDuration(durationMs), 24))
  if (problems.length) field('来源失败', `${problems.length} 个`)
  const diagnostic = [
    details.reason ? escapeMarkdown(details.reason, 800) : '',
    ...problems
      .slice(0, 8)
      .map(
        (item: Record<string, unknown>) =>
          `${escapeMarkdown(item.resourceDisplayName || item.subscription || item.source || item.resourceName, 120)}\n${escapeMarkdown(item.message, 400)}`,
      ),
    problems.length > 8
      ? `另有 ${problems.length - 8} 个问题，详情见日志。`
      : '',
  ].filter(Boolean)
  if (diagnostic.length) {
    // MarkdownV2 可折叠引用块：首行 **>，其余行 >；未配对的 || 会让 Telegram 拒收整条消息。
    // 按整行累计 2200 字符预算，避免截断转义序列并保持在 4096 上限内。
    const lines: string[] = []
    let used = 0
    for (const line of diagnostic.join('\n\n').split('\n')) {
      if (used + line.length > 2200) {
        lines.push('…内容过长已截断，详情见日志')
        break
      }
      lines.push(line)
      used += line.length + 1
    }
    rows.push(
      '',
      ...['诊断详情', ...lines].map(
        (line, index) => `${index === 0 ? '**' : ''}>${line}`,
      ),
    )
  }
  return rows.join('\n')
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
  const entry = candidates.find(failed) || candidates[candidates.length - 1]
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
              parse_mode: 'MarkdownV2',
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

/** 操作类通知的分类:action 前缀 → 对应的全局设置键。 */
const OP_NOTIFY_SETTINGS = {
  shares: 'telegramNotifyShareOps',
  resources: 'telegramNotifyResourceOps',
  settings: 'telegramNotifySettingsOps',
} as const

function classifyOpAction(
  action: string,
): keyof typeof OP_NOTIFY_SETTINGS | null {
  if (action.startsWith('share.')) return 'shares'
  if (
    action.startsWith('sub.') ||
    action.startsWith('collection.') ||
    action.startsWith('module.')
  )
    return 'resources'
  if (
    action.startsWith('settings.') ||
    action.startsWith('backup.') ||
    action.startsWith('session.')
  )
    return 'settings'
  return null
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
  if (globalSettings.telegramEnabled === false) return
  // 操作类请求(创建分享、增删改、设置/备份)按各自分类开关,成功与失败都推送;
  // 其余带资源上下文的请求(订阅拉取/预览)按资源级开关;都不匹配时仅接口异常兜底。
  let opCategory: keyof typeof OP_NOTIFY_SETTINGS | null = null
  for (const entry of entries) {
    const action = String(entry.details?.action ?? '')
    opCategory = classifyOpAction(action)
    if (opCategory) break
  }
  const switches: TelegramSwitches = opCategory
    ? {
        telegramEnabled:
          globalSettings[OP_NOTIFY_SETTINGS[opCategory]] === true,
        telegramNotifySuccess: true,
      }
    : resource
      ? {
          telegramEnabled: resource.telegramEnabled === true,
          telegramNotifySuccess: resource.telegramNotifySuccess === true,
        }
      : {
          telegramEnabled: globalSettings.telegramNotifySystemErrors === true,
          telegramNotifySuccess: false,
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
