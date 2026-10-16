import {
  resourceNotificationMode,
  telegramCategoryMode,
  telegramMasterMode,
  telegramOperationCategory,
} from '#/shared/telegram-notifications'
import type { Collection, Settings, Subscription } from '#/shared/types'
import type { ServerLog } from '../store/logs'

export interface NotificationRequest {
  path: string
  method: string
  status: number
}

export const isNotificationFailure = (entry: ServerLog) =>
  entry.level === 'error' || Number(entry.details?.httpStatus) >= 400

const abnormal = (entry: ServerLog) =>
  isNotificationFailure(entry) || entry.level === 'warn'

/** 先按请求归类，再筛选日志，关闭的事件绝不进入系统故障兜底。 */
export function selectTelegramNotification(
  settings: Settings,
  entries: readonly ServerLog[],
  resource?: Subscription | Collection,
  request?: NotificationRequest,
) {
  if (telegramMasterMode(settings) === 'off') return null
  const path = request?.path ?? String(entries[0]?.details?.path ?? '')
  let category: string | undefined
  let action: string | undefined
  if (path.startsWith('/s/')) {
    action = entries.some((entry) => entry.details?.action === 'share.access')
      ? 'share.access'
      : 'subscription.download'
    category = telegramOperationCategory(action)
  } else {
    // 已知业务请求即使只有引擎错误日志，也必须沿用该请求的分类。
    if (
      /^\/api\/(?:subs|collections|modules|preview|parse|settings|sort|age)(?:\/|$)/.test(
        path,
      ) ||
      path === '/api/backup/sync' ||
      (path === '/api/backup' && request?.method === 'GET') ||
      /^\/auth\/(?:login|session)(?:\/|$)/.test(path)
    )
      return null
    action =
      path === '/api/backup' && request?.method === 'POST'
        ? 'backup.restore'
        : path === '/auth/callback'
          ? 'session.login'
          : path === '/auth/logout'
            ? 'session.logout'
            : path.startsWith('/api/shares/') || path === '/api/shares'
              ? request?.method === 'POST'
                ? 'share.create'
                : request?.method === 'DELETE'
                  ? 'share.delete'
                  : undefined
              : undefined
    action ??= entries
      .map((entry) => String(entry.details?.action ?? ''))
      .find((value) => telegramOperationCategory(value))
    category = action ? telegramOperationCategory(action) : undefined
  }
  let mode = category ? telegramCategoryMode(settings, category) : 'errors'
  if (category === 'telegramNotifyDownload' && resource) {
    const override = resourceNotificationMode(resource)
    if (override !== 'inherit') mode = override
  }
  let candidates = entries.filter((entry) => entry.level !== 'debug')
  if (!category) {
    category = 'telegramNotifySystemErrors'
    mode = telegramCategoryMode(settings, category)
    // 普通 4xx、处理提醒与通知发送失败都不是系统故障。
    if (request && request.status < 500) return null
    candidates = candidates.filter(
      (entry) =>
        isNotificationFailure(entry) &&
        !String(entry.details?.action ?? '').startsWith('notification.') &&
        (request != null ||
          Number(entry.details?.httpStatus) >= 500 ||
          entry.details?.code === 'INTERNAL'),
    )
  }
  if (mode === 'off') return null
  if (mode === 'errors') candidates = candidates.filter(abnormal)
  if (!candidates.length) return null
  const entry =
    candidates.find(isNotificationFailure) ??
    candidates.find((item) => item.level === 'warn') ??
    candidates[candidates.length - 1]
  const level =
    request && request.status < 400 && abnormal(entry) ? 'warn' : entry.level
  const details: Record<string, unknown> = {
    ...entry.details,
    ...(action ? { action } : {}),
    ...(resource
      ? {
          targetResourceName: resource.name,
          targetDisplayName: resource.displayName || resource.name,
          targetResourceKind:
            'subscriptions' in resource ? 'collection' : 'sub',
        }
      : {}),
    ...(request ? { httpStatus: request.status } : {}),
  }
  const summary = { ...entry, level, details }
  const outcome = isNotificationFailure(summary)
    ? 'failure'
    : level === 'warn'
      ? 'warning'
      : 'success'
  // 无效分享统一限频，避免随机链接制造无限多的通知桶。
  const identity =
    action === 'share.access'
      ? 'share.access'
      : JSON.stringify([
          details.targetResourceKind ?? details.resourceKind,
          details.targetResourceName ?? details.resourceName,
          action ?? path,
        ])
  return {
    category,
    entry: summary,
    cooldownKey: JSON.stringify([
      category,
      identity,
      outcome,
      outcome === 'success'
        ? ''
        : details.code || details.httpStatus || outcome,
    ]),
  }
}
