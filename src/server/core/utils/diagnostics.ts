import { BaseError, NetworkError, errorFields } from '../errors'

/** Redact credentials without changing the actual request. */
export function redactDiagnostic(value: unknown): string {
  return String(value ?? '')
    .replace(/https?:\/\/[^\s"'<>\\]+/gi, (link) => {
      const match = link.match(/^(https?:\/\/)([^/?#]+)(.*)$/i)
      if (!match) return 'xxx'
      const [, scheme, authority, rest] = match
      const host = authority.slice(authority.lastIndexOf('@') + 1)
      // Keep repeated sanitization stable; never expose a complete short path.
      if (/^\/xxx.{0,4}$/.test(rest)) return `${scheme}${host}${rest}`
      const tail = rest.length > 5 ? rest.slice(-4) : ''
      return `${scheme}${host}/xxx${tail}`
    })
    .replace(
      /([?&#](?:token|access_token|auth|authorization|key|api[_-]?key|password|passwd|secret|age-secret-key)=)[^&#\s"'<>]+/gi,
      '$1***',
    )
    .replace(
      /("(?:authorization|cookie|set-cookie|token|password|age-secret-key)"\s*:\s*")[^"]*/gi,
      '$1***',
    )
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1***@')
    .replace(
      /\bAGE-SECRET-KEY(?:-PQ)?-1[023456789ACDEFGHJKLMNPQRSTUVWXYZ]+\b/g,
      'AGE-SECRET-KEY-***',
    )
}

export function upstreamHttpError(
  status: number,
  url: string,
  userAgent: string,
  headers: Record<string, string>,
) {
  const reason =
    status === 403
      ? '上游拒绝访问'
      : status === 401
        ? '上游认证失败'
        : status === 429
          ? '上游请求过于频繁'
          : '上游返回错误'
  return new NetworkError(
    'UPSTREAM_HTTP_ERROR',
    `HTTP ${status}（${reason}）`,
    {
      status,
      url: redactDiagnostic(url),
      userAgent,
      ...(headers['cf-ray'] ? { requestId: headers['cf-ray'] } : {}),
      ...(headers['cf-mitigated']
        ? { mitigation: headers['cf-mitigated'] }
        : {}),
    },
  )
}

export function downloadError(
  error: unknown,
  url: string,
  userAgent: string,
): BaseError {
  if (error instanceof BaseError) return error
  const timeout =
    error instanceof Error &&
    ['TimeoutError', 'AbortError'].includes(error.name)
  return new NetworkError(
    timeout ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_REQUEST_FAILED',
    timeout ? '上游请求超时' : '无法连接上游资源',
    {
      url: redactDiagnostic(url),
      userAgent,
      reason: redactDiagnostic(error instanceof Error ? error.message : error),
    },
  )
}

export function resourceFailure(
  label: string,
  errors: Record<string, unknown>,
): BaseError {
  const failures = Object.entries(errors).flatMap<Record<string, unknown>>(
    ([source, error]) => {
      if (error instanceof BaseError && Array.isArray(error.failures))
        return (error.failures as Record<string, unknown>[]).map((failure) => ({
          ...failure,
          ...(label.startsWith('订阅') ? { subscription: label } : {}),
        }))
      return [
        {
          ...(error instanceof BaseError ? errorFields(error) : {}),
          source:
            error instanceof BaseError && error.source
              ? error.source
              : redactDiagnostic(source),
          ...(label.startsWith('订阅') ? { subscription: label } : {}),
          code:
            error instanceof BaseError ? error.code : 'UPSTREAM_REQUEST_FAILED',
          message: redactDiagnostic(
            error instanceof Error ? error.message : error,
          ),
        },
      ]
    },
  )
  const key = label.startsWith('组合') ? 'collection' : 'subscription'
  if (failures.length === 1) {
    const { code, message, ...fields } = failures[0]
    // 保留原因，补充所属资源；不再将子错误塞进新的 message 或 details。
    const existing = Object.values(errors)[0]
    const error =
      existing instanceof BaseError
        ? existing
        : new NetworkError(String(code), String(message), fields)
    Object.assign(error, fields, { [key]: label })
    if (error.source === error.url) delete error.source
    return error
  }
  return new NetworkError(
    'RESOURCE_SOURCES_FAILED',
    `${failures.length} 个来源处理失败`,
    { [key]: label, failures },
  )
}
