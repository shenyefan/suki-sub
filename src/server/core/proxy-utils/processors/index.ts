/**
 * 节点操作符集合;脚本类操作符经沙箱(createDynamicFunction)执行,调用处需 await。
 * resourceCache 为 KV 异步实现,get/set 调用点已补 await。
 */
import resourceCache from '#/server/core/utils/resource-cache'
import { isIPv4, isIPv6, ipAddress } from '#/server/core/utils/index'
import { FULL } from '#/server/core/utils/logical'
import { getFlag, removeFlag } from '#/server/core/utils/geo'
import { resolveDns } from '#/server/core/utils/dns'
import lodash from 'lodash'
import $ from '#/server/core/app'
import { hex_md5 } from '#/server/core/vendor/md5'
import { SETTINGS_KEY } from '#/server/core/constants'
import env from '#/server/core/utils/env'
import { RequestInvalidError } from '#/server/core/errors'
import { upstreamHttpError } from '#/server/core/utils/diagnostics'
import { createDynamicFunction } from '#/server/core/utils/user-script'

export const RESPONSE_TRANSFORMER = 'Response Transformer'

export function isResponseTransformerType(type: string): boolean {
  return type === RESPONSE_TRANSFORMER
}

interface ProcessorResult {
  name: string
  func: (...args: any[]) => any
  nodeFunc?: (...args: any[]) => any
  shortcutFunc?: (...args: any[]) => any
}

/**
 The rule "(name CONTAINS "🇨🇳") AND (port IN [80, 443])" can be expressed as follows:
 {
    operator: "AND",
    child: [
        {
            attr: "name",
            proposition: "CONTAINS",
            value: "🇨🇳"
        },
        {
            attr: "port",
            proposition: "IN",
            value: [80, 443]
        }
    ]
}
 */

function ConditionalFilter({ rule }: { rule: any }): ProcessorResult {
  return {
    name: 'Conditional Filter',
    func: (proxies: any) => {
      return proxies.map((proxy: any) => isMatch(rule, proxy))
    },
  }
}

function isMatch(rule: any, proxy: any): boolean {
  // leaf node
  if (!rule.operator) {
    switch (rule.proposition) {
      case 'IN':
        return rule.value.indexOf(proxy[rule.attr]) !== -1
      case 'CONTAINS':
        if (typeof proxy[rule.attr] !== 'string') return false
        return proxy[rule.attr].indexOf(rule.value) !== -1
      case 'EQUALS':
        return proxy[rule.attr] === rule.value
      case 'EXISTS':
        return (
          proxy[rule.attr] !== null || typeof proxy[rule.attr] !== 'undefined'
        )
      default:
        throw new Error(`Unknown proposition: ${rule.proposition}`)
    }
  }

  // operator nodes
  switch (rule.operator) {
    case 'AND':
      return rule.child.every((child: any) => isMatch(child, proxy))
    case 'OR':
      return rule.child.some((child: any) => isMatch(child, proxy))
    case 'NOT':
      return !isMatch(rule.child, proxy)
    default:
      throw new Error(`Unknown operator: ${rule.operator}`)
  }
}

function QuickSettingOperator(args: any): ProcessorResult {
  return {
    name: 'Quick Setting Operator',
    func: (proxies: any) => {
      if (get(args.useless)) {
        const filter = UselessFilter()
        const selected = filter.func(proxies)
        proxies = proxies.filter(
          (p: any, i: number) => selected[i] && p.port > 0 && p.port <= 65535,
        )
      }

      return proxies.map((proxy: any) => {
        proxy.udp = get(args.udp, proxy.udp)
        proxy.tfo = get(args.tfo, proxy.tfo)
        proxy['fast-open'] = get(args.tfo, proxy['fast-open'])
        proxy['skip-cert-verify'] = get(args.scert, proxy['skip-cert-verify'])
        if (proxy.type === 'vmess') {
          proxy.aead = get(args['vmess aead'], proxy.aead)
        }
        if (['snell', 'anytls', 'trusttunnel'].includes(proxy.type)) {
          proxy.reuse = get(args.reuse, proxy.reuse)
        }
        if (['tuic', 'hysteria2'].includes(proxy.type)) {
          proxy.ecn = get(args.ecn, proxy.ecn)
        }
        proxy['block-quic'] = getBlockQuic(
          args['block-quic'],
          proxy['block-quic'],
        )
        proxy['ip-version'] = getValue(args['ip-version'], proxy['ip-version'])
        return proxy
      })
    },
  }

  function get(value: any, defaultValue?: any) {
    switch (value) {
      case 'ENABLED':
        return true
      case 'DISABLED':
        return false
      default:
        return defaultValue
    }
  }

  function getBlockQuic(value: any, defaultValue: any) {
    switch (value) {
      case 'auto':
      case 'on':
      case 'off':
        return value
      default:
        return defaultValue
    }
  }

  function getValue(value: any, defaultValue: any) {
    switch (value) {
      case undefined:
      case null:
      case '':
      case 'DEFAULT':
        return defaultValue
      default:
        return value
    }
  }
}

// add or remove flag for proxies
function FlagOperator({ mode, tw }: any): ProcessorResult {
  return {
    name: 'Flag Operator',
    func: (proxies: any) => {
      return proxies.map((proxy: any) => {
        if (mode === 'remove') {
          // no flag
          proxy.name = removeFlag(proxy.name)
        } else {
          // get flag
          const newFlag = getFlag(proxy.name)
          // remove old flag
          proxy.name = removeFlag(proxy.name)
          proxy.name = newFlag + ' ' + proxy.name
          if (tw == 'ws') {
            proxy.name = proxy.name.replace(/🇹🇼/g, '🇼🇸')
          } else if (tw == 'tw') {
            // 不变
          } else {
            proxy.name = proxy.name.replace(/🇹🇼/g, '🇨🇳')
          }
        }
        return proxy
      })
    },
  }
}

