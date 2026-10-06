export interface OidcDiscovery {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  jwks_uri: string
  userinfo_endpoint?: string
  end_session_endpoint?: string
  token_endpoint_auth_methods_supported?: string[]
  id_token_signing_alg_values_supported?: string[]
}

const cache = new Map<
  string,
  { until: number; value: Promise<OidcDiscovery> }
>()

/** Await discovery before verifying a token; failed discovery can be retried. */
export async function discover(issuer: string): Promise<OidcDiscovery> {
  const cached = cache.get(issuer)
  if (cached && cached.until > Date.now()) return cached.value
  const value = (async () => {
    const response = await fetch(
      `${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`,
    )
    if (!response.ok) throw new Error('无法获取登录服务配置')
    const document = await response.json<OidcDiscovery>()
    if (document.issuer !== issuer) throw new Error('登录服务 issuer 不匹配')
    for (const endpoint of [
      document.authorization_endpoint,
      document.token_endpoint,
      document.jwks_uri,
      document.userinfo_endpoint,
    ].filter(Boolean)) {
      const url = new URL(endpoint!)
      if (!['https:', 'http:'].includes(url.protocol))
        throw new Error('登录服务端点无效')
    }
    return document
  })()
  cache.set(issuer, { until: Date.now() + 300000, value })
  value.catch(() => cache.delete(issuer))
  return value
}
