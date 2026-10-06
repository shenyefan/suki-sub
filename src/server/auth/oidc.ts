/**
 * /api/* 管理接口的 OIDC 校验。
 *
 * 配置(wrangler.jsonc vars 或 .dev.vars):
 * - OIDC_ISSUER:如 https://accounts.google.com
 * - OIDC_AUDIENCE:OIDC client id
 *
 * 请求携带 `Authorization: Bearer <access_token>`,用 jose 的远程 JWKS 验签,
 * 校验 iss / aud / exp。JWKS 按 issuer 进程内缓存(jose 自带)。
 */
import { createRemoteJWKSet, jwtVerify, decodeJwt } from 'jose'
import { getCookie } from 'hono/cookie'
import { failureResponse } from '../api/http'
import { discover } from './discovery'
import type { Context, Next } from 'hono'
import { setAuditActor } from '../store/request-audit'

interface OidcEnv {
  OIDC_ISSUER?: string
  OIDC_AUDIENCE?: string
}

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>()

export async function getJwks(issuer: string) {
  const doc = await discover(issuer)
  const cacheKey = issuer + '|' + doc.jwks_uri
  let jwks = jwksCache.get(cacheKey)
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(doc.jwks_uri))
    jwksCache.set(cacheKey, jwks)
  }
  return jwks
}

/** Validate the authorization-code ID token, including nonce and access-token binding. */
export async function verifyIdToken(
  token: string,
  issuer: string,
  clientId: string,
  expected: {
    nonce?: string
    sub?: string
    accessToken?: string
    allowExpired?: boolean
  } = {},
) {
  const doc = await discover(issuer)
  const { payload, protectedHeader } = await jwtVerify(
    token,
    await getJwks(issuer),
    {
      issuer,
      audience: clientId,
      algorithms: doc.id_token_signing_alg_values_supported ?? ['RS256'],
      requiredClaims: ['sub', 'exp', 'iat'],
      // Refresh continuity still verifies the old signature, issuer and client.
      ...(expected.allowExpired
        ? { currentDate: new Date((Number(decodeJwt(token).iat) + 1) * 1000) }
        : {}),
    },
  )
  if (typeof payload.sub !== 'string' || !payload.sub)
    throw new Error('ID Token 缺少用户标识')
  if (typeof payload.iat !== 'number' || payload.iat > Date.now() / 1000 + 60)
    throw new Error('ID Token 签发时间无效')
  if (expected.nonce && payload.nonce !== expected.nonce)
    throw new Error('ID Token nonce 不匹配')
  if (expected.sub && payload.sub !== expected.sub)
    throw new Error('ID Token 用户标识不匹配')
  if (payload.azp != null && payload.azp !== clientId)
    throw new Error('ID Token 客户端不匹配')
  if (
    Array.isArray(payload.aud) &&
    payload.aud.length > 1 &&
    payload.azp !== clientId
  )
    throw new Error('ID Token 缺少客户端绑定')
  if (payload.at_hash != null && expected.accessToken) {
    const bits = protectedHeader.alg.match(/(256|384|512)$/)?.[1]
    if (!bits) throw new Error('ID Token 哈希算法不支持')
    const digest = new Uint8Array(
      await crypto.subtle.digest(
        'SHA-' + bits,
        new TextEncoder().encode(expected.accessToken),
      ),
    )
    const hash = btoa(
      String.fromCharCode(...digest.slice(0, digest.length / 2)),
    )
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
    if (payload.at_hash !== hash) throw new Error('ID Token 与访问令牌不匹配')
  }
  return payload
}

export async function verifyUserInfoToken(
  token: string,
  issuer: string,
  clientId: string,
) {
  const doc = await discover(issuer)
  const { payload } = await jwtVerify(token, await getJwks(issuer), {
    issuer,
    audience: clientId,
    algorithms: doc.id_token_signing_alg_values_supported ?? ['RS256'],
    requiredClaims: ['sub'],
  })
  return payload
}

/**
 * 校验 access token。aud 兼容两种 IdP 约定:
 * - aud = client_id(常见约定)
 * - aud = `${issuer}/userinfo`(suki-auth 等"自包含资源"型)
 * 并在声明存在时校验 client_id / token_use,防止误用 id token。
 */
export async function verifyAccessToken(
  token: string,
  issuer: string,
  clientId: string,
): Promise<Record<string, unknown> | null> {
  try {
    const { payload, protectedHeader } = await jwtVerify(
      token,
      await getJwks(issuer),
      {
        issuer,
        audience: [clientId, `${issuer.replace(/\/$/, '')}/userinfo`],
      },
    )
    if (typeof payload.sub !== 'string' || !payload.sub) return null
    if (payload.client_id != null && payload.client_id !== clientId) return null
    if (
      payload.aud === `${issuer.replace(/\/$/, '')}/userinfo` &&
      payload.client_id !== clientId
    )
      return null
    if (payload.token_use != null && payload.token_use !== 'access') return null
    if (
      payload.token_use !== 'access' &&
      protectedHeader.typ !== 'at+jwt' &&
      typeof payload.scope !== 'string'
    )
      return null
    return payload
  } catch {
    return null
  }
}

export function oidcMiddleware() {
  return async (c: Context<{ Bindings: Env & OidcEnv }>, next: Next) => {
    const { OIDC_ISSUER, OIDC_AUDIENCE } = c.env
    if (!OIDC_ISSUER || !OIDC_AUDIENCE) {
      return failureResponse(c, 'OIDC_NOT_CONFIGURED', '登录服务未配置', 503)
    }
    const auth = c.req.header('authorization') ?? ''
    // 浏览器会话(/auth/login 建立)走 HttpOnly cookie;脚本调用走 Bearer
    const token = auth.startsWith('Bearer ')
      ? auth.slice(7).trim()
      : (getCookie(c as never, 'su_at') ?? '')
    if (!token) {
      return failureResponse(c, 'UNAUTHORIZED', '请先登录', 401)
    }
    const payload = await verifyAccessToken(token, OIDC_ISSUER, OIDC_AUDIENCE)
    if (!payload && !auth.startsWith('Bearer ')) {
      const { readSession } = await import('./login')
      const session = await readSession(c)
      if (session.authenticated) {
        if (session.user) setAuditActor(c, session.user)
        await next()
        return
      }
    }
    if (!payload) {
      return failureResponse(c, 'UNAUTHORIZED', '登录已过期，请重新登录', 401)
    }
    c.set('oidcClaims' as never, payload as never)
    let identity = payload
    const idToken = !auth.startsWith('Bearer ')
      ? getCookie(c as never, 'su_id')
      : undefined
    if (idToken) {
      try {
        identity = await verifyIdToken(idToken, OIDC_ISSUER, OIDC_AUDIENCE, {
          sub: String(payload.sub),
          accessToken: token,
        })
      } catch {
        /* 已验证访问凭据，显示信息回退到其声明。 */
      }
    }
    setAuditActor(c, identity)
    await next()
  }
}
