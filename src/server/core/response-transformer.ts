/**
 * 响应转换器:产出后按 process 中的 Response Transformer 修改响应头/体/状态码。
 */
import { ProxyUtils } from '#/server/core/proxy-utils/index'

function getCurrentHeaders(res: any) {
  return typeof res.getHeaders === 'function' ? { ...res.getHeaders() } : {}
}

function setHeaders(res: any, currentHeaders: any, nextHeaders: any = {}) {
  for (const key of Object.keys(currentHeaders)) {
    if (!Object.prototype.hasOwnProperty.call(nextHeaders, key)) {
      res.removeHeader(key)
    }
  }
  for (const [key, value] of Object.entries(nextHeaders)) {
    if (value == null) {
      res.removeHeader(key)
    } else {
      res.set(key, value)
    }
  }
}

function setStatus(res: any, status: any) {
  const statusCode = Number(status)
  if (Number.isInteger(statusCode) && statusCode >= 100 && statusCode <= 599) {
    res.status(statusCode)
  }
}

export async function applyResponseTransformers({
  res,
  body,
  process,
  targetPlatform,
  source,
  $options,
  executionContext,
}: any) {
  const currentHeaders = getCurrentHeaders(res)
  const transformed = await ProxyUtils.processResponse(
    {
      status: res.statusCode || 200,
      headers: currentHeaders,
      body,
    },
    process || [],
    targetPlatform,
    source,
    $options,
    executionContext,
  )
  setHeaders(res, currentHeaders, transformed.header || transformed.headers)
  setStatus(res, transformed.status || transformed.statusCode)
  return transformed.body
}
