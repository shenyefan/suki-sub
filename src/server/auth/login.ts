/**
 * OIDC 登录流(公共路由,供前端浏览器使用):
 * - GET /auth/login    → 302 到 IdP 授权端点(授权码 + PKCE S256)
 * - GET /auth/callback → 兑换 token,写入 HttpOnly 会话 cookie
 * - GET /auth/logout   → 清除会话 cookie
 * - GET /auth/session  → 会话状态;access token 过期时尝试用 refresh token 续期
 *
 * 会话 cookie(同源 SameSite=Lax,HttpOnly):
 * - su_at   access token(Max-Age = expires_in)
 * - su_rt   refresh token(存在才写,30 天)
 * - su_user userinfo 摘要(展示用)
 *
 * 另导出 oidcMiddleware:/api/* 的会话校验中间件(Bearer 优先,浏览器回退会话 cookie)。
 */
import { Hono } from 'hono'
import type { Context, Next } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { verifyAccessToken, verifyIdToken, verifyUserInfoToken } from './oidc'
import { failureResponse } from '../api/http'
import { discover } from './discovery'
import { setAuditActor } from '../store/request-audit'

const SESSION_COOKIE = 'su_at'
const REFRESH_COOKIE = 'su_rt'
const USER_COOKIE = 'su_user'
const ID_COOKIE = 'su_id'
const FLOW_COOKIE = 'su_auth'
const REFRESH_MAX_AGE = 60 * 60 * 24 * 30

function b64url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function sha256B64url(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(input),
  )
  return b64url(new Uint8Array(digest))
}

function originOf(url: URL): string {
  // 反代场景信任 x-forwarded-host / proto
  const proto = url.protocol === 'https:' ? 'https' : 'http'
  return `${proto}://${url.host}`
}

function baseCookieOptions(url: URL) {
  return {
    httpOnly: true,
    sameSite: 'Lax' as const,
    secure: url.protocol === 'https:',
    path: '/',
  }
}

interface TokenSet {
  access_token: string
  id_token?: string
  refresh_token?: string
  expires_in?: number
}

/**
 * 用授权码或 refresh token 向 IdP 兑换。
 * 机密客户端:优先 HTTP Basic 认证,IdP 拒绝(client_secret_post 型)时回退表单提交;
 * 公共客户端(无 secret)纯 PKCE。PKCE S256 始终启用。
 */