// duplicate handler
function HandleDuplicateOperator(arg: any): ProcessorResult {
  const { action, template, link, position, field } = {
    ...{
      action: 'rename',
      template: '0 1 2 3 4 5 6 7 8 9',
      link: '-',
      position: 'back',
      field: ['name'],
    },
    ...arg,
  }
  return {
    name: 'Handle Duplicate Operator',
    func: (proxies: any) => {
      if (action === 'delete') {
        const chosen: Record<string, boolean> = {}
        return proxies.filter((p: any) => {
          const key = (field as any[])
            .map((f: any) => lodash.get(p, f, '-'))
            .join('_')
          if (chosen[key]) {
            return false
          }
          chosen[key] = true
          return true
        })
      } else if (action === 'rename') {
        const numbers = template.split(' ')
        // count occurrences of each name
        const counter: Record<string, number> = {}
        let maxLen = 0
        proxies.forEach((p: any) => {
          const key = (field as any[])
            .map((f: any) => lodash.get(p, f, '-'))
            .join('_')
          if (typeof counter[key] === 'undefined') counter[key] = 1
          else counter[key]++
          maxLen = Math.max(counter[key].toString().length, maxLen)
        })
        const increment: Record<string, number> = {}
        return proxies.map((p: any) => {
          const key = (field as any[])
            .map((f: any) => lodash.get(p, f, '-'))
            .join('_')
          if (counter[key] > 1) {
            if (typeof increment[key] == 'undefined') increment[key] = 1
            let num = ''
            let cnt = increment[key]++
            let numDigits = 0
            while (cnt > 0) {
              num = numbers[cnt % 10] + num
              cnt = parseInt(String(cnt / 10))
              numDigits++
            }
            // padding
            while (numDigits++ < maxLen) {
              num = numbers[0] + num
            }
            if (position === 'front') {
              p.name = num + link + p.name
            } else if (position === 'back') {
              p.name = p.name + link + num
            }
          }
          return p
        })
      }
    },
  }
}

// sort proxies according to their names
function SortOperator(order: string = 'asc'): ProcessorResult {
  return {
    name: 'Sort Operator',
    func: (proxies: any) => {
      switch (order) {
        case 'asc':
        case 'desc':
          return proxies.sort((a: any, b: any) => {
            let res = a.name > b.name ? 1 : -1
            res *= order === 'desc' ? -1 : 1
            return res
          })
        case 'random':
          return shuffle(proxies)
        default:
          throw new Error('Unknown sort option: ' + order)
      }
    },
  }
}

// sort by regex
function RegexSortOperator(input: any): ProcessorResult {
  const order = input.order || 'asc'
  let expressions = input.expressions
  if (Array.isArray(input)) {
    expressions = input
  }
  if (!Array.isArray(expressions)) {
    expressions = []
  }
  return {
    name: 'Regex Sort Operator',
    func: (proxies: any) => {
      expressions = expressions.map((expr: any) => buildRegex(expr))
      return proxies.sort((a: any, b: any) => {
        const oA = getRegexOrder(expressions, a.name)
        const oB = getRegexOrder(expressions, b.name)
        if (oA && !oB) return -1
        if (oB && !oA) return 1
        if (oA && oB) return oA < oB ? -1 : 1
        if (order === 'original') {
          return 0
        } else if (order === 'desc') {
          return a.name < b.name ? 1 : -1
        } else {
          return a.name < b.name ? -1 : 1
        }
      })
    },
  }
}

function getRegexOrder(expressions: RegExp[], str: string): number | null {
  let order = null
  for (let i = 0; i < expressions.length; i++) {
    if (expressions[i].test(str)) {
      order = i + 1 // plus 1 is important! 0 will be treated as false!!!
      break
    }
  }
  return order
}

// rename by regex
// keywords: [{expr: "string format regex", now: "now"}]
function RegexRenameOperator(regex: any): ProcessorResult {
  return {
    name: 'Regex Rename Operator',
    func: (proxies: any) => {
      return proxies.map((proxy: any) => {
        for (const { expr, now } of regex) {
          proxy.name = proxy.name.replace(buildRegex(expr, 'g'), now).trim()
        }
        return proxy
      })
    },
  }
}

// delete regex operator
// regex: ['a', 'b', 'c']
function RegexDeleteOperator(regex: any): ProcessorResult {
  const regex_ = regex.map((r: any) => {
    return {
      expr: r,
      now: '',
    }
  })
  return {
    name: 'Regex Delete Operator',
    func: RegexRenameOperator(regex_).func,
  }
}

/** Script Operator
 function operator(proxies) {
            const {arg1} = $arguments;

            // do something
            return proxies;
         }

 WARNING:
 1. This function name should be `operator`!
 2. Always declare variables before using them!
 */
function ScriptOperator(
  script: string,
  targetPlatform: string,
  $arguments: any,
  source: string,
  $options: any,
  context: any,
): ProcessorResult {
  context.source = source
  context.env = env
  return {
    name: 'Script Operator',
    func: async (proxies: any) => {
      let output = proxies
      await (async function () {
        const operator = await createDynamicFunction(
          'operator',
          script,
          $arguments,
          $options,
        )
        output = await operator(proxies, targetPlatform, context)
      })()
      return output
    },
    nodeFunc: async (proxies: any) => {
      let output = proxies
      await (async function () {
        const operator = await createDynamicFunction(
          'operator',
          `async function operator(input = [], targetPlatform, context) {
                            let proxies = input
                            let list = []
                            for await (let $server of proxies) {
                                ${script}
                                list.push($server)
                            }
                            return list
                      }`,
          $arguments,
          $options,
        )
        output = await operator(proxies, targetPlatform, context)
      })()
      return output
    },
  }
}

