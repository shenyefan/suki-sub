import type { Settings } from '#/shared/types'

/** 同步配置仅保留在当前实例，不写入备份，也不从旧备份覆盖。 */
function isSyncSetting(key: string): boolean {
  return /^(gist|github|gitlab)/i.test(key) || key === 'syncPlatform'
}

export function settingsForBackup(settings: Settings): Settings {
  return Object.fromEntries(
    Object.entries(settings).filter(([key]) => !isSyncSetting(key)),
  )
}

export function settingsForRestore(
  backup: Settings,
  current: Settings,
): Settings {
  return {
    ...settingsForBackup(backup),
    ...Object.fromEntries(
      Object.entries(current).filter(([key]) => isSyncSetting(key)),
    ),
  }
}
