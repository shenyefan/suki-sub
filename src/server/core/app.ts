import { writeServerLog } from '../store/logs'
/**
 * `$` 引擎上下文:日志 + 对 EngineStore 快照的同步 read/write/delete。
 */
import { getEngineStore } from '../store/engine-store'
import type {
  Collection,
  ModuleItem,
  Settings,
  Subscription,
} from '#/shared/types'
import {
  COLLECTIONS_KEY,
  MODULES_KEY,
  SETTINGS_KEY,
  SUBS_KEY,
} from './constants'

type StoreKey =
  | typeof SUBS_KEY
  | typeof COLLECTIONS_KEY
  | typeof MODULES_KEY
  | typeof SETTINGS_KEY

/** 引擎写过的键(bootstrap 在请求结束时据此回写 D1) */
const dirtyKeys = new Set<string>()

export function takeDirtyEngineKeys(): Set<string> {
  const keys = new Set(dirtyKeys)
  dirtyKeys.clear()
  return keys
}

function markDirty(key: string): void {
  dirtyKeys.add(key)
}

function readKey(key: string): unknown {
  const store = getEngineStore()
  switch (key) {
    case SUBS_KEY:
      return store.subs
    case COLLECTIONS_KEY:
      return store.collections
    case MODULES_KEY:
      return store.modules
    case SETTINGS_KEY:
      return store.settings
    default:
      return undefined
  }
}

function writeKey(key: string, data: unknown): void {
  const store = getEngineStore()
  switch (key) {
    case SUBS_KEY:
      store.subs = data as Subscription[]
      break
    case COLLECTIONS_KEY:
      store.collections = data as Collection[]
      break
    case MODULES_KEY:
      store.modules = data as ModuleItem[]
      break
    case SETTINGS_KEY:
      store.settings = data as Settings
      break
    default:
      throw new Error(`$.write: unsupported key ${key} on Workers`)
  }
}

/** 日志函数(引擎里的 $.info/$.error 都打到 Workers 日志) */
const log = (level: string) => (msg: string, data?: unknown) => {
  if (!['warn', 'error'].includes(level)) {
    try {
      if (getEngineStore().settings.debugLogs !== true) return
    } catch {
      return
    }
    writeServerLog('debug', msg, data)
    return
  }
  writeServerLog(level, msg, data)
}

const $ = {
  name: 'suki-sub',
  info: log('info'),
  error: log('error'),
  warn: log('warn'),
  log: log('debug'),
  debug: log('debug'),
  notify: (title: string, subtitle: string, body: unknown) => {
    log('info')(`${title} ${subtitle}`, body)
  },
  read(key: StoreKey): unknown {
    return readKey(key)
  },
  write(data: unknown, key: StoreKey): void {
    writeKey(key, data)
    markDirty(key)
  },
  delete(key: StoreKey): void {
    const store = getEngineStore()
    switch (key) {
      case SUBS_KEY:
        store.subs = []
        break
      case COLLECTIONS_KEY:
        store.collections = []
        break
      case MODULES_KEY:
        store.modules = []
        break
      case SETTINGS_KEY:
        store.settings = {}
        break
      default:
        throw new Error(`$.delete: unsupported key ${key} on Workers`)
    }
  },
}

export default $
