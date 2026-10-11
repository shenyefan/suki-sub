/**
 * 同源 API 客户端:统一错误形状 {code,message,...context} 解析;
 * 401 时先尝试 /auth/session(可能刷新 cookie),恢复后重试一次。
 */
import { ApiRoutes, AuthRoutes } from '#/shared/api-contract'

export class ApiError extends Error {
  code: string
  httpStatus: number;
  [key: string]: unknown
  constructor(
    code: string,
    message: string,
    httpStatus: number,
    fields?: Record<string, unknown>,
  ) {
    super(message)
    this.code = code
    this.httpStatus = httpStatus
    if (fields)
      for (const [key, value] of Object.entries(fields))
        if (!['code', 'message', 'httpStatus', 'stack', 'name'].includes(key))
          this[key] = value
  }
}

async function parseError(res: Response): Promise<ApiError> {
  try {
    const body: Record<string, unknown> = await res.json()
    return new ApiError(
      typeof body.code === 'string' ? body.code : 'UNKNOWN',
      typeof body.message === 'string' ? body.message : res.statusText,
      res.status,
      body,
    )
  } catch {
    return new ApiError('UNKNOWN', res.statusText, res.status)
  }
}

async function rawRequest(
  method: string,
  url: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<Response> {
  const init: RequestInit = {
    method,
    headers: { accept: 'application/json' },
    signal,
    cache: 'no-store',
  }
  if (body !== undefined) {
    init.headers = {
      accept: 'application/json',
      'content-type': 'application/json',
    }
    init.body = JSON.stringify(body)
  }
  return fetch(url, init)
}

export interface SessionStatus {
  authenticated: boolean
  user?: {
    name?: string | null
    email?: string | null
    picture?: string | null
  }
}

export async function fetchSession(): Promise<SessionStatus> {
  const res = await fetch(AuthRoutes.session, {
    headers: { accept: 'application/json' },
  })
  return res.json()
}

export async function apiRequest<T = unknown>(
  method: string,
  url: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  let res = await rawRequest(method, url, body, signal)
  // 会话可能刚过期:session 端点会尝试刷新 cookie,成功后重试一次
  if (res.status === 401) {
    const session = await fetchSession()
    if (session.authenticated) res = await rawRequest(method, url, body, signal)
  }
  if (!res.ok) throw await parseError(res)
  const text = await res.text()
  try {
    return JSON.parse(text) as T
  } catch {
    return text as unknown as T
  }
}

export const api = {
  get: <T = unknown>(url: string, signal?: AbortSignal) =>
    apiRequest<T>('GET', url, undefined, signal),
  post: <T = unknown>(url: string, body?: unknown) =>
    apiRequest<T>('POST', url, body),
  patch: <T = unknown>(url: string, body?: unknown) =>
    apiRequest<T>('PATCH', url, body),
  put: <T = unknown>(url: string, body?: unknown) =>
    apiRequest<T>('PUT', url, body),
  del: <T = unknown>(url: string) => apiRequest<T>('DELETE', url),
}

/** 下载链接(订阅客户端使用):基于当前 origin 拼绝对地址 */
export function absoluteUrl(path: string): string {
  if (typeof window === 'undefined') return path
  return new URL(path, window.location.origin).toString()
}

export function shareUrl(id: string, target?: string): string {
  return absoluteUrl(ApiRoutes.shareDownload(id, target))
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