function parseIP4P(IP4P: string): { server: any; port: any } {
  let server
  let port
  try {
    const array = IP4P.split(':')

    port = parseInt(array[2], 16)
    const ipab = parseInt(array[3], 16)
    const ipcd = parseInt(array[4], 16)
    const ipa = ipab >> 8
    const ipb = ipab & 0xff
    const ipc = ipcd >> 8
    const ipd = ipcd & 0xff
    server = `${ipa}.${ipb}.${ipc}.${ipd}`
    if (port <= 0 || port > 65535) {
      throw new Error(`Invalid port number: ${port}`)
    }
    if (!isIPv4(server)) {
      throw new Error(`Invalid IP address: ${server}`)
    }
  } catch (e) {
    // throw new Error(`IP4P 解析失败: ${e}`);
    $.warn(`IP4P 解析失败: ${e}`)
  }
  return { server, port }
}

const DEFAULT_RESOLVE_DOMAIN_CONCURRENCY = 10
const DEFAULT_RESOLVE_DOMAIN_CUSTOM_DNS_CONCURRENCY = 2
const RESOLVE_DOMAIN_CONCURRENCY_WARN_THRESHOLD = 20

function normalizeResolveDomainConcurrency(concurrency: any): number {
  if (
    typeof concurrency === 'undefined' ||
    concurrency === null ||
    (typeof concurrency === 'string' && concurrency.trim() === '')
  ) {
    return DEFAULT_RESOLVE_DOMAIN_CONCURRENCY
  }

  const parsed = Number(concurrency)
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error('域名解析并发数应为大于 0 的整数')
  }

  return parsed
}

function normalizeResolveDomainCustomDnsConcurrency(concurrency: any): number {
  if (
    typeof concurrency === 'undefined' ||
    concurrency === null ||
    (typeof concurrency === 'string' && concurrency.trim() === '')
  ) {
    return DEFAULT_RESOLVE_DOMAIN_CUSTOM_DNS_CONCURRENCY
  }

  const parsed = Number(concurrency)
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error('多 DNS 并发数应为大于 0 的整数')
  }

  return parsed
}

function normalizeResolveDomainTimeout(
  timeout: any,
  defaultTimeout: any,
): number {
  const hasExplicitTimeout = !(
    typeof timeout === 'undefined' ||
    timeout === null ||
    (typeof timeout === 'string' && timeout.trim() === '')
  )

  if (hasExplicitTimeout) {
    const parsed = Number(timeout)
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new Error('DNS 超时应为大于 0 的整数')
    }
    return parsed
  }

  if (
    typeof defaultTimeout === 'undefined' ||
    defaultTimeout === null ||
    (typeof defaultTimeout === 'string' && defaultTimeout.trim() === '')
  ) {
    return 8000
  }

  const parsedDefaultTimeout = Number(defaultTimeout)
  if (!isFinite(parsedDefaultTimeout) || parsedDefaultTimeout <= 0) {
    return 8000
  }

  return parsedDefaultTimeout
}

function normalizeResolveDomainCacheTtl(cacheTtl: any): number | undefined {
  if (
    typeof cacheTtl === 'undefined' ||
    cacheTtl === null ||
    (typeof cacheTtl === 'string' && cacheTtl.trim() === '')
  ) {
    return undefined
  }

  const parsed = Number(cacheTtl)
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error('域名解析缓存时长应为大于 0 的整数')
  }

  return parsed * 1000
}

function parseCustomDnsUrls(url: any): string[] {
  const urls = `${url || ''}`
    .split(/\r?\n/)
    .map((item: string) => item.trim())
    .filter((item: string) => item)
  if (urls.length === 0) throw new Error('自定义 DNS 不能为空')
  return urls
}

function normalizeCustomDnsUrlList(url: any): string {
  return parseCustomDnsUrls(url).join('\n')
}

async function resolveDomainsWithConcurrency(
  domains: any[],
  concurrency: number,
  resolveDomain: (domain: any) => Promise<void>,
): Promise<void> {
  let nextIndex = 0
  const workerCount = Math.min(concurrency, domains.length)
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < domains.length) {
      const domain = domains[nextIndex]
      nextIndex += 1
      await resolveDomain(domain)
    }
  })

  await Promise.all(workers)
}

function resolveWithCustomDnsConcurrency(
  urls: string[],
  concurrency: number,
  resolveUrl: (resolverUrl: string) => Promise<any>,
): Promise<{ result: any; resolverUrl: string }> {
  return new Promise((resolve, reject) => {
    let nextIndex = 0
    let activeCount = 0
    let finishedCount = 0
    let settled = false
    const errors: string[] = []
    const workerCount = Math.min(concurrency, urls.length)

    function maybeReject() {
      if (!settled && finishedCount === urls.length) {
        reject(new Error(errors.length > 0 ? errors.join('; ') : 'No answers'))
      }
    }

    function startNext() {
      if (settled) return
      while (activeCount < workerCount && nextIndex < urls.length) {
        const resolverUrl = urls[nextIndex]
        nextIndex += 1
        activeCount += 1
        Promise.resolve()
          .then(() => resolveUrl(resolverUrl))
          .then((result) => {
            activeCount -= 1
            finishedCount += 1
            if (settled) return
            settled = true
            resolve({ result, resolverUrl })
          })
          .catch((err: any) => {
            activeCount -= 1
            finishedCount += 1
            errors.push(`${resolverUrl}: ${err}`)
            startNext()
            maybeReject()
          })
      }
      maybeReject()
    }

    startNext()
  })
}

