/** 分享记录仅由 D1 统一读写；历史 KV 数据通过一次性迁移导入。 */
import { isTokenExpired } from '#/shared/token'
import type { TokenItem } from '#/shared/types'

export const TOKEN_DDL = `
CREATE TABLE IF NOT EXISTS share_tokens (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('sub', 'collection')),
  name TEXT NOT NULL,
  created_at INTEGER,
  end_at INTEGER,
  max_count INTEGER,
  used_count INTEGER NOT NULL DEFAULT 0,
  extra TEXT NOT NULL DEFAULT '{}'
)`

interface TokenRow {
  id: string
  type: TokenItem['type']
  name: string
  created_at: number | null
  end_at: number | null
  max_count: number | null
  used_count: number
  extra: string
}

function rowToToken(row: TokenRow): TokenItem | null {
  if (!['sub', 'collection'].includes(row.type) || !row.name) return null
  return {
    ...JSON.parse(row.extra),
    id: row.id,
    type: row.type,
    name: row.name,
    ...(row.created_at != null ? { createdAt: row.created_at } : {}),
    ...(row.end_at != null ? { endAt: row.end_at } : {}),
    ...(row.max_count != null
      ? { count: row.max_count, usedCount: row.used_count }
      : {}),
  }
}

async function ensureTokenSchema(db: D1Database): Promise<void> {
  await db.prepare(TOKEN_DDL).run()
}

export async function getToken(
  env: Env,
  id: string,
): Promise<TokenItem | null> {
  const db = env.SUKI_SUB_DB
  await ensureTokenSchema(db)
  const row = await db
    .prepare('SELECT * FROM share_tokens WHERE id=?1')
    .bind(id)
    .first<TokenRow>()
  return row ? rowToToken(row) : null
}

export async function saveToken(env: Env, token: TokenItem): Promise<void> {
  await ensureTokenSchema(env.SUKI_SUB_DB)
  const { id, type, name, createdAt, endAt, count, usedCount, ...extra } = token
  await env.SUKI_SUB_DB.prepare(
    `INSERT INTO share_tokens
       (id, type, name, created_at, end_at, max_count, used_count, extra)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
  )
    .bind(
      id,
      type,
      name,
      createdAt ?? null,
      endAt ?? null,
      count ?? null,
      usedCount ?? 0,
      JSON.stringify(extra),
    )
    .run()
}

export async function deleteToken(env: Env, id: string): Promise<void> {
  const db = env.SUKI_SUB_DB
  await ensureTokenSchema(db)
  await db.prepare('DELETE FROM share_tokens WHERE id=?1').bind(id).run()
}

export async function listTokens(env: Env): Promise<TokenItem[]> {
  await ensureTokenSchema(env.SUKI_SUB_DB)
  const { results } = await env.SUKI_SUB_DB.prepare(
    'SELECT * FROM share_tokens ORDER BY created_at DESC, id',
  ).all<TokenRow>()
  return results.map(rowToToken).filter((token) => token != null)
}

/** 条件更新与次数递增在同一 SQL 中执行，避免并发访问突破次数限制。 */
export async function consumeToken(
  env: Env,
  id: string,
  expect: { type: string; name: string },
): Promise<TokenItem | null> {
  const token = await getToken(env, id)
  if (!token || token.type !== expect.type || token.name !== expect.name)
    return null
  if (isTokenExpired(token)) return null
  if (token.count == null) return token
  const row = await env.SUKI_SUB_DB.prepare(
    `UPDATE share_tokens
       SET used_count=used_count + 1
       WHERE id=?1 AND type=?2 AND name=?3
         AND (end_at IS NULL OR end_at>?4)
         AND max_count IS NOT NULL AND used_count<max_count
       RETURNING *`,
  )
    .bind(id, expect.type, expect.name, Date.now())
    .first<TokenRow>()
  return row ? rowToToken(row) : null
}