async function exchangeTokens(
  tokenEndpoint: string,
  clientId: string,
  clientSecret: string | undefined,
  params: Record<string, string>,
  methods: string[] = ['client_secret_basic', 'client_secret_post'],
): Promise<TokenSet | null> {
  const body = new URLSearchParams({ ...params })
  const parse = async (res: Response) => {
    if (!res.ok) return null
    const data: TokenSet | null = await res.json()
    return data?.access_token ? data : null
  }

  if (clientSecret && !methods.includes('client_secret_basic')) {
    if (!methods.includes('client_secret_post')) return null
    return parse(
      await fetch(tokenEndpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          ...params,
          client_id: clientId,
          client_secret: clientSecret,
        }),
      }),
    )
  }
  if (clientSecret) {
    const basic = btoa(
      `${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`,
    )
    const res = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Basic ${basic}`,
      },
      body,
    })
    const data = await parse(res)
    if (data) return data
    if (
      ![400, 401].includes(res.status) ||
      !methods.includes('client_secret_post')
    )
      return null
    // 客户端注册为 client_secret_post:改用表单提交重试
    const retryBody = new URLSearchParams({
      ...params,
      client_id: clientId,
      client_secret: clientSecret,
    })
    return parse(
      await fetch(tokenEndpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: retryBody,
      }),
    )
  }

  const res = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...params, client_id: clientId }),
  })
  return parse(res)
}

function writeSessionCookies(
  c: { env: Env & LoginEnv; req: { url: string } },
  tokens: TokenSet,
) {
  const url = new URL(c.req.url)
  const opts = baseCookieOptions(url)
  setCookie(c as never, SESSION_COOKIE, tokens.access_token, {
    ...opts,
    maxAge: tokens.expires_in ?? 3600,
  })
  if (tokens.id_token)
    setCookie(c as never, ID_COOKIE, tokens.id_token, {
      ...opts,
      maxAge: REFRESH_MAX_AGE,
    })
  if (tokens.refresh_token) {
    setCookie(c as never, REFRESH_COOKIE, tokens.refresh_token, {
      ...opts,
      maxAge: REFRESH_MAX_AGE,
    })
  }
}

function summaryFromClaims(info: Record<string, unknown>) {
  if (typeof info.sub !== 'string' || !info.sub)
    throw new Error('用户信息缺少用户标识')
  let picture: string | null = null
  if (typeof info.picture === 'string') {
    try {
      const url = new URL(info.picture)
      if (['https:', 'http:'].includes(url.protocol)) picture = url.href
    } catch {
      /* Invalid avatars fall back to initials. */
    }
  }
  return {
    sub: info.sub,
    name:
      typeof info.name === 'string'
        ? info.name
        : typeof info.preferred_username === 'string'
          ? info.preferred_username
          : null,
    email: typeof info.email === 'string' ? info.email : null,
    picture,
  }
}

async function fetchUserSummary(
  issuer: string,
  clientId: string,
  accessToken: string,
  claims: Record<string, unknown>,
) {
  const doc = await discover(issuer)
  if (!doc.userinfo_endpoint) return summaryFromClaims(claims)
  const response = await fetch(doc.userinfo_endpoint, {
    headers: { authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) throw new Error('无法获取用户信息')
  const info = response.headers.get('content-type')?.includes('application/jwt')
    ? await verifyUserInfoToken(await response.text(), issuer, clientId)
    : await response.json<Record<string, unknown>>()
  if (info.sub !== claims.sub) throw new Error('用户信息与登录身份不匹配')
  return summaryFromClaims({ ...claims, ...info })
}

function writeUserCookie(
  c: { req: { url: string } },
  user: Record<string, unknown>,
) {
  setCookie(c as never, USER_COOKIE, JSON.stringify(user), {
    ...baseCookieOptions(new URL(c.req.url)),
    maxAge: REFRESH_MAX_AGE,
  })
}

export interface SessionStatus {
  authenticated: boolean
  user?: {
    sub?: string
    name?: string | null
    email?: string | null
    picture?: string | null
  }
}

/** 校验 access token 并读取会话状态;过期时尝试 refresh(成功则回写 cookie) */
export interface LoginEnv {
  OIDC_ISSUER?: string
  OIDC_AUDIENCE?: string
  /** 机密客户端的 secret;公共客户端(PKCE)省略 */
  OIDC_CLIENT_SECRET?: string
}

export async function readSession(
  c: { env: Env & LoginEnv; req: { url: string } },
  allowRefresh = true,
): Promise<SessionStatus> {
  const { OIDC_ISSUER, OIDC_AUDIENCE, OIDC_CLIENT_SECRET } = c.env
  if (!OIDC_ISSUER || !OIDC_AUDIENCE) return { authenticated: false }
  const accessToken = getCookie(c as never, SESSION_COOKIE)
  const idToken = getCookie(c as never, ID_COOKIE)
  let identity: Record<string, unknown> | null = null
  if (accessToken) {
    identity = await verifyAccessToken(accessToken, OIDC_ISSUER, OIDC_AUDIENCE)
    if (!identity && idToken) {
      try {
        identity = await verifyIdToken(idToken, OIDC_ISSUER, OIDC_AUDIENCE, {
          accessToken,
        })
      } catch {
        identity = null
      }
    }
    if (identity) {
      try {
        const user = await fetchUserSummary(
          OIDC_ISSUER,
          OIDC_AUDIENCE,
          accessToken,
          identity,
        )
        writeUserCookie(c, user)
        return { authenticated: true, user }
      } catch {
        /* Try refreshing expired or revoked credentials. */
      }
    }
  }
  if (!allowRefresh) return { authenticated: false }
  const refreshToken = getCookie(c as never, REFRESH_COOKIE)
  if (!refreshToken) return { authenticated: false }
  try {
    const doc = await discover(OIDC_ISSUER)
    const tokens = await exchangeTokens(
      doc.token_endpoint,
      OIDC_AUDIENCE,
      OIDC_CLIENT_SECRET,
      {
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      },
      doc.token_endpoint_auth_methods_supported,
    )
    if (!tokens) return { authenticated: false }
    // Verify subject continuity against the previous signed identity, even if it expired.
    const old = idToken
      ? await verifyIdToken(idToken, OIDC_ISSUER, OIDC_AUDIENCE, {
          allowExpired: true,
        })
      : identity
    const claims = tokens.id_token
      ? await verifyIdToken(tokens.id_token, OIDC_ISSUER, OIDC_AUDIENCE, {
          accessToken: tokens.access_token,
          sub: typeof old?.sub === 'string' ? old.sub : undefined,
        })
      : await verifyAccessToken(tokens.access_token, OIDC_ISSUER, OIDC_AUDIENCE)
    if (!claims || (old?.sub && claims.sub !== old.sub))
      return { authenticated: false }
    const user = await fetchUserSummary(
      OIDC_ISSUER,
      OIDC_AUDIENCE,
      tokens.access_token,
      claims,
    )
    writeSessionCookies(c, tokens)
    writeUserCookie(c, user)
    return { authenticated: true, user }
  } catch {
    return { authenticated: false }
  }
}

/**
 * /api/* 会话校验中间件:脚本调用走 `Authorization: Bearer <access_token>`,
 * 浏览器会话(/auth/login 建立)走 HttpOnly cookie。
 */
export function oidcMiddleware() {
  return async (c: Context<{ Bindings: Env & LoginEnv }>, next: Next) => {
    const { OIDC_ISSUER, OIDC_AUDIENCE } = c.env
    if (!OIDC_ISSUER || !OIDC_AUDIENCE) {
      return failureResponse(c, 'OIDC_NOT_CONFIGURED', '登录服务未配置', 503)
    }
    const auth = c.req.header('authorization') ?? ''
    const token = auth.startsWith('Bearer ')
      ? auth.slice(7).trim()
      : (getCookie(c as never, 'su_at') ?? '')
    if (!token) {
      return failureResponse(c, 'UNAUTHORIZED', '请先登录', 401)
    }
    const payload = await verifyAccessToken(token, OIDC_ISSUER, OIDC_AUDIENCE)
    if (!payload && !auth.startsWith('Bearer ')) {
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

const app = new Hono<{ Bindings: Env & LoginEnv }>()

app.get('/auth/login', async (c) => {
  const { OIDC_ISSUER, OIDC_AUDIENCE } = c.env
  const url = new URL(c.req.url)
  if (!OIDC_ISSUER || !OIDC_AUDIENCE) {
    return failureResponse(c, 'OIDC_NOT_CONFIGURED', '登录服务未配置', 503)
  }
  const doc = await discover(OIDC_ISSUER)
  if (!doc.authorization_endpoint) {
    return failureResponse(c, 'OIDC_DISCOVERY_FAILED', '无法连接登录服务', 502)
  }
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)))
  const state = b64url(crypto.getRandomValues(new Uint8Array(24)))
  const nonce = b64url(crypto.getRandomValues(new Uint8Array(24)))
  setCookie(
    c,
    FLOW_COOKIE,
    JSON.stringify({ verifier, state, nonce, expiresAt: Date.now() + 600000 }),
    {
      ...baseCookieOptions(url),
      maxAge: 600,
    },
  )
  const redirectUri = `${originOf(url)}/auth/callback`
  const challenge = await sha256B64url(verifier)
  const authorizeUrl = new URL(doc.authorization_endpoint)
  authorizeUrl.searchParams.set('response_type', 'code')
  authorizeUrl.searchParams.set('client_id', OIDC_AUDIENCE)
  authorizeUrl.searchParams.set('redirect_uri', redirectUri)
  authorizeUrl.searchParams.set('scope', 'openid profile email offline_access')
  authorizeUrl.searchParams.set('state', state)
  authorizeUrl.searchParams.set('nonce', nonce)
  authorizeUrl.searchParams.set('code_challenge', challenge)
  authorizeUrl.searchParams.set('code_challenge_method', 'S256')
  return c.redirect(authorizeUrl.toString())
})

app.get('/auth/callback', async (c) => {
  const { OIDC_ISSUER, OIDC_AUDIENCE, OIDC_CLIENT_SECRET } = c.env
  const url = new URL(c.req.url)
  const fail = (code: string, message: string) =>
    failureResponse(c, code, message, 400)
  if (!OIDC_ISSUER || !OIDC_AUDIENCE)
    return fail(
      'OIDC_NOT_CONFIGURED',
      'Set OIDC_ISSUER and OIDC_AUDIENCE vars to enable login.',
    )

  const error = url.searchParams.get('error')
  if (error)
    return fail(
      'OIDC_PROVIDER_ERROR',
      url.searchParams.get('error_description') ?? error,
    )

  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const flowRaw = getCookie(c, FLOW_COOKIE)
  if (!code) return fail('INVALID_CALLBACK', 'missing code')
  let flow: {
    verifier?: string
    state?: string
    nonce?: string
    expiresAt?: number
  } = {}
  try {
    flow = flowRaw ? JSON.parse(flowRaw) : {}
  } catch {
    flow = {}
  }
  if (
    !flow.verifier ||
    !flow.state ||
    !flow.nonce ||
    !flow.expiresAt ||
    flow.expiresAt < Date.now() ||
    flow.state !== state
  ) {
    return fail('INVALID_CALLBACK', 'state mismatch')
  }
  deleteCookie(c, FLOW_COOKIE, { path: '/' })

  const doc = await discover(OIDC_ISSUER)
  if (!doc.token_endpoint)
    return fail('OIDC_DISCOVERY_FAILED', 'cannot discover token endpoint')
  const tokens = await exchangeTokens(
    doc.token_endpoint,
    OIDC_AUDIENCE,
    OIDC_CLIENT_SECRET,
    {
      grant_type: 'authorization_code',
      code,
      redirect_uri: `${originOf(url)}/auth/callback`,
      code_verifier: flow.verifier,
    },
    doc.token_endpoint_auth_methods_supported,
  )
  if (!tokens)
    return fail(
      'OIDC_TOKEN_EXCHANGE_FAILED',
      'token endpoint rejected the request',
    )

  if (!tokens.id_token)
    return fail('INVALID_ID_TOKEN', '登录服务未返回 ID Token')
  try {
    const claims = await verifyIdToken(
      tokens.id_token,
      OIDC_ISSUER,
      OIDC_AUDIENCE,
      {
        nonce: flow.nonce,
        accessToken: tokens.access_token,
      },
    )
    const user = await fetchUserSummary(
      OIDC_ISSUER,
      OIDC_AUDIENCE,
      tokens.access_token,
      claims,
    )
    writeSessionCookies(c, tokens)
    writeUserCookie(c, user)
    setAuditActor(c, user)
  } catch {
    return fail('INVALID_IDENTITY', '无法验证登录身份或用户信息')
  }
  return c.redirect('/')
})

app.get('/auth/logout', async (c) => {
  const session = await readSession(c, false)
  if (session.user) setAuditActor(c, session.user)
  const idToken = getCookie(c, ID_COOKIE)
  for (const name of [
    SESSION_COOKIE,
    REFRESH_COOKIE,
    USER_COOKIE,
    ID_COOKIE,
    FLOW_COOKIE,
  ]) {
    deleteCookie(c, name, { path: '/' })
  }
  if (c.env.OIDC_ISSUER) {
    try {
      const doc = await discover(c.env.OIDC_ISSUER)
      if (doc.end_session_endpoint) {
        const endpoint = new URL(doc.end_session_endpoint)
        if (idToken) endpoint.searchParams.set('id_token_hint', idToken)
        if (c.env.OIDC_AUDIENCE)
          endpoint.searchParams.set('client_id', c.env.OIDC_AUDIENCE)
        return c.redirect(endpoint.toString())
      }
    } catch {
      /* Local cookies are still cleared if the provider is unavailable. */
    }
  }
  return c.redirect('/')
})

app.get('/auth/session', async (c) => c.json(await readSession(c)))

export default app