function getDomainResolverCacheId(
  provider: string,
  domain: string,
  type: string,
  url: any,
  tlsSkipCertVerify: any,
): any {
  switch (provider) {
    case 'Custom':
      return hex_md5(
        `CUSTOM:${
          tlsSkipCertVerify ? 'INSECURE:' : ''
        }${url}:${domain}:${type}`,
      )
    case 'Google':
      return hex_md5(`GOOGLE:${domain}:${type}`)
    case 'IP-API':
      return hex_md5(`IP-API:${domain}`)
    case 'Cloudflare':
      return hex_md5(`CLOUDFLARE:${domain}:${type}`)
    case 'Ali':
      return hex_md5(`ALI:${domain}:${type}`)
    case 'Tencent':
      return hex_md5(`TENCENT:${domain}:${type}`)
  }
}

async function getCachedDomainResolverResult(
  provider: string,
  domain: string,
  type: string,
  cache: any,
  url: any,
  tlsSkipCertVerify: any,
): Promise<any> {
  if (cache === 'disabled') return null
  const id = getDomainResolverCacheId(
    provider,
    domain,
    type,
    url,
    tlsSkipCertVerify,
  )
  const cached = id ? await resourceCache.get(id) : null
  return provider === 'Custom' ? unpackCustomDnsCachedResult(cached) : cached
}

function formatResolverUrlLog(provider: string, resolverUrl: any): string {
  if (provider !== 'Custom' || !resolverUrl) return ''
  const urls = `${resolverUrl}`
    .split(/\r?\n/)
    .map((item: string) => item.trim())
    .filter((item: string) => item)
  if (urls.length <= 1) return ` via ${resolverUrl}`
  return ` via ${urls.length} custom DNS`
}

function formatResolverUrlInfo(provider: string, resolverUrl: any): string {
  if (provider !== 'Custom' || !resolverUrl) return resolverUrl || ''
  const urls = `${resolverUrl}`
    .split(/\r?\n/)
    .map((item: string) => item.trim())
    .filter((item: string) => item)
  if (urls.length <= 1) return resolverUrl
  return `${urls.length} custom DNS`
}

function annotateCustomDnsResult(result: any, resolverUrl: any): any {
  if (result && typeof result === 'object') {
    Object.defineProperty(result, '_resolverUrl', {
      value: resolverUrl,
      enumerable: false,
      configurable: true,
    })
  }
  return result
}

function packCustomDnsCachedResult(
  result: any,
  resolverUrl: any,
): { result: any; resolverUrl: any } {
  return {
    result,
    resolverUrl,
  }
}

function unpackCustomDnsCachedResult(cached: any): any {
  if (
    cached &&
    typeof cached === 'object' &&
    !Array.isArray(cached) &&
    Array.isArray(cached.result)
  ) {
    return annotateCustomDnsResult(cached.result, cached.resolverUrl)
  }
  return cached
}

function getCustomDnsResultResolverUrl(result: any): any {
  return result && typeof result === 'object' ? result._resolverUrl : null
}

// 返回 { body: string } 以保持 $.http.get 的调用形状
async function httpGet(
  url: string,
  headers?: Record<string, string>,
  timeout?: number,
): Promise<{ body: string }> {
  const res = await fetch(url, {
    headers,
    signal: timeout != null ? AbortSignal.timeout(timeout) : undefined,
  })
  if (!res.ok)
    throw upstreamHttpError(
      res.status,
      url,
      headers?.['User-Agent'] || '',
      Object.fromEntries(res.headers),
    )
  return { body: await res.text() }
}

type DomainResolverFn = (
  domain: string,
  type: string,
  noCache: boolean,
  timeout: number | undefined,
  edns: string | undefined,
  url: string | undefined,
  tlsSkipCertVerify: boolean | undefined,
  dnsConcurrency: number | undefined,
  cacheTtl: number | undefined,
) => Promise<any>

