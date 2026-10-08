/**
 * 定时任务实现:Gist 自动备份。
 * 主 worker 与 cron scheduled() 共用;scheduler.ts 按 settings 分派。
 */
import Gist from '../core/utils/gist'
import { runWithEngineStore } from '../store/engine-store'
import type { EngineStore } from '../store/engine-store'
import { settingsForBackup } from '../store/backup-settings'
import {
  getAllSettings,
  listCollections,
  listModules,
  listSubscriptions,
} from '../store/d1'

async function loadJobStore(env: Env): Promise<EngineStore> {
  const db = env.SUKI_SUB_DB
  const [subs, collections, modules, settings] = await Promise.all([
    listSubscriptions(db),
    listCollections(db),
    listModules(db),
    getAllSettings(db),
  ])
  return {
    subs,
    collections,
    modules,
    settings,
    kv: env.SUKI_SUB_CACHE,
    scriptLoader: env.SCRIPT_LOADER,
  }
}

export interface JobResult {
  job: string
  ok: boolean
  detail?: unknown
  context?: Record<string, unknown>
}

/** Gist 自动备份:全量数据推送 Gist */
export async function gistBackup(env: Env): Promise<JobResult> {
  const store = await loadJobStore(env)
  return runWithEngineStore(store, async () => {
    try {
      const name =
        String(store.settings['gistBackupName'] ?? '').trim() ||
        'suki-sub-backup'
      const token = String(store.settings['gistToken'] ?? '').trim()
      if (!token) throw new Error('请先配置备份访问 Token')
      const gist = new Gist({
        token,
        key: name,
        syncPlatform:
          store.settings['syncPlatform'] === 'gitlab' ? 'gitlab' : 'gist',
      })
      const { subs, collections, modules, settings } = store
      const content = JSON.stringify(
        {
          version: '1',
          exportedAt: new Date().toISOString(),
          data: {
            subs,
            collections,
            modules,
            settings: settingsForBackup(settings),
          },
        },
        null,
        2,
      )
      await gist.upload({ [`${name}.json`]: { content } })
      return {
        context: {
          backupName: name,
          backupFile: `${name}.json`,
          backupPlatform:
            store.settings.syncPlatform === 'gitlab' ? 'gitlab' : 'gist',
          subscriptionCount: subs.length,
          collectionCount: collections.length,
          moduleCount: modules.length,
        },
        job: 'gist-backup',
        ok: true,
      }
    } catch (err) {
      return {
        job: 'gist-backup',
        ok: false,
        detail: err instanceof Error ? err.message : String(err),
        context: {
          backupName: store.settings.gistBackupName || 'suki-sub-backup',
          backupPlatform:
            store.settings.syncPlatform === 'gitlab' ? 'gitlab' : 'gist',
        },
      }
    }
  })
}
