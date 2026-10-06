/**
 * KV 存储层:token、远程订阅缓存。
 * KV 最终一致,只放时效性数据;持久数据一律走 D1。
 */
import { KV_PREFIX } from '#/shared/constants'
import type { TokenItem } from '#/shared/types'

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
// token
// ---------------------------------------------------------------------------

export async function getToken(
  kv: KVNamespace,
  id: string,
): Promise<TokenItem | null> {
  const token = await kvGet<TokenItem>(kv, `${KV_PREFIX.token}${id}`)
  return token &&
    ['sub', 'collection'].includes(token.type) &&
    token.name &&
    token.name !== '*'
    ? token
    : null
}

export async function saveToken(
  kv: KVNamespace,
  token: TokenItem,
): Promise<void> {
  // 时长过期交给 KV TTL;次数过期在读取侧判断并递减
  const ttl = token.endAt
    ? Math.max(0, Math.floor((token.endAt - Date.now()) / 1000))
    : undefined
  await kvPut(kv, `${KV_PREFIX.token}${token.id}`, token, ttl)
}

export async function deleteToken(kv: KVNamespace, id: string): Promise<void> {
  await kvDelete(kv, `${KV_PREFIX.token}${id}`)
}

export async function listTokens(kv: KVNamespace): Promise<TokenItem[]> {
  const list = await kv.list<TokenItem>({ prefix: KV_PREFIX.token })
  // kv.list 的 metadata 不一定包含完整值,逐个读取(单用户量级小,可接受)
  const items: TokenItem[] = []
  for (const key of list.keys) {
    const v = await getToken(kv, key.name.slice(KV_PREFIX.token.length))
    if (v) items.push(v)
  }
  return items
}

/**
 * 校验只读 token 并消费(次数型递减)。
 * expect 为期望访问的资源;只能访问精确绑定的订阅。
 */
export async function consumeToken(
  kv: KVNamespace,
  id: string,
  expect: { type: string; name: string },
): Promise<TokenItem | null> {
  const token = await getToken(kv, id)
  if (!token) return null
  const typeOk = token.type === expect.type
  const nameOk = token.name === expect.name
  if (!typeOk || !nameOk) return null
  if (token.endAt != null && token.endAt < Date.now()) return null
  if (token.count != null) {
    const used = token.usedCount ?? 0
    if (used >= token.count) return null
    token.usedCount = used + 1
    await saveToken(kv, token)
  }
  return token
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