const DOMAIN_RESOLVERS: Record<string, DomainResolverFn | undefined> = {
  Custom: async function (
    domain,
    type,
    noCache,
    timeout,
    edns,
    url,
    tlsSkipCertVerify,
    dnsConcurrency,
    cacheTtl,
  ) {
    const urls = parseCustomDnsUrls(url)
    const normalizedUrl = urls.join('\n')
    const customDnsConcurrency =
      normalizeResolveDomainCustomDnsConcurrency(dnsConcurrency)
    const id = hex_md5(
      `CUSTOM:${
        tlsSkipCertVerify ? 'INSECURE:' : ''
      }${normalizedUrl}:${domain}:${type}`,
    )
    const cached = unpackCustomDnsCachedResult(await resourceCache.get(id))
    if (!noCache && cached) return cached
    const answerType = type === 'IPv6' ? 'AAAA' : 'A'
    const resolveUrl = async (resolverUrl: string) => {
      const res = await resolveDns({
        url: resolverUrl,
        domain,
        type: answerType,
        timeout,
        edns,
        skipCertVerify: tlsSkipCertVerify,
      })

      const { answers } = res
      if (!Array.isArray(answers) || answers.length === 0) {
        throw new Error('No answers')
      }
      const result = (answers as any[])
        .filter((i: any) => i?.type === answerType)
        .map((i: any) => i?.data)
        .filter((i: any) => i)
      if (result.length === 0) {
        throw new Error('No answers')
      }
      return result
    }
    const { result, resolverUrl } =
      urls.length === 1
        ? { result: await resolveUrl(urls[0]), resolverUrl: urls[0] }
        : await resolveWithCustomDnsConcurrency(
            urls,
            customDnsConcurrency,
            resolveUrl,
          )
    await resourceCache.set(
      id,
      packCustomDnsCachedResult(result, resolverUrl),
      cacheTtl,
    )
    return annotateCustomDnsResult(result, resolverUrl)
  },
  Google: async function (
    domain,
    type,
    noCache,
    timeout,
    edns,
    _url,
    _tlsSkipCertVerify,
    _dnsConcurrency,
    cacheTtl,
  ) {
    const id = hex_md5(`GOOGLE:${domain}:${type}`)
    const cached = await resourceCache.get(id)
    if (!noCache && cached) return cached
    const answerType = type === 'IPv6' ? 'AAAA' : 'A'
    const res = await resolveDns({
      url: 'https://8.8.4.4/dns-query',
      domain,
      type: answerType,
      timeout,
      edns,
    })

    const { answers } = res
    if (!Array.isArray(answers) || answers.length === 0) {
      throw new Error('No answers')
    }
    const result = (answers as any[])
      .filter((i: any) => i?.type === answerType)
      .map((i: any) => i?.data)
      .filter((i: any) => i)
    if (result.length === 0) {
      throw new Error('No answers')
    }
    await resourceCache.set(id, result, cacheTtl)
    return result
  },
  'IP-API': async function (
    domain,
    type,
    noCache,
    timeout,
    _edns,
    _url,
    _tlsSkipCertVerify,
    _dnsConcurrency,
    cacheTtl,
  ) {
    if (['IPv6'].includes(type)) {
      throw new Error(`域名解析服务提供方 IP-API 不支持 ${type}`)
    }
    const id = hex_md5(`IP-API:${domain}`)
    const cached = await resourceCache.get(id)
    if (!noCache && cached) return cached
    const resp = await httpGet(
      `http://ip-api.com/json/${encodeURIComponent(domain)}?lang=zh-CN`,
      undefined,
      timeout,
    )
    const body = JSON.parse(resp.body)
    if (body['status'] !== 'success') {
      throw new Error(`Status is ${body['status']}`)
    }
    if (!body.query || body.query === 0) {
      throw new Error('No answers')
    }
    const result = [body.query]
    if (result.length === 0) {
      throw new Error('No answers')
    }
    await resourceCache.set(id, result, cacheTtl)
    return result
  },
  Cloudflare: async function (
    domain,
    type,
    noCache,
    timeout,
    edns,
    _url,
    _tlsSkipCertVerify,
    _dnsConcurrency,
    cacheTtl,
  ) {
    const id = hex_md5(`CLOUDFLARE:${domain}:${type}`)
    const cached = await resourceCache.get(id)
    if (!noCache && cached) return cached
    const answerType = type === 'IPv6' ? 'AAAA' : 'A'
    const res = await resolveDns({
      url: 'https://1.0.0.1/dns-query',
      domain,
      type: answerType,
      timeout,
      edns,
    })

    const { answers } = res
    if (!Array.isArray(answers) || answers.length === 0) {
      throw new Error('No answers')
    }
    const result = (answers as any[])
      .filter((i: any) => i?.type === answerType)
      .map((i: any) => i?.data)
      .filter((i: any) => i)
    if (result.length === 0) {
      throw new Error('No answers')
    }
    await resourceCache.set(id, result, cacheTtl)
    return result
  },
  Ali: async function (
    domain,
    type,
    noCache,
    timeout,
    edns,
    _url,
    _tlsSkipCertVerify,
    _dnsConcurrency,
    cacheTtl,
  ) {
    const id = hex_md5(`ALI:${domain}:${type}`)
    const cached = await resourceCache.get(id)
    if (!noCache && cached) return cached
    const resp = await httpGet(
      `http://223.6.6.6/resolve?edns_client_subnet=${edns}/${
        isIPv4(edns as string) ? 24 : 56
      }&name=${encodeURIComponent(domain)}&type=${
        type === 'IPv6' ? 'AAAA' : 'A'
      }&short=1`,
      {
        accept: 'application/dns-json',
      },
      timeout,
    )
    const answers = JSON.parse(resp.body)
    if (!Array.isArray(answers) || answers.length === 0) {
      throw new Error('No answers')
    }
    const result = answers
    if (result.length === 0) {
      throw new Error('No answers')
    }
    await resourceCache.set(id, result, cacheTtl)
    return result
  },
  Tencent: async function (
    domain,
    type,
    noCache,
    timeout,
    edns,
    _url,
    _tlsSkipCertVerify,
    _dnsConcurrency,
    cacheTtl,
  ) {
    const id = hex_md5(`TENCENT:${domain}:${type}`)
    const cached = await resourceCache.get(id)
    if (!noCache && cached) return cached
    const resp = await httpGet(
      `http://119.28.28.28/d?ip=${edns}&type=${
        type === 'IPv6' ? 'AAAA' : 'A'
      }&dn=${encodeURIComponent(domain)}`,
      {
        accept: 'application/dns-json',
      },
      timeout,
    )
    const answers = resp.body.split(';').map((i: string) => i.split(',')[0])
    if (answers.length === 0 || String(answers) === '0') {
      throw new Error('No answers')
    }
    const result = answers
    if (result.length === 0) {
      throw new Error('No answers')
    }
    await resourceCache.set(id, result, cacheTtl)
    return result
  },
}

