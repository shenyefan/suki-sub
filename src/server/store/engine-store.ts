/**
 * 引擎存储:每个请求一份资源快照(D1 异步 → 引擎同步读写)。
 * 并发安全:AsyncLocalStorage 隔离。
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import type {
  Collection,
  ModuleItem,
  Settings,
  Subscription,
} from '#/shared/types'

/** 引擎视角的存储接口:键 → 数据 */
export interface EngineStore {
  subs: Subscription[]
  collections: Collection[]
  modules: ModuleItem[]
  settings: Settings
  /** KV 句柄:引擎内的资源缓存(resource-cache 等)走 KV;为空时缓存降级为直连 */
  kv: KVNamespace | null
  /** Dynamic Workers 加载器:脚本操作符沙箱;为空时脚本操作符不可用 */
  scriptLoader: WorkerLoader | null
}

const storage = new AsyncLocalStorage<EngineStore>()

/** 在请求/任务上下文中运行,期间 getEngineStore() 可同步取到快照 */
export function runWithEngineStore<T>(store: EngineStore, fn: () => T): T {
  return storage.run(store, fn)
}

export function getEngineStore(): EngineStore {
  const store = storage.getStore()
  if (!store)
    throw new Error(
      'EngineStore not available: wrap handler with runWithEngineStore()',
    )
  return store
}
