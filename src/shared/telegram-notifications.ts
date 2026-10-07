import type { Settings } from './types'

export type NotificationMode = 'off' | 'errors' | 'all'

/** 设置页与通知分发共用分类；旧布尔值开启对应“全部”。 */
export const TELEGRAM_NOTIFICATIONS = [
  {
    key: 'telegramNotifyShareOps',
    defaultMode: 'all',
    label: '分享操作',
    description: '创建、删除分享',
    prefix: 'share.',
  },
  {
    key: 'telegramNotifyResourceOps',
    defaultMode: 'errors',
    label: '订阅与脚本变更',
    description: '订阅、组合与脚本模块的增删改、导入和克隆',
    prefixes: ['sub.', 'collection.', 'module.'],
  },
  {
    key: 'telegramNotifySettingsOps',
    defaultMode: 'errors',
    label: '设置变更',
    description: '保存设置与调整通知范围',
    prefix: 'settings.',
  },
  {
    key: 'telegramNotifyBackupExport',
    defaultMode: 'errors',
    label: '导出备份',
    description: '下载全量备份文件',
    action: 'backup.export',
    legacy: 'telegramNotifySettingsOps',
  },
  {
    key: 'telegramNotifyBackupRestore',
    defaultMode: 'all',
    label: '恢复备份',
    description: '从备份恢复数据',
    action: 'backup.restore',
    legacy: 'telegramNotifySettingsOps',
  },
  {
    key: 'telegramNotifyBackupManual',
    defaultMode: 'errors',
    label: '手动备份',
    description: '保存并备份到 GitHub Gist 或 GitLab Snippet',
    action: 'backup.manual',
    legacy: 'telegramNotifySettingsOps',
  },
  {
    key: 'telegramNotifyBackupScheduled',
    defaultMode: 'errors',
    label: '定时备份',
    description: '定时任务上传备份',
    action: 'backup.scheduled',
    legacy: 'telegramNotifySettingsOps',
  },
  {
    key: 'telegramNotifySessionOps',
    defaultMode: 'errors',
    label: '登录与退出',
    description: '登录回调与退出登录',
    prefix: 'session.',
    legacy: 'telegramNotifySettingsOps',
  },
  {
    key: 'telegramNotifySystemErrors',
    defaultMode: 'all',
    label: '接口异常',
    description: '没有资源上下文的接口错误与警告；普通读取不发送成功通知',
  },
] as const

export function notificationMode(value: unknown): NotificationMode {
  if (value === true || value === 'all') return 'all'
  return value === 'errors' ? 'errors' : 'off'
}

export function telegramMasterMode(settings: Settings): NotificationMode {
  return settings.telegramNotificationMode != null
    ? notificationMode(settings.telegramNotificationMode)
    : settings.telegramEnabled === false
      ? 'off'
      : 'all'
}

export function telegramCategoryMode(
  settings: Settings,
  key: string,
): NotificationMode {
  const category = TELEGRAM_NOTIFICATIONS.find((item) => item.key === key)
  return notificationMode(
    settings[key] ??
      (category && 'legacy' in category
        ? settings[category.legacy]
        : undefined) ??
      category?.defaultMode,
  )
}

export function telegramOperationCategory(action: string): string | undefined {
  return TELEGRAM_NOTIFICATIONS.find(
    (item) =>
      ('action' in item && item.action === action) ||
      ('prefix' in item && action.startsWith(item.prefix)) ||
      ('prefixes' in item &&
        item.prefixes.some((prefix) => action.startsWith(prefix))),
  )?.key
}

/** 首次修改时固定旧设置的各分类值，避免一个旧开关联动多个新分类。 */
export function telegramModePatch(
  settings: Settings,
  key: string,
  mode: NotificationMode,
): Settings {
  return {
    ...Object.fromEntries(
      TELEGRAM_NOTIFICATIONS.map((item) => [
        item.key,
        telegramCategoryMode(settings, item.key),
      ]),
    ),
    telegramNotificationMode: telegramMasterMode(settings),
    [key]: mode,
    ...(key === 'telegramNotificationMode'
      ? { telegramEnabled: mode !== 'off' }
      : {}),
  }
}
