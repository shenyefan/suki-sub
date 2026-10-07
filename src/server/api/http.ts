import { HTTPException } from 'hono/http-exception'
/** 所有后端错误共用的内容协商与平面响应。 */
import type { Context } from 'hono'
import { BaseError, errorFields, errorMessage } from '../core/errors'
import { redactDiagnostic } from '../core/utils/diagnostics'
import $ from '../core/app'
import { logOperation } from '../store/operation-logs'

function logResponseError(
  c: Context,
  message: string,
  fields: Record<string, unknown>,
) {
  const operation = logOperation(c.req.method, c.req.path)
  $.error(operation ? `${operation.label}失败` : message, {
    ...(operation
      ? {
          action: operation.action,
          resourceKind: operation.resourceKind,
          resourceName: operation.resourceName,
          reason: message,
        }
      : {}),
    ...(c.get('operationDetails' as never) as
      Record<string, unknown> | undefined),
    ...fields,
  })
}

/** 接受 HTML 的页面请求；通配 Accept 和浏览器 UA 本身不代表请求页面。 */
export function wantsErrorPage(c: Context): boolean {
  const accept = c.req.header('accept')
  if (!accept) return false
  const types = accept
    .toLowerCase()
    .split(',')
    .map((entry) => {
      const [type, ...params] = entry.trim().split(';')
      const q = params.find((value) => value.trim().startsWith('q='))
      const quality = q ? Number(q.trim().slice(2)) : 1
      return { type, quality: Number.isFinite(quality) ? quality : 0 }
    })
  const html = Math.max(
    0,
    ...types
      .filter((t) => ['text/html', 'application/xhtml+xml'].includes(t.type))
      .map((t) => t.quality),
  )
  const json = Math.max(
    0,
    ...types
      .filter((t) => t.type === 'application/json' || t.type.endsWith('+json'))
      .map((t) => t.quality),
  )
  return html > 0 && html >= json
}

function clean(value: unknown): unknown {
  if (typeof value === 'string') return redactDiagnostic(value)
  if (Array.isArray(value)) return value.map(clean)
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        /^(authorization|cookie|set-cookie|token|password|secret)$/i.test(key)
          ? '***'
          : clean(item),
      ]),
    )
  return value
}

function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (char) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[char]!,
  )
}

