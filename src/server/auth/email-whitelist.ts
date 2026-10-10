/** 环境变量支持逗号、分号或空白分隔；只匹配完整邮箱。 */
export function parseEmailWhitelist(value: string | undefined): Set<string> {
  return new Set(
    (value ?? '')
      .split(/[,;\s]+/)
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  )
}

/** 邮箱必须来自已验证的令牌或与其用户标识一致的 UserInfo。 */
export function isEmailAllowed(
  whitelist: Set<string>,
  email: unknown,
): boolean {
  return typeof email === 'string' && whitelist.has(email.trim().toLowerCase())
}
