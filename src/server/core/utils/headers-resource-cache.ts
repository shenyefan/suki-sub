/**
 * 响应头缓存(KV):键 = '#suki-sub-cached-headers-resource:<id>',条目 { time, data }。
 * 方法为 async,调用方需 await。
 */
import $ from '#/server/core/app'
import {
  HEADERS_RESOURCE_CACHE_KEY,
  DEFAULT_HEADERS_CACHE_TTL,
  SETTINGS_KEY,
} from '#/server/core/constants'
import { getEngineStore } from '#/server/store/engine-store'

interface CachedResourceEntry {
  time: number
  data: any
}

class ResourceCache {
  constructor() {}

  private getKV(): KVNamespace | null {
    try {
      return getEngineStore().kv
    } catch (e) {
      return null
    }
  }

  private composeKey(id: string) {
    return `${HEADERS_RESOURCE_CACHE_KEY}:${id}`
  }

  private async readEntry(id: string): Promise<CachedResourceEntry | null> {
    const kv = this.getKV()
    if (!kv) return null
    try {
      const raw = await kv.get(this.composeKey(id), 'text')
      if (raw == null) return null
      const parsed = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object') return null
      return parsed
    } catch (e) {
      $.error(
        `解析持久化缓存中的 ${HEADERS_RESOURCE_CACHE_KEY} 失败, 重置为 {}, 错误: ${
          (e as any)?.message ?? e
        }`,
      )
      try {
        await kv.delete(this.composeKey(id))
      } catch (e2) {
        // ignore
      }
      return null
    }
  }

  private async listIds(idPrefix = ''): Promise<string[]> {
    const kv = this.getKV()
    if (!kv) return []
    const ids: string[] = []
    let cursor: string | undefined
    do {
      const result: any = await kv.list({
        prefix: this.composeKey(idPrefix),
        ...(cursor ? { cursor } : {}),
      })
      for (const key of result.keys) {
        ids.push(key.name.slice(HEADERS_RESOURCE_CACHE_KEY.length + 1))
      }
      cursor = result.list_complete ? undefined : result.cursor
    } while (cursor)
    return ids
  }

  async _cleanup(prefix?: string, ttl?: any) {
    const kv = this.getKV()
    if (!kv) return
    const resolvedTTL = normalizeTTL(ttl) ?? 0
    const now = Date.now()
    const ids = await this.listIds(prefix ?? '')
    for (const id of ids) {
      const cached = await this.readEntry(id)
      const shouldDelete = !cached?.time || cached.time < now + resolvedTTL
      if (shouldDelete) {
        try {
          await kv.delete(this.composeKey(id))
        } catch (e) {
          // ignore
        }
      }
    }
  }

  async revokeAll() {
    const kv = this.getKV()
    if (!kv) return
    const ids = await this.listIds()
    for (const id of ids) {
      try {
        await kv.delete(this.composeKey(id))
      } catch (e) {
        // ignore
      }
    }
  }

  async gettime(id: string): Promise<number | null> {
    const cached = await this.readEntry(id)
    const time = cached && cached.time
    if (time && new Date().getTime() <= time) {
      return cached.time
    }
    return null
  }

  async get(id: string, ttl?: any, remove?: boolean): Promise<any> {
    const resolvedTTL = normalizeTTL(ttl) ?? 0
    const cached = await this.readEntry(id)
    const time = cached && cached.time
    if (time) {
      if (Date.now() + resolvedTTL <= time) return cached.data
      if (remove) {
        const kv = this.getKV()
        if (kv) {
          try {
            await kv.delete(this.composeKey(id))
          } catch (e) {
            // ignore
          }
        }
      }
    }
    return null
  }

  async set(id: string, value: any, ttl?: any): Promise<void> {
    const kv = this.getKV()
    if (!kv) return
    const resolvedTTL = normalizeTTL(ttl) ?? getTTL()
    const entry: CachedResourceEntry = {
      time: Date.now() + resolvedTTL,
      data: value,
    }
    const expirationTtl = Math.max(60, Math.ceil(resolvedTTL / 1000))
    await kv.put(this.composeKey(id), JSON.stringify(entry), {
      expirationTtl,
    })
  }
}

function normalizeTTL(ttl: any) {
  const value = Number(ttl)
  if (!isFinite(value)) return null
  if (value > 0) return value
  return null
}

function getTTL() {
  const settings = ($.read(SETTINGS_KEY) || {}) as any
  let ttl = settings?.headersCacheTtl
  if (ttl) {
    ttl = Number(ttl)
    if (isFinite(ttl) && ttl > 0) {
      return ttl * 1000
    }
  }
  return DEFAULT_HEADERS_CACHE_TTL
}

export default new ResourceCache()