function errorPage(body: Record<string, unknown>): string {
  const labels: Record<string, string> = {
    subscription: '订阅',
    collection: '组合订阅',
    source: '来源',
    url: '链接',
    status: '上游状态码',
    userAgent: '请求 UA',
    reason: '原因',
    requestId: '请求编号',
    resourceDisplayName: '资源',
    resourceName: '资源名称',
    platform: '输出格式',
    configLine: '配置行',
    scriptLine: '脚本行',
    scriptColumn: '脚本列',
    operatorName: '操作',
    sourceLine: '来源行',
    invalidLines: '无法解析的行',
  }
  const rows = Object.entries(labels)
    .filter(
      ([key]) =>
        body[key] != null &&
        !(key === 'url' && body.url === body.source) &&
        !(key === 'resourceName' && body.resourceDisplayName),
    )
    .map(([key, label]) => `<dt>${label}</dt><dd>${escapeHtml(body[key])}</dd>`)
    .join('')
  const problems = Array.isArray(body.failures)
    ? body.failures
    : Array.isArray(body.issues)
      ? body.issues
      : []
  const list = problems.length
    ? `<ul>${problems
        .map((item) => {
          const issue = item as Record<string, unknown>
          return `<li>${escapeHtml(issue.resourceDisplayName || issue.subscription || issue.source || issue.resourceName || '')}<p>${escapeHtml(issue.message)}</p></li>`
        })
        .join('')}</ul>`
    : ''
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>请求失败 · SUKI SUB</title><style>
  :root{color-scheme:light dark;font-family:system-ui,sans-serif;background:light-dark(#fafafa,#0a0a0a);color:light-dark(#171717,#fafafa)}*{box-sizing:border-box}body{margin:0}main{min-height:100dvh;display:grid;place-items:center;padding:24px}.card{width:100%;max-width:560px;border:1px solid light-dark(#e5e5e5,#262626);border-radius:12px;padding:28px;background:light-dark(#fff,#111)}.brand,.code,dt{color:light-dark(#737373,#a3a3a3);font-size:12px}.brand{letter-spacing:.12em}h1{font-size:22px;margin:20px 0 10px}p{font-size:14px;line-height:1.6;overflow-wrap:anywhere}.code{margin-top:16px;font-family:monospace;overflow-wrap:anywhere}dl{display:grid;grid-template-columns:80px minmax(0,1fr);gap:10px;margin:24px 0;padding-top:20px;border-top:1px solid light-dark(#e5e5e5,#262626)}dd{font-size:13px;margin:0;overflow-wrap:anywhere}ul{font-size:13px;padding-left:20px;overflow-wrap:anywhere}nav{display:flex;gap:10px;margin-top:24px}a{font-size:13px;text-decoration:none;color:inherit;padding:8px 14px;border:1px solid light-dark(#ddd,#333);border-radius:6px}a:hover{background:light-dark(#f5f5f5,#262626)}@media(max-width:480px){main{padding:16px}.card{padding:22px}dl{grid-template-columns:64px minmax(0,1fr)}}
  </style></head><body><main><section class="card"><div class="brand">SUKI SUB</div><h1>请求未能完成</h1><p>${escapeHtml(body.message)}</p><div class="code">${escapeHtml(body.code)}</div>${rows ? `<dl>${rows}</dl>` : ''}${list}<nav><a href="/">返回首页</a><a href="">重试</a></nav></section></main></body></html>`
}

export function failureResponse(
  c: Context,
  code: string,
  message: string,
  status = 500,
  fields: Record<string, unknown> = {},
) {
  const body = clean({ ...fields, code, message }) as Record<string, unknown>
  c.header('Vary', 'Accept')
  c.header('Cache-Control', 'no-store')
  c.header('X-Content-Type-Options', 'nosniff')
  if (wantsErrorPage(c)) {
    c.header(
      'Content-Security-Policy',
      "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
    )
    return c.html(errorPage(body), status as 500)
  }
  return c.json(body, status as 500)
}

export function errorResponse(c: Context, err: unknown, fallbackStatus = 500) {
  if (err instanceof HTTPException) {
    if (err.status >= 500)
      logResponseError(c, err.message, {
        code: `HTTP_${err.status}`,
        httpStatus: err.status,
      })
    return failureResponse(c, `HTTP_${err.status}`, err.message, err.status)
  }
  if (err instanceof SyntaxError)
    return failureResponse(c, 'INVALID_REQUEST', '请求数据格式无效', 400)
  if (err instanceof BaseError) {
    const fields = errorFields(err)
    if (
      err.type === 'NetworkError' ||
      err.type === 'InternalServerError' ||
      [
        'OPERATOR_FAILED',
        'DNS_RESOLUTION_FAILED',
        'NODE_EXPORT_FAILED',
        'SCRIPT_SYNTAX_ERROR',
        'INVALID_CONFIG_TEMPLATE',
        'CONFIG_TARGET_UNSUPPORTED',
        'SUBSCRIPTION_PARSE_FAILED',
        'UPSTREAM_CONTENT_INVALID',
        'NO_USABLE_NODES',
        'RESOURCE_PROCESSING_FAILED',
      ].includes(err.code)
    )
      logResponseError(c, err.message, { code: err.code, ...fields })
    const status =
      err.type === 'ResourceNotFoundError'
        ? 404
        : err.type === 'RequestInvalidError'
          ? 400
          : err.type === 'NetworkError'
            ? 502
            : 500
    return failureResponse(c, err.code, err.message, status, fields)
  }
  const message = errorMessage(err)
  logResponseError(c, message, { code: 'INTERNAL' })
  return failureResponse(c, 'INTERNAL', message, fallbackStatus)
}
