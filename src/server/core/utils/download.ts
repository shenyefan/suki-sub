import { ResourceNotFoundError } from '#/server/core/errors'
import { RequestInvalidError } from '../errors'
import { downloadError, upstreamHttpError } from './diagnostics'
import { parseResourceLink } from '#/shared/resource-link'
/**
 * 远程资源下载:原生 fetch,#args URL 片段参数、settings 默认值、资源缓存、age 解密。
 */
import { SETTINGS_KEY, MODULES_KEY } from '#/server/core/constants'
import { hex_md5 } from '#/server/core/vendor/md5'
import resourceCache from '#/server/core/utils/resource-cache'
import headersResourceCache from '#/server/core/utils/headers-resource-cache'
import {
  getFlowField,
  getFlowHeaders,
  parseFlowHeaders,
  validCheck,
} from '#/server/core/utils/flow'
import $ from '#/server/core/app'
import { findByName } from '#/server/core/utils/database'
import PROXY_PREPROCESSORS from '#/server/core/proxy-utils/preprocessors/index'
import { ProxyUtils } from '#/server/core/proxy-utils/index'
import { runBackendRequestTask } from '#/server/core/utils/request-concurrency'
import {
  AGE_SECRET_KEY,
  decryptArmorIfPresent,
  maskAgeSecretInUrl,
} from '#/server/core/utils/age'
import { getEngineStore } from '#/server/store/engine-store'

const clashPreprocessor = PROXY_PREPROCESSORS.find(
  (processor: any) => processor.name === 'Clash Pre-processor',
)

// 返回 { body, headers, statusCode }(headers 为小写键)
async function httpRequest(
  method: 'GET' | 'HEAD',
  url: string,
  options: { headers?: any; timeout?: any },
): Promise<{
  headers: Record<string, string>
  body: string
  statusCode: number
}> {
  const timeout = Number(options.timeout) || 8000
  // Match Suki Sub's Node transport without overriding custom Accept headers.
  const requestHeaders = new Headers(options.headers)
  if (!requestHeaders.has('accept')) requestHeaders.set('accept', '*/*')
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
}

function getKV(): KVNamespace | null {
  try {
    return getEngineStore().kv
  } catch (e) {
    return null
  }
}

async function readCustomCache(key: string): Promise<any> {
  const kv = getKV()
  if (!kv) return undefined
  return await kv.get(key, 'text')
}

async function writeCustomCache(key: string, value: any): Promise<void> {
  const kv = getKV()
  if (!kv) return
  await kv.put(key, typeof value === 'string' ? value : JSON.stringify(value))
}

function buildDownloadRegex(pattern: any = '') {
  const trimmed = `${pattern}`.trim()
  if (!trimmed) return null
  return new RegExp(trimmed, 'i')
}

function maybePrefixGithubProxyUrl(
  url: any,
  githubProxy: any,
  githubProxyRegex: any,
) {
  if (!githubProxy || !githubProxyRegex || typeof url !== 'string') {
    return url
  }

  if (!/^https?:\/\//i.test(url)) {
    return url
  }

  const prefix = `${githubProxy}/`
  if (url.startsWith(prefix)) {
    return url
  }

  let regex
  try {
    regex = buildDownloadRegex(githubProxyRegex)
  } catch (e) {
    $.warn(`GitHub 加速代理匹配正则无效: ${(e as any).message ?? e}`)
    return url
  }

  if (!regex?.test(url)) {
    return url
  }

  $.debug(`GitHub 加速代理命中下载链接: ${url}`)
  return `${githubProxy}/${url}`
}

function maskDownloadUrl(url: any) {
  return maskAgeSecretInUrl(url)
}

async function finalizeDownloadedBody(
  body: any,
  { ageSecretKey, preprocess, url }: any,
) {
  let result = ageSecretKey
    ? await decryptArmorIfPresent(body, ageSecretKey)
    : body
  const raw = result

  if (preprocess) {
    try {
      if (clashPreprocessor?.test(result)) {
        result = clashPreprocessor.parse(result, true)
      }
    } catch (e) {
      throw new RequestInvalidError(
        'SUBSCRIPTION_PARSE_FAILED',
        '订阅内容预处理失败',
        {
          url,
          reason: e instanceof Error ? e.message : String(e),
        },
      )
    }
  }

  if (preprocess) {
    const proxies = ProxyUtils.parse(result)
    if (!proxies.length)
      throw new RequestInvalidError(
        'NO_USABLE_NODES',
        '来源内容中没有可用节点',
        { url },
      )
  }

  return {
    result,
    raw,
    shouldCache: true,
  }
}

