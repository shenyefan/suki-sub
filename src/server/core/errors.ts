/**
 * 引擎层错误类型。
 */
export class BaseError extends Error {
  code: string
  message: string;
  [key: string]: unknown
  type = 'BaseError'

  constructor(code: string, message: string, fields?: unknown) {
    super(message)
    this.code = code
    this.message = message
    if (fields && typeof fields === 'object')
      for (const [key, value] of Object.entries(fields))
        if (
          !['code', 'message', 'name', 'stack', 'type', 'cause'].includes(key)
        )
          this[key] = value
    if (Array.isArray(this.issues) && this.issues.length === 1) {
      const issue = this.issues[0] as Record<string, unknown>
      delete this.issues
      Object.assign(this, issue)
    } else if (Array.isArray(this.issues) && this.issues.length > 1) {
      this.message = `${this.issues.length} 项配置存在问题`
    }
  }
}

export class InternalServerError extends BaseError {
  constructor(code: string, message: string, fields?: unknown) {
    super(code, message, fields)
    this.type = 'InternalServerError'
  }
}

export class RequestInvalidError extends BaseError {
  constructor(code: string, message: string, fields?: unknown) {
    super(code, message, fields)
    this.type = 'RequestInvalidError'
  }
}

export class ResourceNotFoundError extends BaseError {
  constructor(code: string, message: string, fields?: unknown) {
    super(code, message, fields)
    this.type = 'ResourceNotFoundError'
  }
}

export class NetworkError extends BaseError {
  constructor(code: string, message: string, fields?: unknown) {
    super(code, message, fields)
    this.type = 'NetworkError'
  }
}

/** 传递业务上下文，排除 Error 的运行时字段。 */
export function errorFields(error: BaseError): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(error).filter(
      ([key]) =>
        !['code', 'message', 'name', 'stack', 'type', 'cause'].includes(key),
    ),
  )
}

/** Workers RPC 和脚本 VM 的 Error 可能来自另一运行域，不能只靠 instanceof。 */
export function errorMessage(error: unknown): string {
  if (
    error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof error.message === 'string'
  )
    return error.message
  return String(error)
}
