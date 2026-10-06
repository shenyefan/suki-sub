import { downloadError, upstreamHttpError } from './diagnostics'
import { parseResourceLink } from '#/shared/resource-link'
/**
 * 流量信息头(subscription-userinfo)解析与获取。
 */
import { SETTINGS_KEY } from '#/server/core/constants'
import { hex_md5 } from '#/server/core/vendor/md5'
import $ from '#/server/core/app'
import headersResourceCache from '#/server/core/utils/headers-resource-cache'
import { runBackendRequestTask } from '#/server/core/utils/request-concurrency'
import { proxyHttpRequest } from './proxy-fetch'

// 返回 { headers, body, statusCode }(headers 为小写键)
async function httpRequest(
  method: 'GET' | 'HEAD',
  url: string,
  options: { headers?: any; timeout?: any; proxy?: any },
): Promise<{
  headers: Record<string, string>
  body: string
  statusCode: number
}> {
  const timeout = Number(options.timeout) || 8000
  const requestHeaders = new Headers(options.headers)
  if (!requestHeaders.has('accept')) requestHeaders.set('accept', '*/*')
  try {
    if (options.proxy) {
      const flat: Record<string, string> = {}
      requestHeaders.forEach((value, key) => {
        flat[key] = value
      })
      return await proxyHttpRequest(method, url, {
        headers: flat,
        timeout,
        proxy: options.proxy,
      })
    }
    const res = await fetch(url, {
      method,
      headers: requestHeaders,
      signal: AbortSignal.timeout(timeout),
    })
    const headers: Record<string, string> = {}
    res.headers.forEach((value, key) => {
      headers[key] = value
    })
    const body = method === 'HEAD' ? '' : await res.text()
    return { headers, body, statusCode: res.status }
  } catch (error) {
    throw downloadError(
      error,
      url,
      new Headers(options.headers).get('user-agent') || '',
    )
  }
}

