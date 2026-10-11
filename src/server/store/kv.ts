/**
 * KV 存储层：远程订阅缓存。
 * KV 最终一致；分享记录存入 D1。
 */
import { KV_PREFIX } from '#/shared/constants'

export async function kvGet<T>(
  kv: KVNamespace,
  key: string,
): Promise<T | null> {
  return kv.get<T>(key, 'json')
}

export async function kvPut(
  kv: KVNamespace,
  key: string,
  value: unknown,
  ttlSeconds?: number,
): Promise<void> {
  // KV 最小 TTL 60s
  const expirationTtl =
    ttlSeconds != null ? Math.max(60, Math.round(ttlSeconds)) : undefined
  await kv.put(
    key,
    JSON.stringify(value),
    expirationTtl != null ? { expirationTtl } : undefined,
  )
}

export async function kvDelete(kv: KVNamespace, key: string): Promise<void> {
  await kv.delete(key)
}

// ---------------------------------------------------------------------------
// 资源缓存(远程订阅内容)
// ---------------------------------------------------------------------------

export async function getCachedResource(
  kv: KVNamespace,
  key: string,
): Promise<string | null> {
  const v = await kvGet<{ content: string; headers?: Record<string, string> }>(
    kv,
    `${KV_PREFIX.resourceCache}${key}`,
  )
  return v?.content ?? null
}

export async function putCachedResource(
  kv: KVNamespace,
  key: string,
  content: string,
  headers?: Record<string, string>,
  ttlSeconds?: number,
): Promise<void> {
  await kvPut(
    kv,
    `${KV_PREFIX.resourceCache}${key}`,
    { content, headers },
    ttlSeconds,
  )
}