function ResolveDomainOperator({
  provider,
  type: _type,
  filter,
  cache,
  url,
  tlsSkipCertVerify,
  timeout,
  cacheTtl,
  edns: _edns,
  concurrency: _concurrency,
  dnsConcurrency: _dnsConcurrency,
}: any): ProcessorResult {
  if (['IPv6', 'IP4P'].includes(_type) && ['IP-API'].includes(provider)) {
    throw new Error(`域名解析服务提供方 ${provider} 不支持 ${_type}`)
  }
  const { defaultTimeout } = ($.read(SETTINGS_KEY) as any) || {}
  const requestTimeout = normalizeResolveDomainTimeout(timeout, defaultTimeout)
  const domainResolverCacheTtl = normalizeResolveDomainCacheTtl(cacheTtl)
  const type = ['IPv6', 'IP4P'].includes(_type) ? 'IPv6' : 'IPv4'

  const resolver = DOMAIN_RESOLVERS[provider]
  if (!resolver) {
    throw new Error(`找不到域名解析服务提供方: ${provider}`)
  }
  const edns = _edns || '223.6.6.6'
  if (!isIP(edns)) throw new Error(`域名解析 EDNS 应为 IP`)
  const concurrency = normalizeResolveDomainConcurrency(_concurrency)
  const customDnsUrl =
    provider === 'Custom' ? normalizeCustomDnsUrlList(url) : url
  const customDnsCount =
    provider === 'Custom' ? parseCustomDnsUrls(customDnsUrl).length : 1
  const customDnsConcurrency =
    provider === 'Custom'
      ? normalizeResolveDomainCustomDnsConcurrency(_dnsConcurrency)
      : 1
  const totalConcurrency =
    concurrency * Math.min(customDnsConcurrency, customDnsCount)
  const customDnsTlsSkipCertVerify =
    provider === 'Custom' &&
    (tlsSkipCertVerify === true || tlsSkipCertVerify === 'enabled')
  if (totalConcurrency > RESOLVE_DOMAIN_CONCURRENCY_WARN_THRESHOLD) {
    $.warn(
      `域名解析总并发数上限 ${totalConcurrency} 超过建议值 ${RESOLVE_DOMAIN_CONCURRENCY_WARN_THRESHOLD}, 可能导致代理 App TCP 连接数激增`,
    )
  }
  $.info(
    `Domain Resolver: [${_type}] ${provider} ${edns || ''} ${formatResolverUrlInfo(
      provider,
      customDnsUrl,
    )}${
      customDnsTlsSkipCertVerify ? ' tlsSkipCertVerify=enabled' : ''
    } concurrency=${concurrency}${
      provider === 'Custom' ? ` dnsConcurrency=${customDnsConcurrency}` : ''
    }`,
  )
  return {
    name: 'Resolve Domain Operator',
    func: async (proxies: any) => {
      proxies.forEach((p: any, i: number) => {
        if (!p['_no-resolve'] && p['no-resolve']) {
          proxies[i]['_no-resolve'] = p['no-resolve']
        }
      })
      const results: Record<string, any> = {}
      const domains: any[] = [
        ...new Map(
          proxies
            .filter((p: any) => !isIP(p.server) && !p['_no-resolve'])
            .map((p: any) => {
              const id = getDomainResolverCacheId(
                provider,
                p.server,
                type,
                customDnsUrl,
                customDnsTlsSkipCertVerify,
              )
              return [id, { id, domain: p.server }]
            }),
        ).values(),
      ]
      const domainsToResolve: any[] = []
      const failures: { source: string; message: string }[] = []
      for (const { id, domain } of domains) {
        const cached = await getCachedDomainResolverResult(
          provider,
          domain,
          type,
          cache,
          customDnsUrl,
          customDnsTlsSkipCertVerify,
        )
        if (cached) {
          results[id] = cached
          const resolverUrl =
            provider === 'Custom'
              ? getCustomDnsResultResolverUrl(cached) || customDnsUrl
              : customDnsUrl
          $.info(
            `Using cached resolved domain: ${domain}${formatResolverUrlLog(
              provider,
              resolverUrl,
            )} ➟ ${cached}`,
          )
        } else {
          domainsToResolve.push({ id, domain })
        }
      }
      await resolveDomainsWithConcurrency(
        domainsToResolve,
        concurrency,
        async ({ id, domain }: any) => {
          try {
            const ip = await resolver(
              domain,
              type,
              cache === 'disabled',
              requestTimeout,
              edns,
              customDnsUrl,
              customDnsTlsSkipCertVerify,
              customDnsConcurrency,
              domainResolverCacheTtl,
            )
            results[id] = ip
            const resolverUrl =
              provider === 'Custom'
                ? getCustomDnsResultResolverUrl(ip) || customDnsUrl
                : customDnsUrl
            $.info(
              `Successfully resolved domain: ${domain}${formatResolverUrlLog(
                provider,
                resolverUrl,
              )} ➟ ${ip}`,
            )
          } catch (err: any) {
            failures.push({
              source: domain,
              message: String(err?.message ?? err),
            })
          }
        },
      )
      proxies.forEach((p: any) => {
        if (!p['_no-resolve']) {
          const id = getDomainResolverCacheId(
            provider,
            p.server,
            type,
            customDnsUrl,
            customDnsTlsSkipCertVerify,
          )
          if (id && results[id]) {
            p._resolved_ips = results[id]
            let ip = Array.isArray(results[id])
              ? results[id][Math.floor(Math.random() * results[id].length)]
              : results[id]
            if (type === 'IPv6' && isIPv6(ip)) {
              try {
                ip = new ipAddress.Address6(ip).correctForm()
              } catch (e: any) {
                $.warn(`Failed to parse IPv6 address: ${ip}: ${e}`)
              }
              if (/^2001::[^:]+:[^:]+:[^:]+$/.test(ip)) {
                p._IP4P = ip
                const { server, port } = parseIP4P(ip)
                if (server && port) {
                  p._domain = p.server
                  p.server = server
                  p.port = port
                  p.resolved = true
                  p._IPv4 = p.server
                  if (!isIP(p._IP)) {
                    p._IP = p.server
                  }
                } else if (!p.resolved) {
                  p.resolved = false
                }
              } else {
                p._domain = p.server
                p.server = ip
                p.resolved = true
                p[`_${type}`] = p.server
                if (!isIP(p._IP)) {
                  p._IP = p.server
                }
              }
            } else {
              p._domain = p.server
              p.server = ip
              p.resolved = true
              p[`_${type}`] = p.server
              if (!isIP(p._IP)) {
                p._IP = p.server
              }
            }
          } else if (!p.resolved) {
            p.resolved = false
          }
        }
      })

      const output = proxies.filter((p: any) => {
        if (filter === 'removeFailed') {
          return isIP(p.server) || p['_no-resolve'] || p.resolved
        } else if (filter === 'IPOnly') {
          return isIP(p.server)
        } else if (filter === 'IPv4Only') {
          return isIPv4(p.server)
        } else if (filter === 'IPv6Only') {
          return isIPv6(p.server)
        } else {
          return true
        }
      })
      if (failures.length) {
        if (!output.length)
          throw new RequestInvalidError(
            'DNS_RESOLUTION_FAILED',
            '域名解析失败，没有可用节点',
            { failures },
          )
        $.warn(`${failures.length} 个域名解析失败`, {
          code: 'DNS_RESOLUTION_FAILED',
          provider,
          failures,
        })
      }
      return output
    },
  }
}

