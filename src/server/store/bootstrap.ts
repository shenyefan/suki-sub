/**
 * 请求引导:每个 API 请求开始时从 D1 载入资源快照 → 在 EngineStore 作用域内
 * 执行 handler → 请求结束时把引擎的写(脏键)整 scope 回写 D1。
 */
import {
  ensureSchema,
  getAllSettings,
  listCollections,
  listModules,
  listSubscriptions,
  replaceCollections,
  replaceModules,
  replaceSubscriptions,
  saveSettings,
} from './d1'
import { runWithEngineStore } from './engine-store'
import type { EngineStore } from './engine-store'
import { takeDirtyEngineKeys } from '../core/app'
import {
  COLLECTIONS_KEY,
  MODULES_KEY,
  SETTINGS_KEY,
  SUBS_KEY,
} from '../core/constants'

let schemaReady = false

async function loadStore(env: Env): Promise<EngineStore> {
  if (!schemaReady) {
    await ensureSchema(env.SUKI_SUB_DB)
    schemaReady = true
  }
  const [subs, collections, modules, settings] = await Promise.all([
    listSubscriptions(env.SUKI_SUB_DB),
    listCollections(env.SUKI_SUB_DB),
    listModules(env.SUKI_SUB_DB),
    getAllSettings(env.SUKI_SUB_DB),
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

/**
 * 包装 handler:载入快照 → EngineStore 作用域执行 → 回写脏键。
 * handler 必须在返回前完成全部引擎调用;flush 使用作用域内的最终快照。
 */
export async function withApiStore<T>(
  env: Env,
  handler: () => Promise<T>,
): Promise<T> {
  const store = await loadStore(env)
  let result: T | undefined
  await runWithEngineStore(store, async () => {
    result = await handler()
  })
  const dirty = takeDirtyEngineKeys()
  const db = env.SUKI_SUB_DB
  for (const key of dirty) {
    switch (key) {
      case SUBS_KEY:
        await replaceSubscriptions(db, store.subs)
        break
      case COLLECTIONS_KEY:
        await replaceCollections(db, store.collections)
        break
      case MODULES_KEY:
        await replaceModules(db, store.modules)
        break
      case SETTINGS_KEY:
        await saveSettings(db, store.settings)
        break
      default:
        break
    }
  }
  return result as T
}
