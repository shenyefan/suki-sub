import { BaseError, errorMessage } from '../core/errors'
import { writeServerEvent, sanitizeLogValue } from '../store/logs'
import { redactDiagnostic } from '../core/utils/diagnostics'
import { LOG_ACTION_LABELS } from '#/shared/logs'
import { telegramOperationCategory } from '#/shared/telegram-notifications'
import { getAllSettings } from '../store/d1'
import { claimNotification } from './cooldown'
import { isNotificationFailure, selectTelegramNotification } from './policy'
import type { NotificationRequest } from './policy'
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

const failed = isNotificationFailure

const resourceKinds: Record<string, string> = {
  sub: '订阅',
  collection: '组合订阅',
  module: '脚本模块',
  share: '分享',
}
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

/** 推送仅展示结果摘要，完整诊断使用请求编号在日志页查阅。 */
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
  if (failed(entry) || entry.level === 'warn')
    field('原因', d.reason || d.message || entry.message, 500)
  const problems = [
    ...(Array.isArray(d.failures) ? d.failures : []),
    ...(Array.isArray(d.issues) ? d.issues : []),
    ...(Array.isArray(d.processingDetails) ? d.processingDetails : []),
  ]
  if (problems.length) field('异常数量', problems.length)
  if (entry.level === 'warn' && Number(d.httpStatus) < 400)
    field('结果', '本次请求已完成，存在处理异常，详情请查看日志')
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
  request?: NotificationRequest,
): Promise<void> {
  if (!env.SUKI_SUB_PUSH_SERVICE || !entries.length) return
  let globalSettings: Settings
  try {
    globalSettings = await getAllSettings(env.SUKI_SUB_DB)
  } catch {
    // 无法确认关闭状态时保持静默，绝不退回资源级配置发送。
    return
  }
  const notification = selectTelegramNotification(
    globalSettings,
    entries,
    resource,
    request,
  )
  if (!notification) return
  try {
    if (!parseTelegramConfig(env.SUKI_SUB_PUSH_SERVICE)) return
    if (!(await claimNotification(env.SUKI_SUB_DB, notification.cooldownKey)))
      return
    await sendTelegramEvents(env, [notification.entry], {
      telegramEnabled: true,
      telegramNotifySuccess: true,
    })
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