function isIP(ip: any): boolean {
  return isIPv4(ip) || isIPv6(ip)
}

// TS 不允许函数 expando 赋值;用 Object.assign 保持 ResolveDomainOperator.resolver
// 运行时可访问(仓库内无 TS 侧访问点)
Object.assign(ResolveDomainOperator, { resolver: DOMAIN_RESOLVERS })

function isAscii(str: string): boolean {
  // ASCII 范围的 Unicode 编码;两端为控制字符,用 fromCharCode 拼装等价字符类
  const pattern = new RegExp(
    `^[${String.fromCharCode(0x00)}-${String.fromCharCode(0x7f)}]+$`,
  )
  return pattern.test(str)
}

/** ************************** Filters ***************************************/
// filter useless proxies
function UselessFilter(): ProcessorResult {
  return {
    name: 'Useless Filter',
    func: (proxies: any) => {
      return proxies.map((proxy: any) => {
        if (proxy.cipher && !isAscii(proxy.cipher)) {
          return false
        } else if (proxy.password && !isAscii(proxy.password)) {
          return false
        } else {
          if (proxy.network) {
            let transportHosts =
              proxy[`${proxy.network}-opts`]?.headers?.Host ||
              proxy[`${proxy.network}-opts`]?.headers?.host
            transportHosts = Array.isArray(transportHosts)
              ? transportHosts
              : [transportHosts]
            if (
              (transportHosts as any[]).some(
                (host: any) => host && !isAscii(host),
              )
            ) {
              return false
            }
          }
          return !/网址|流量|时间|应急|过期|Bandwidth|expire/.test(proxy.name)
        }
      })
    },
  }
}

// filter by regions
function RegionFilter(input: any): ProcessorResult {
  let regions = input?.value || input
  if (!Array.isArray(regions)) {
    regions = []
  }
  const keep = input?.keep ?? true
  const REGION_MAP: Record<string, string> = {
    HK: '🇭🇰',
    TW: '🇹🇼',
    US: '🇺🇸',
    SG: '🇸🇬',
    JP: '🇯🇵',
    UK: '🇬🇧',
    DE: '🇩🇪',
    KR: '🇰🇷',
  }
  return {
    name: 'Region Filter',
    func: (proxies: any) => {
      // this would be high memory usage
      return proxies.map((proxy: any) => {
        const flag = getFlag(proxy.name)
        const selected = (regions as any[]).some(
          (r: string) => REGION_MAP[r] === flag,
        )
        return keep ? selected : !selected
      })
    },
  }
}

// filter by regex
function RegexFilter({ regex = [], keep = true }: any): ProcessorResult {
  return {
    name: 'Regex Filter',
    func: (proxies: any) => {
      return proxies.map((proxy: any) => {
        const selected = (regex as any[]).some((r: any) => {
          return buildRegex(r).test(proxy.name)
        })
        return keep ? selected : !selected
      })
    },
  }
}

function buildRegex(str: string, ...options: string[]): RegExp {
  const flags = options.join('')
  if (str.startsWith('(?i)')) {
    str = str.substring(4)
    return new RegExp(str, 'i' + flags)
  } else {
    return new RegExp(str, flags)
  }
}

// filter by proxy types
function TypeFilter(input: any): ProcessorResult {
  let types = input?.value || input
  if (!Array.isArray(types)) {
    types = []
  }
  const keep = input?.keep ?? true
  return {
    name: 'Type Filter',
    func: (proxies: any) => {
      return proxies.map((proxy: any) => {
        const selected = (types as any[]).some((t: string) => proxy.type === t)
        return keep ? selected : !selected
      })
    },
  }
}

/**
 Script Example

 function filter(proxies) {
        return proxies.map(p => {
            return p.name.indexOf('🇭🇰') !== -1;
        });
     }

 WARNING:
 1. This function name should be `filter`!
 2. Always declare variables before using them!
 */
