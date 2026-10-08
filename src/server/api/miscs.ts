import { validateForSave } from '../core/preview-process'
import { getEngineStore, runWithEngineStore } from '../store/engine-store'
import { RequestInvalidError } from '../core/errors'
/**
 * 环境信息与全量备份/恢复(/api/backup)。
 */
import { Hono } from 'hono'
import type { Collection, ModuleItem, Subscription } from '#/shared/types'
import { errorResponse, failureResponse } from './http'
import { gistBackup } from '../jobs/jobs'
import { ApiRoutes } from '#/shared/api-contract'
import { withApiStore } from '../store/bootstrap'
import { settingsForBackup, settingsForRestore } from '../store/backup-settings'
import {
  getAllSettings,
  listCollections,
  listModules,
  listSubscriptions,
  replaceAllSettings,
  replaceCollections,
  replaceModules,
  replaceSubscriptions,
} from '../store/d1'

const app = new Hono<{ Bindings: Env }>()

export interface BackendEnv {
  backend: string
  version: string
  feature: Record<string, boolean>
}

export const backendEnv = (): BackendEnv => ({
  backend: 'Workers',
  version: '0.1.0',
  feature: {
    kv: true,
    d1: true,
    dynamicWorkersSandbox: true,
    scriptOperator: true,
    cron: true,
  },
})

app.get('/api/env', (c) => c.json(backendEnv()))

/** 使用已保存的设置手动上传全量备份，与定时任务共用同一实现。 */
app.post(ApiRoutes.backupSync, async (c) => {
  try {
    const result = await gistBackup(c.env)
    c.set('operationDetails' as never, result.context as never)
    if (!result.ok)
      return failureResponse(c, 'BACKUP_FAILED', '备份失败', 502, {
        ...result.context,
        reason: result.detail,
      })
    return c.json({ backedUp: true })
  } catch (err) {
    return errorResponse(c, err)
  }
})

/** 全量导出 */
app.get('/api/backup', async (c) =>
  withApiStore(c.env, async () => {
    try {
      const db = c.env.SUKI_SUB_DB
      const [subs, collections, modules, settings] = await Promise.all([
        listSubscriptions(db),
        listCollections(db),
        listModules(db),
        getAllSettings(db),
      ])
      return c.json({
        version: '1',
        exportedAt: new Date().toISOString(),
        data: {
          subs,
          collections,
          modules,
          settings: settingsForBackup(settings),
        },
      })
    } catch (err) {
      return errorResponse(c, err)
    }
  }),
)

/** 全量恢复:替换所有持久资源 */
app.post('/api/backup', async (c) =>
  withApiStore(c.env, async () => {
    try {
      const body = await c.req.json()
      const data = body.data ?? body
      for (const key of ['subs', 'collections', 'modules']) {
        if (data[key] != null && !Array.isArray(data[key]))
          throw new RequestInvalidError(
            'INVALID_BODY',
            `备份中的 ${key} 必须是数组`,
          )
      }
      if (
        data.settings != null &&
        (typeof data.settings !== 'object' || Array.isArray(data.settings))
      )
        throw new RequestInvalidError('INVALID_BODY', '备份中的设置必须是对象')
      const settings =
        data.settings == null
          ? getEngineStore().settings
          : settingsForRestore(data.settings, getEngineStore().settings)
      await runWithEngineStore(
        {
          ...getEngineStore(),
          subs: data.subs ?? [],
          collections: data.collections ?? [],
          modules: data.modules ?? [],
          settings,
        },
        async () => {
          for (const sub of data.subs ?? []) await validateForSave('sub', sub)
          for (const collection of data.collections ?? [])
            await validateForSave('collection', collection)
        },
      )
      const db = c.env.SUKI_SUB_DB
      await replaceSubscriptions(db, data.subs ?? [])
      await replaceCollections(db, data.collections ?? [])
      await replaceModules(db, data.modules ?? [])
      if (data.settings != null) await replaceAllSettings(db, settings)
      return c.json({ restored: true })
    } catch (err) {
      return errorResponse(c, err)
    }
  }),
)

export interface StorageData {
  subs?: Subscription[]
  collections?: Collection[]
  modules?: ModuleItem[]
  settings?: Record<string, unknown>
}

export default app
