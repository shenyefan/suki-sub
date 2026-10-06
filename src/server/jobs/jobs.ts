/**
 * 定时任务实现:Gist 自动备份。
 * 主 worker 与 cron scheduled() 共用;scheduler.ts 按 settings 分派。
 */
import Gist from '../core/utils/gist'
import { runWithEngineStore } from '../store/engine-store'
import type { EngineStore } from '../store/engine-store'
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
}

/** Gist 自动备份:全量数据推送 Gist */
export async function gistBackup(env: Env): Promise<JobResult> {
  const store = await loadJobStore(env)
  return runWithEngineStore(store, async () => {
    try {
      const gist = new Gist({
        token: String(store.settings['gistToken'] ?? ''),
      })
      const db = env.SUKI_SUB_DB
      const [subs, collections, settings] = await Promise.all([
        listSubscriptions(db),
        listCollections(db),
        getAllSettings(db),
      ])
      const content = JSON.stringify(
        {
          version: '1',
          exportedAt: new Date().toISOString(),
          data: { subs, collections, settings },
        },
        null,
        2,
      )
      const name = String(store.settings['gistBackupName'] ?? 'suki-sub-backup')
      await gist.upload(name, { [`${name}.json`]: { content } })
      return { job: 'gist-backup', ok: true }
    } catch (err) {
      return {
        job: 'gist-backup',
        ok: false,
        detail: err instanceof Error ? err.message : String(err),
      }
    }
  })
}