function ScriptFilter(
  script: string,
  targetPlatform: string,
  $arguments: any,
  source: string,
  $options: any,
  context: any,
): ProcessorResult {
  context.source = source
  context.env = env
  return {
    name: 'Script Filter',
    func: async (proxies: any) => {
      let output: any = FULL(proxies.length, true)
      await (async function () {
        const filter = await createDynamicFunction(
          'filter',
          script,
          $arguments,
          $options,
        )
        output = await filter(proxies, targetPlatform, context)
      })()
      return output
    },
    nodeFunc: async (proxies: any) => {
      let output: any = FULL(proxies.length, true)
      await (async function () {
        const filter = await createDynamicFunction(
          'filter',
          `async function filter(input = [], targetPlatform, context) {
                        let proxies = input
                        let list = []
                        const fn = async ($server) => {
                            ${script}
                        }
                        for await (let $server of proxies) {
                            list.push(await fn($server))
                        }
                        return list
                      }`,
          $arguments,
          $options,
        )
        output = await filter(proxies, targetPlatform, context)
      })()
      return output
    },
  }
}

function ResponseTransformer(
  script: string,
  _targetPlatform: string,
  $arguments: any,
  source: string,
  $options: any,
  context: any,
): ProcessorResult {
  context.source = source
  context.env = env
  return {
    name: RESPONSE_TRANSFORMER,
    func: async (res: any) => {
      let output = res
      await (async function () {
        const transformFunction: any = await createDynamicFunction(
          'transformFunction',
          script,
          $arguments,
          $options,
        )
        output = await transformFunction(res, context)
      })()
      return output
    },
    shortcutFunc: async (res: any) => {
      let output = res
      await (async function () {
        const transformFunction: any = await createDynamicFunction(
          'transformFunction',
          `async function transformFunction(res = {}, context) {
                        let $res = res
                        ${script}
                        return $res
                      }`,
          $arguments,
          $options,
        )
        output = await transformFunction(res, context)
      })()
      return output
    },
  }
}

const processors: Record<
  string,
  ((...args: any[]) => ProcessorResult) | undefined
> = {
  'Useless Filter': UselessFilter,
  'Region Filter': RegionFilter,
  'Regex Filter': RegexFilter,
  'Type Filter': TypeFilter,
  'Script Filter': ScriptFilter,
  'Conditional Filter': ConditionalFilter,

  'Quick Setting Operator': QuickSettingOperator,
  'Flag Operator': FlagOperator,
  'Sort Operator': SortOperator,
  'Regex Sort Operator': RegexSortOperator,
  'Regex Rename Operator': RegexRenameOperator,
  'Regex Delete Operator': RegexDeleteOperator,
  'Script Operator': ScriptOperator,
  [RESPONSE_TRANSFORMER]: ResponseTransformer,
  'Handle Duplicate Operator': HandleDuplicateOperator,
  'Resolve Domain Operator': ResolveDomainOperator,
}

export default processors

/** 仅在识别到快捷语法时切换入口；运行失败原样上抛，不重复执行。 */
function needsShortcut(
  error: unknown,
  fnName: string,
  variable: string,
): boolean {
  const message = String(
    (error as { message?: unknown } | null | undefined)?.message ?? error,
  )
  return (
    message === `user script must declare function ${fnName}()` ||
    message === `script shortcut: ${variable} is not defined` ||
    // 带 await 的快捷语法无法在同步工厂中编译；编译失败没有执行用户代码。
    (error instanceof RequestInvalidError &&
      error.code === 'SCRIPT_SYNTAX_ERROR' &&
      error.shortcutSyntax === true)
  )
}

async function applyScriptEntry(
  primary: () => Promise<any>,
  shortcut: (() => Promise<any>) | undefined,
  fnName: string,
  variable: string,
): Promise<any> {
  try {
    return await primary()
  } catch (error) {
    if (!shortcut || !needsShortcut(error, fnName, variable)) throw error
    return shortcut()
  }
}

export async function ApplyResponseTransformer(
  transformer: any,
  res: any,
): Promise<any> {
  const result = await applyScriptEntry(
    () => transformer.func(res),
    transformer.shortcutFunc ? () => transformer.shortcutFunc(res) : undefined,
    'transformFunction',
    '$res',
  )
  return result || res
}

async function ApplyFilter(filter: any, objs: any): Promise<any> {
  const selected = await applyScriptEntry(
    () => filter.func(objs),
    filter.nodeFunc ? () => filter.nodeFunc(objs) : undefined,
    'filter',
    '$server',
  )
  return objs.filter((_: any, i: number) => selected[i])
}

async function ApplyOperator(operator: any, objs: any): Promise<any> {
  const output = clone(objs)
  const result = await applyScriptEntry(
    () => operator.func(output),
    operator.nodeFunc ? () => operator.nodeFunc(clone(objs)) : undefined,
    'operator',
    '$server',
  )
  return result || output
}

export async function ApplyProcessor(processor: any, objs: any): Promise<any> {
  if (processor.name.indexOf('Filter') !== -1) {
    return ApplyFilter(processor, objs)
  } else if (processor.name.indexOf('Operator') !== -1) {
    return ApplyOperator(processor, objs)
  }
}

// shuffle array
function shuffle(array: any[]): any[] {
  let currentIndex = array.length,
    temporaryValue,
    randomIndex

  // While there remain elements to shuffle...
  while (0 !== currentIndex) {
    // Pick a remaining element...
    randomIndex = Math.floor(Math.random() * currentIndex)
    currentIndex -= 1

    // And swap it with the current element.
    temporaryValue = array[currentIndex]
    array[currentIndex] = array[randomIndex]
    array[randomIndex] = temporaryValue
  }

  return array
}

// deep clone object
function clone(object: any): any {
  return JSON.parse(JSON.stringify(object))
}

// Workers 禁止动态求值,所有调用点已改为 user-script 沙箱实现;
// 原注入沙箱的依赖($arguments/$options/$sukiSub/lodash/ProxyUtils/yaml/
// Buffer/b64d/b64e/DOMAIN_RESOLVERS/scriptResourceCache/flowUtils/
// produceArtifact/require)由沙箱执行器环境负责提供。