function formatDownloadResult(finalized: any, returnRaw: any) {
  return returnRaw
    ? { result: finalized.result, raw: finalized.raw }
    : finalized.result
}

function formatPlainDownloadResult(result: any, returnRaw: any) {
  return returnRaw ? { result, raw: result } : result
}

export default async function download(
  rawUrl: string = '',
  ua: any,
  timeout: any,
  skipCustomCache: any,
  awaitCustomCache: any,
  noCache: any,
  preprocess: any,
  options: any = {},
) {
  const parsedLink = parseResourceLink(rawUrl)
  const $arguments: any = parsedLink.arguments
  let url = parsedLink.url
  if (!url || (!/^\/api\/module\//.test(url) && !/^https?:\/\//i.test(url))) {
    throw new RequestInvalidError(
      'INVALID_SOURCE_URL',
      url
        ? '来源链接无效，请填写完整的 HTTP 或 HTTPS 地址'
        : '来源链接不能为空',
    )
  }
  const explicitAgeSecretKey =
    options && typeof options === 'object'
      ? options?.[AGE_SECRET_KEY] || options?.ageSecretKey
      : undefined
  const returnRaw = options && typeof options === 'object' && options.returnRaw
  const ageSecretKey = explicitAgeSecretKey || $arguments?.[AGE_SECRET_KEY]
  const {
    githubProxy,
    githubProxyRegex,
    defaultUserAgent,
    defaultTimeout,
    cacheThreshold: defaultCacheThreshold,
  } = ($.read(SETTINGS_KEY) || {}) as any
  const cacheThreshold = defaultCacheThreshold || 1024
  const userAgent =
    String(ua || defaultUserAgent || 'clash.meta/v1.19.23').trim() ||
    'clash.meta/v1.19.23'
  let customHeaders: any
  if ($arguments?.headers) {
    try {
      const parsed =
        typeof $arguments.headers === 'string'
          ? JSON.parse($arguments.headers)
          : $arguments.headers
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
      throw new RequestInvalidError(
        'INVALID_REQUEST_HEADERS',
        '自定义请求头格式无效',
        { reason: (e as Error).message },
      )
    }
  }

  const requestTimeout = timeout || defaultTimeout || 8000
  url = maybePrefixGithubProxyUrl(url, githubProxy, githubProxyRegex)
  const safeUrl = maskDownloadUrl(url)
  const id = hex_md5(
    `${customHeaders ? JSON.stringify(customHeaders) : userAgent}${url}`,
  )

  if ($arguments?.cacheKey === true) {
    throw new RequestInvalidError('INVALID_CACHE_KEY', '自定义缓存名称不能为空')
  }

  const customCacheKey = $arguments?.cacheKey
    ? `#suki-sub-cached-custom-${$arguments?.cacheKey}`
    : undefined

  const bypassCache = Boolean(noCache || $arguments.noCache)
  if (customCacheKey && !skipCustomCache && !bypassCache) {
    const customCached = await readCustomCache(customCacheKey)
    const cached = await resourceCache.get(id)
    if (!noCache && !$arguments?.noCache && cached) {
      $.debug(
        `乐观缓存: URL ${safeUrl}\n存在有效的常规缓存\n使用常规缓存以避免重复请求`,
      )
      return formatDownloadResult(
        await finalizeDownloadedBody(cached, {
          ageSecretKey,
          preprocess,
          url: safeUrl,
        }),
        returnRaw,
      )
    }
    if (customCached) {
      if (awaitCustomCache) {
        $.debug(`乐观缓存: URL ${safeUrl}\n本次进行请求 尝试更新缓存`)
        try {
          await download(
            rawUrl.replace(/(\?|&)cacheKey=.*?(&|$)/, ''),
            ua,
            timeout,
            true,
            undefined,
            undefined,
            preprocess,
            options,
          )
        } catch (e) {
          $.warn(
            `乐观缓存: URL ${safeUrl} 更新缓存发生错误 ${
              (e as any).message ?? e
            }`,
          )
          $.debug('使用乐观缓存的数据刷新缓存, 防止后续请求')
          await resourceCache.set(id, customCached)
        }
      } else {
        $.debug(
          `乐观缓存: URL ${safeUrl}\n本次返回自定义缓存 ${$arguments?.cacheKey}\n并进行请求 尝试异步更新缓存`,
        )
        download(
          rawUrl.replace(/(\?|&)cacheKey=.*?(&|$)/, ''),
          ua,
          timeout,
          true,
          undefined,
          undefined,
          preprocess,
          options,
        ).catch((e) => {
          $.warn(
            `乐观缓存: URL ${safeUrl} 异步更新缓存发生错误 ${e.message ?? e}`,
          )
        })
      }
      return formatDownloadResult(
        await finalizeDownloadedBody(customCached, {
          ageSecretKey,
          preprocess,
          url: safeUrl,
        }),
        returnRaw,
      )
    }
  }

  const downloadUrlMatch = url.split('#')[0].match(/^\/api\/(modules)\/(.+)/)
  if (downloadUrlMatch) {
    const name = decodeURIComponent(downloadUrlMatch[2])
    const item = findByName($.read(MODULES_KEY) as any[], name)
    if (!item)
      throw new ResourceNotFoundError('MODULE_NOT_FOUND', '脚本模块不存在', {
        module: name,
      })
    return formatPlainDownloadResult(item.content, returnRaw)
  }

  let result

  // try to find in app cache
  const cached = await resourceCache.get(id)
  if (!noCache && !$arguments?.noCache && cached) {
    $.debug(
      `使用缓存: ${safeUrl}, ${
        customHeaders ? JSON.stringify(customHeaders) : userAgent
      }`,
    )
    result = await finalizeDownloadedBody(cached, {
      ageSecretKey,
      preprocess,
      url: safeUrl,
    })
    if (customCacheKey) {
      $.debug(`URL ${safeUrl}\n写入自定义缓存 ${$arguments?.cacheKey}`)
      await writeCustomCache(customCacheKey, cached)
    }
  } else {
    if ($arguments?.insecure)
      $.warn('当前运行环境不支持跳过 TLS 证书验证，仍会验证证书')
    const insecure = $arguments?.insecure
      ? //      Workers 非 Node,固定取 { insecure: true }(仅用于日志,fetch 不支持该选项)
        { insecure: true }
      : undefined
    $.debug(
      `Downloading...\n${
        customHeaders
          ? JSON.stringify(customHeaders)
          : `User-Agent: ${userAgent}`
      }\nTimeout: ${requestTimeout}\nInsecure: ${!!insecure}\nPreprocess: ${preprocess}\nURL: ${safeUrl}`,
    )
    try {
      const { body, headers, statusCode } = await runBackendRequestTask(
        () =>
          httpRequest('GET', url, {
            headers: customHeaders || {
              'User-Agent': userAgent,
            },
            timeout: requestTimeout,
          }),
        'download',
      )
      $.debug(`statusCode: ${statusCode}`)
      if (statusCode < 200 || statusCode >= 400) {
        throw upstreamHttpError(
          statusCode,
          url,
          customHeaders?.['user-agent'] || userAgent,
          headers,
        )
      }

      if (headers) {
        const flowInfo = getFlowField(headers)
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
      if (body.replace(/\s/g, '').length === 0)
        throw new Error('远程资源内容为空')
      result = await finalizeDownloadedBody(body, {
        ageSecretKey,
        preprocess,
        url: safeUrl,
      })
      let shouldCache = true
      if (cacheThreshold) {
        const size = body.length / 1024
        if (size > cacheThreshold) {
          $.debug(
            `资源大小 ${size.toFixed(
              2,
            )} KB 超过了 ${cacheThreshold} KB, 不缓存`,
          )
          shouldCache = false
        }
      }
      if (shouldCache) {
        await resourceCache.set(
          id,
          body,
          $arguments?.cacheTtl ? $arguments?.cacheTtl * 1000 : undefined,
        )
        if (customCacheKey) {
          $.debug(`URL ${safeUrl}\n写入自定义缓存 ${$arguments?.cacheKey}`)
          await writeCustomCache(customCacheKey, body)
        }
      }
    } catch (e) {
      if (customCacheKey && !bypassCache) {
        const customCached = await readCustomCache(customCacheKey)
        if (customCached) {
          $.debug(
            `无法下载 URL ${safeUrl}: ${
              (e as any).message ?? e
            }\n使用自定义缓存 ${$arguments?.cacheKey}`,
          )
          return formatDownloadResult(
            await finalizeDownloadedBody(customCached, {
              ageSecretKey,
              preprocess,
              url: safeUrl,
            }),
            returnRaw,
          )
        }
      }
      throw downloadError(e, url, customHeaders?.['user-agent'] || userAgent)
    }
  }

  // 检查订阅有效性

  if ($arguments?.validCheck && !$arguments?.noFlow && !options?.noFlow) {
    await validCheck(
      parseFlowHeaders(
        await getFlowHeaders(
          rawUrl,
          $arguments.flowUserAgent || userAgent,
          undefined,
          $arguments.flowUrl,
          $arguments.flowHeaders,
        ),
      ),
    )
  }

  return formatDownloadResult(result, returnRaw)
}