export function getFlowField(headers: any) {
  const keys = Object.keys(headers)
  let sub = ''
  let webPage = ''
  let planName = ''
  for (const k of keys) {
    const lower = k.toLowerCase()
    if (lower === 'subscription-userinfo') {
      sub = headers[k]
    } else if (lower === 'profile-web-page-url') {
      webPage = headers[k]
    } else if (lower === 'plan-name') {
      planName = headers[k]
    }
  }

  return `${sub || ''}${
    webPage ? `; app_url=${encodeURIComponent(webPage)}` : ''
  }${planName ? `; plan_name=${encodeURIComponent(planName)}` : ''}`
}
export async function getFlowHeaders(
  rawUrl: any,
  ua: any,
  timeout: any,
  customProxy: any,
  flowUrl: any,
  flowHeaders: any,
) {
  let url = flowUrl || rawUrl || ''
  const parsedLink = parseResourceLink(url)
  const $arguments: any = parsedLink.arguments
  url = parsedLink.url
  if ($arguments?.noFlow || !/^https?/.test(url)) {
    return
  }
  const insecure = $arguments?.insecure
    ? //      Workers 非 Node,固定取 { insecure: true }(仅用于日志,fetch 不支持该选项)
      { insecure: true }
    : undefined
  const {
    defaultProxy,
    defaultFlowUserAgent,
    defaultUserAgent,
    defaultTimeout,
  } = ($.read(SETTINGS_KEY) || {}) as any
  const proxy = customProxy || defaultProxy
  const userAgent =
    String(
      ua || defaultFlowUserAgent || defaultUserAgent || 'clash.meta/v1.19.23',
    ).trim() || 'clash.meta/v1.19.23'
  const requestTimeout = timeout || defaultTimeout || 8000
  let customHeaders: any
  const customHeadersArg =
    flowHeaders || $arguments?.flowHeaders || $arguments?.headers
  if (customHeadersArg) {
    try {
      const parsed =
        typeof customHeadersArg === 'string'
          ? JSON.parse(customHeadersArg)
          : customHeadersArg
      if (
        parsed &&
        typeof parsed === 'object' &&
        !Array.isArray(parsed) &&
        Object.keys(parsed).length > 0
      ) {
        const lowerCaseHeaders: any = { 'user-agent': userAgent }
        for (const key in parsed) {
          lowerCaseHeaders[key.toLowerCase()] = parsed[key]
        }
        customHeaders = lowerCaseHeaders
      }
    } catch (e) {
      $.error(
        `解析自定义 ${
          flowHeaders || $arguments?.flowHeaders ? 'flowHeaders' : 'headers'
        } 失败: ${e}`,
      )
    }
  }
  const id = hex_md5(
    `${customHeaders ? JSON.stringify(customHeaders) : userAgent}${url}`,
  )
  const cached = await headersResourceCache.get(id)
  let flowInfo
  if (!$arguments?.noCache && cached) {
    $.debug(
      `使用缓存的流量信息: ${url}, ${
        customHeaders ? JSON.stringify(customHeaders) : userAgent
      }`,
    )
    flowInfo = cached
  } else {
    if (flowUrl) {
      const { headers, body, statusCode } = await runBackendRequestTask(
        () =>
          httpRequest('GET', url, {
            headers: customHeaders || { 'User-Agent': userAgent },
            timeout: requestTimeout,
            proxy,
          }),
        'flow body GET',
      )
      if (statusCode < 200 || statusCode >= 400)
        throw upstreamHttpError(
          statusCode,
          url,
          customHeaders?.['user-agent'] || userAgent,
          headers,
        )
      const valid = (value: string) => {
        let parsed
        try {
          parsed = parseFlowHeaders(value)
        } catch {
          return false
        }
        return (
          Number.isFinite(parsed?.total) &&
          Number.isFinite(parsed?.usage.download) &&
          Number.isFinite(parsed?.usage.upload)
        )
      }
      const flowField = getFlowField(headers)
      if (valid(body)) flowInfo = body
      else if (valid(flowField)) flowInfo = flowField
      else $.warn('流量信息地址未返回有效数据')
    } else {
      try {
        $.debug(
          `使用 HEAD 方法从响应头获取流量信息: ${url}, ${
            customHeaders
              ? JSON.stringify(customHeaders)
              : `User-Agent: ${userAgent || ''}`
          }, Insecure: ${!!insecure}, Proxy: ${proxy}`,
        )
        const { headers, statusCode } = await runBackendRequestTask(
          () =>
            httpRequest(
              'HEAD',
              url
                .split(/[\r\n]+/)
                .map((i: string) => i.trim())
                .filter((i: string) => i.length)[0],
              {
                headers: customHeaders || {
                  'User-Agent': userAgent,
                },
                timeout: requestTimeout,
                proxy,
              },
            ),
          'flow headers HEAD',
        )
        if (statusCode < 200 || statusCode >= 400)
          throw upstreamHttpError(
            statusCode,
            url,
            customHeaders?.['user-agent'] || userAgent,
            headers,
          )
        flowInfo = getFlowField(headers)
      } catch (e) {
        $.debug(
          `使用 HEAD 方法从响应头获取流量信息失败: ${url}, ${
            customHeaders
              ? JSON.stringify(customHeaders)
              : `User-Agent: ${userAgent || ''}`
          }, Insecure: ${!!insecure}, Proxy: ${proxy}: ${
            (e as any).message ?? e
          }`,
        )
      }
      if (!flowInfo) {
        $.debug(
          `使用 GET 方法获取流量信息: ${url}, ${
            customHeaders
              ? JSON.stringify(customHeaders)
              : `User-Agent: ${userAgent || ''}`
          }, Insecure: ${!!insecure}, Proxy: ${proxy}`,
        )
        const { headers, statusCode } = await runBackendRequestTask(
          () =>
            httpRequest(
              'GET',
              url
                .split(/[\r\n]+/)
                .map((i: string) => i.trim())
                .filter((i: string) => i.length)[0],
              {
                headers: customHeaders || {
                  'User-Agent': userAgent,
                },
                timeout: requestTimeout,
                proxy,
              },
            ),
          'flow headers GET',
        )
        if (statusCode < 200 || statusCode >= 400)
          throw upstreamHttpError(
            statusCode,
            url,
            customHeaders?.['user-agent'] || userAgent,
            headers,
          )
        flowInfo = getFlowField(headers)
      }
    }
    if (flowInfo) {
      flowInfo = flowInfo.trim()
    }
    if (flowInfo) {
      await headersResourceCache.set(
        id,
        flowInfo,
        $arguments?.headersCacheTtl
          ? $arguments?.headersCacheTtl * 1000
          : undefined,
      )
    }
  }

  return flowInfo
}
export function parseFlowHeaders(flowHeaders: any) {
  if (!flowHeaders) return
  // unit is KB
  const uploadMatch = flowHeaders.match(
    /upload=([-+]?)([0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?)/,
  )
  const upload =
    uploadMatch == null ? 0 : Number(uploadMatch[1] + uploadMatch[2])

  const downloadMatch = flowHeaders.match(
    /download=([-+]?)([0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?)/,
  )
  const download = Number(downloadMatch[1] + downloadMatch[2])
  const totalMatch = flowHeaders.match(
    /total=([-+]?)([0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?)/,
  )
  const total = Number(totalMatch[1] + totalMatch[2])

  // optional expire timestamp
  const expireMatch = flowHeaders.match(
    /expire=([-+]?)([0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?)/,
  )
  const expires = expireMatch
    ? Number(expireMatch[1] + expireMatch[2])
    : undefined

  const remainingDaysMatch = flowHeaders.match(/reset_day=([0-9]+)/)
  const remainingDays = remainingDaysMatch
    ? Number(remainingDaysMatch[1])
    : undefined

  const appUrlMatch = flowHeaders.match(/app_url=(.*?)\s*?(;|$)/)
  const appUrl = appUrlMatch ? decodeURIComponent(appUrlMatch[1]) : undefined

  const planNameMatch = flowHeaders.match(/plan_name=(.*?)\s*?(;|$)/)
  const planName = planNameMatch
    ? decodeURIComponent(planNameMatch[1])
    : undefined

  return {
    expires,
    total,
    usage: { upload, download },
    remainingDays,
    appUrl,
    planName,
  }
}

export function flowTransfer(flow: any, unit: string = 'B'): any {
  const unitList = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']
  let unitIndex = unitList.indexOf(unit)

  return flow < 1024 || unitIndex === unitList.length - 1
    ? { value: (Math.round(flow * 100) / 100).toString(), unit: unit }
    : flowTransfer(flow / 1024, unitList[++unitIndex])
}

export function validCheck(flow: any) {
  if (!flow) {
    throw new Error('没有流量信息')
  }
  if (flow?.expires && flow.expires * 1000 < Date.now()) {
    const date = new Date(flow.expires * 1000).toLocaleDateString()
    throw new Error(`订阅已过期: ${date}`)
  }
  if (flow?.total) {
    const upload = flow.usage?.upload || 0
    const download = flow.usage?.download || 0
    if (flow.total - upload - download <= 0) {
      const current = upload + download
      const currT = flowTransfer(Math.abs(current))
      currT.value = current < 0 ? '-' + currT.value : currT.value
      const totalT = flowTransfer(flow.total)
      throw new Error(
        `流量已用完: ${currT.value} ${currT.unit} / ${totalT.value} ${totalT.unit}`,
      )
    }
  }
}

export function getRmainingDays(opt: any = {}) {
  try {
    const { startDate } = opt
    let { resetDay, cycleDays } = opt
    if (['string', 'number'].includes(typeof opt)) {
      resetDay = opt
    }

    if (startDate && cycleDays) {
      cycleDays = parseInt(cycleDays)
      if (isNaN(cycleDays) || cycleDays <= 0)
        throw new Error('重置周期应为正整数')
      if (!startDate || !Date.parse(startDate))
        throw new Error('开始日期不合法')

      const start = new Date(startDate)
      const today = new Date()
      start.setHours(0, 0, 0, 0)
      today.setHours(0, 0, 0, 0)
      if (start.getTime() > today.getTime())
        throw new Error('开始日期应早于现在')

      const resetDate = new Date(startDate)
      resetDate.setDate(resetDate.getDate() + cycleDays)

      while (resetDate < today) {
        resetDate.setDate(resetDate.getDate() + cycleDays)
      }

      resetDate.setHours(0, 0, 0, 0)
      const timeDiff = resetDate.getTime() - today.getTime()
      const daysDiff = Math.ceil(timeDiff / (1000 * 3600 * 24))

      return daysDiff
    } else {
      if (!resetDay) return
      resetDay = parseInt(resetDay)
      if (isNaN(resetDay) || resetDay <= 0 || resetDay > 31)
        throw new Error('月重置日应为 1-31 之间的整数')
      const now = new Date()
      const today = now.getDate()
      const month = now.getMonth()
      const year = now.getFullYear()
      let daysInMonth

      if (resetDay > today) {
        daysInMonth = 0
      } else {
        daysInMonth = new Date(year, month + 1, 0).getDate()
      }

      return daysInMonth - today + resetDay
    }
  } catch (e) {
    $.error(`getRmainingDays failed: ${(e as any).message ?? e}`)
  }
}

export function normalizeFlowHeader(flowHeaders: any, splitHeaders: any) {
  try {
    // 使用 Map 保持顺序并处理重复键
    const kvMap = new Map()

    flowHeaders
      .split(';')
      .map((p: string) => p.trim())
      .filter(Boolean)
      .forEach((pair: string) => {
        const eqIndex = pair.indexOf('=')
        if (eqIndex === -1) return

        const key = pair.slice(0, eqIndex).trim()
        const encodedValue = pair.slice(eqIndex + 1).trim()

        // 只保留第一个出现的 key
        if (!kvMap.has(key)) {
          try {
            // 解码 URI 组件并保留原始值作为 fallback
            let decodedValue: any = decodeURIComponent(encodedValue)
            if (
              ['upload', 'download', 'total', 'expire', 'reset_day'].includes(
                key,
              )
            ) {
              try {
                decodedValue = Number(decodedValue)
                if (
                  ['expire', 'reset_day'].includes(key) &&
                  (decodedValue <= 0 || !Number.isFinite(decodedValue))
                ) {
                  decodedValue = ''
                } else if (
                  ['upload', 'download', 'total'].includes(key) &&
                  !Number.isFinite(decodedValue) // 有些机场后端会下发负数
                ) {
                  decodedValue = 0
                } else {
                  decodedValue = decodedValue.toFixed(0)
                }
              } catch (e) {
                $.error(
                  `Failed to convert value for key "${key}=${encodedValue}": ${
                    (e as any).message ?? e
                  }`,
                )
              }
            }
            kvMap.set(key, decodedValue)
          } catch (e) {
            kvMap.set(key, encodedValue)
          }
        }
      })
    const subscriptionUserinfo: any = {}
    const headers: any = {
      'subscription-userinfo': '',
      'profile-web-page-url': '',
      'plan-name': '',
    }
    kvMap.forEach((v: any, k: string) => {
      if (splitHeaders && k === 'app_url') {
        headers['profile-web-page-url'] = v
      } else if (splitHeaders && k === 'plan_name') {
        headers['plan-name'] = v
      } else {
        subscriptionUserinfo[k] = v
      }
    })
    if (Object.keys(subscriptionUserinfo).length > 0) {
      headers['subscription-userinfo'] = Object.entries(subscriptionUserinfo)
        .map(([k, v]) => `${k}=${encodeURIComponent(v as any)}`)
        .join('; ')
    }
    return splitHeaders ? headers : headers['subscription-userinfo']
  } catch (e) {
    $.error(`normalizeFlowHeader failed: ${(e as any).message ?? e}`)
    return splitHeaders
      ? {
          'subscription-userinfo': flowHeaders,
        }
      : flowHeaders
  }
}
