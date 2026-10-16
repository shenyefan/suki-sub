/** D1 条件写入保证不同请求、不同边缘实例不会同时发送同类提醒。 */
export const NOTIFICATION_COOLDOWN_DDL = `
CREATE TABLE IF NOT EXISTS notification_cooldowns (
  key TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
)`

export async function claimNotification(
  db: D1Database,
  key: string,
  now = Date.now(),
): Promise<boolean> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(key),
  )
  const hash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
  await db.prepare(NOTIFICATION_COOLDOWN_DDL).run()
  await db
    .prepare('DELETE FROM notification_cooldowns WHERE expires_at <= ?')
    .bind(now)
    .run()
  const result = await db
    .prepare(
      `INSERT INTO notification_cooldowns (key, expires_at) VALUES (?1, ?2)
       ON CONFLICT(key) DO UPDATE SET expires_at = excluded.expires_at
       WHERE notification_cooldowns.expires_at <= ?3
       RETURNING key`,
    )
    .bind(hash, now + 30 * 60 * 1000, now)
    .first()
  return result != null
}
