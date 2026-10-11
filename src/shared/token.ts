import type { TokenItem } from './types'

/** 时间到期或次数用尽的分享仍保留记录，但不可继续访问。 */
export function isTokenExpired(token: TokenItem, now = Date.now()): boolean {
  return (
    (token.endAt != null && token.endAt <= now) ||
    (token.count != null && (token.usedCount ?? 0) >= token.count)
  )
}
