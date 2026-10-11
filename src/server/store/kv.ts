/**
 * KV 存储层:token、远程订阅缓存。
 * KV 最终一致；分享保留至手动删除，资源缓存使用 TTL。
 */
import { KV_PREFIX } from '#/shared/constants'
import { isTokenExpired } from '#/shared/token'
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
  // 有效期只控制访问权限，保留记录供查看与手动删除。
  await kvPut(kv, `${KV_PREFIX.token}${token.id}`, token)
}

export async function deleteToken(kv: KVNamespace, id: string): Promise<void> {
  await kvDelete(kv, `${KV_PREFIX.token}${id}`)
}

/** 重命名保留既有分享链接、有效期与使用次数；分页覆盖全部绑定。 */
export async function renameTokenTargets(
  kv: KVNamespace,
  type: 'sub' | 'collection',
  oldName: string,
  newName: string,
): Promise<void> {
  let cursor: string | undefined
  do {
    const page = await kv.list({ prefix: KV_PREFIX.token, cursor })
    for (const key of page.keys) {
      const token = await kvGet<TokenItem>(kv, key.name)
      if (token?.type !== type || token.name !== oldName) continue
      await saveToken(kv, { ...token, name: newName })
    }
    cursor = page.list_complete ? undefined : page.cursor
  } while (cursor)
}

export async function listTokens(kv: KVNamespace): Promise<TokenItem[]> {
  const items: TokenItem[] = []
  let cursor: string | undefined
  do {
    const page = await kv.list({ prefix: KV_PREFIX.token, cursor })
    for (const key of page.keys) {
      const token = await getToken(kv, key.name.slice(KV_PREFIX.token.length))
      if (!token) continue
      // 兼容旧记录：取消仍存在的 KV 自动删除期限。
      if (key.expiration != null) await saveToken(kv, token)
      items.push(token)
    }
    cursor = page.list_complete ? undefined : page.cursor
  } while (cursor)
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
  if (isTokenExpired(token)) return null
  if (token.count != null) {
    const used = token.usedCount ?? 0
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
