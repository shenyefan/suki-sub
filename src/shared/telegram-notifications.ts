import type { Settings } from './types'

export type NotificationMode = 'off' | 'errors' | 'all'
export type ResourceNotificationMode = NotificationMode | 'inherit'

/** 设置页与服务端共用事件分类，日常操作只在页面提示。 */
export const TELEGRAM_NOTIFICATIONS = [
  {
    key: 'telegramNotifyDownload',
    defaultMode: 'errors',
    label: '订阅拉取',
    description: '客户端拉取订阅或组合的结果，异常包含备用来源回退和部分失败',
    actions: ['subscription.download'],
  },
  {
    key: 'telegramNotifyShareOps',
    defaultMode: 'off',
    label: '分享管理',
    description: '创建、删除分享，以及链接无效、过期或次数用尽的访问异常',
    actions: ['share.create', 'share.delete', 'share.access'],
  },
  {
    key: 'telegramNotifyBackupRestore',
    defaultMode: 'off',
    label: '备份恢复',
    description: '从备份恢复数据的结果',
    actions: ['backup.restore'],
  },
  {
    key: 'telegramNotifyBackupScheduled',
    defaultMode: 'errors',
    label: '定时备份',
    description: '后台定时备份的结果，默认只提醒失败',
    actions: ['backup.scheduled'],
  },
  {
    key: 'telegramNotifySessionOps',
    defaultMode: 'off',
    label: '登录与退出',
    description: '登录回调与退出登录的结果',
    actions: ['session.login', 'session.logout'],
  },
  {
    key: 'telegramNotifySystemErrors',
    defaultMode: 'errors',
    label: '系统故障',
    description: '其他未归类的服务端故障，不包含预览、流量查询或日常操作失败',
    actions: [],
  },
] as const

export function notificationMode(value: unknown): NotificationMode {
  if (value === true || value === 'all') return 'all'
  return value === 'errors' ? 'errors' : 'off'
}

/** 未配置时保持关闭；旧总范围迁移为开关，不再限制各分类。 */
export function telegramMasterMode(settings: Settings): 'off' | 'all' {
  if (settings.telegramEnabled === false) return 'off'
  if (settings.telegramNotificationMode != null)
    return notificationMode(settings.telegramNotificationMode) === 'off'
      ? 'off'
      : 'all'
  return settings.telegramEnabled === true ? 'all' : 'off'
}

export function telegramCategoryMode(
  settings: Settings,
  key: string,
): NotificationMode {
  const category = TELEGRAM_NOTIFICATIONS.find((item) => item.key === key)
  const mode = notificationMode(settings[key] ?? category?.defaultMode)
  return key === 'telegramNotifySystemErrors' && mode !== 'off'
    ? 'errors'
    : mode
}

export function telegramOperationCategory(action: string): string | undefined {
  return TELEGRAM_NOTIFICATIONS.find((item) =>
    (item.actions as readonly string[]).includes(action),
  )?.key
}

/** 显式旧开关继续有效；没有资源级配置时跟随全局。 */
export function resourceNotificationMode(value: {
  telegramNotificationMode?: ResourceNotificationMode
  telegramEnabled?: boolean
  telegramNotifySuccess?: boolean
}): ResourceNotificationMode {
  if (value.telegramNotificationMode != null)
    return value.telegramNotificationMode === 'inherit'
      ? 'inherit'
      : notificationMode(value.telegramNotificationMode)
  if (value.telegramEnabled === false) return 'off'
  if (value.telegramEnabled === true)
    return value.telegramNotifySuccess === true ? 'all' : 'errors'
  return 'inherit'
}

export function telegramModePatch(
  key: string,
  mode: NotificationMode,
): Settings {
  return key === 'telegramEnabled'
    ? { telegramEnabled: mode !== 'off', telegramNotificationMode: mode }
    : { [key]: mode }
}
