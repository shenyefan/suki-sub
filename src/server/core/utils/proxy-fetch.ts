/**
 * 拉取代理:基于 cloudflare:sockets TCP 隧道的官方实现。
 * 支持 http:// 与 https:// 代理(CONNECT 隧道)以及 socks5:// / socks5h:// 代理;
 * 目标为 https 站点时经 startTls() 升级 TLS。适用于来源站按出口 IP 白名单放行的场景。
 */
import { connect } from 'cloudflare:sockets'
import { RequestInvalidError } from '../errors'

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const HEADER_END = encoder.encode('\r\n\r\n')
const MAX_REDIRECTS = 10

interface ProxyEndpoint {
  protocol: 'http' | 'https' | 'socks5'
  hostname: string
  port: number
  username: string
  password: string
}

export interface ProxyHttpRequestOptions {
  headers?: Record<string, string>
  timeout?: number | string
  proxy: string
}

export interface ProxyHttpResult {
  headers: Record<string, string>
  body: string
  statusCode: number
}

/** 解析代理地址;空值返回 null,由调用方回退直连。 */
export function parseProxyUrl(value: unknown): ProxyEndpoint | null {
  if (value == null || String(value).trim() === '') return null
  const input = String(value).trim()
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new RequestInvalidError(
      'PROXY_URL_INVALID',
      '拉取代理地址格式无效',
      // 只保留主机部分,避免凭据进入错误详情。
      { proxy: input.split('@').pop() },
    )
  }
  const protocol = url.protocol.replace(/:$/, '').toLowerCase()
  const kind =
    protocol === 'http'
      ? 'http'
      : protocol === 'https'
        ? 'https'
        : ['socks', 'socks5', 'socks5h'].includes(protocol)
          ? 'socks5'
          : null
  if (!kind)
    throw new RequestInvalidError(
      'PROXY_PROTOCOL_UNSUPPORTED',
      '拉取代理仅支持 http、https 与 socks5 协议',
      { proxy: `${protocol}://…` },
    )
  const port = url.port
    ? Number(url.port)
    : kind === 'https'
      ? 443
      : kind === 'socks5'
        ? 1080
        : 80
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new RequestInvalidError('PROXY_URL_INVALID', '拉取代理端口无效', {
      proxy: `${url.protocol}//${url.hostname}`,
    })
  return {
    protocol: kind,
    hostname: url.hostname.replace(/^\[|\]$/g, ''),
    port,
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
  }
}

function indexOfSequence(haystack: Uint8Array, needle: Uint8Array): number {
  if (!needle.length || haystack.length < needle.length) return -1
  const last = haystack.length - needle.length
  for (let i = 0; i <= last; i++) {
    if (haystack[i] !== needle[0]) continue
    let matched = true
    for (let j = 1; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) {
        matched = false
        break
      }
    }
    if (matched) return i
  }
  return -1
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

function targetPort(target: URL): number {
  if (target.port) return Number(target.port)
  return target.protocol === 'https:' ? 443 : 80
}

/** 带缓冲的响应读取:按行、按字节或读到连接关闭,处理分块到达的数据。 */
class SocketReader {
  private buffer = new Uint8Array(0)
  private eof = false
  constructor(
    private readonly reader: ReadableStreamDefaultReader<Uint8Array>,
  ) {}

  private async fill(): Promise<void> {
    if (this.eof) return
    const { done, value } = await this.reader.read()
    if (done) {
      this.eof = true
      return
    }
    const merged = new Uint8Array(this.buffer.length + value.length)
    merged.set(this.buffer)
    merged.set(value, this.buffer.length)
    this.buffer = merged
  }

  private consume(length: number): Uint8Array {
    const out = this.buffer.subarray(0, length)
    this.buffer = this.buffer.subarray(length)
    return out
  }

  async readLine(limit = 65536): Promise<string> {
    for (;;) {
      for (let i = 0; i < this.buffer.length; i++) {
        if (this.buffer[i] !== 0x0a) continue
        const end = i > 0 && this.buffer[i - 1] === 0x0d ? i - 1 : i
        const chunk = this.consume(i + 1)
        return decoder.decode(chunk.subarray(0, end))
      }
      if (this.buffer.length > limit)
        throw new RequestInvalidError(
          'PROXY_RESPONSE_INVALID',
          '代理响应行超长',
        )
      await this.fill()
      if (this.eof)
        throw new RequestInvalidError(
          'PROXY_RESPONSE_INVALID',
          '代理连接在响应结束前关闭',
        )
    }
  }

  async readHeaders(limit = 262144): Promise<string> {
    for (;;) {
      const index = indexOfSequence(this.buffer, HEADER_END)
      if (index >= 0) {
        return decoder.decode(this.consume(index + HEADER_END.length))
      }
      if (this.buffer.length > limit)
        throw new RequestInvalidError(
          'PROXY_RESPONSE_INVALID',
          '代理响应头过大',
        )
      await this.fill()
      if (this.eof)
        throw new RequestInvalidError(
          'PROXY_RESPONSE_INVALID',
          '代理连接在响应结束前关闭',
        )
    }
  }

  async readBytes(length: number): Promise<Uint8Array> {
    while (this.buffer.length < length) {
      await this.fill()
      if (this.eof)
        throw new RequestInvalidError(
          'PROXY_RESPONSE_INVALID',
          '代理连接在响应结束前关闭',
        )
    }
    return this.consume(length)
  }

  async readToEnd(): Promise<Uint8Array> {
    while (!this.eof) await this.fill()
    return this.consume(this.buffer.length)
  }

  release(): void {
    this.reader.releaseLock()
  }
}

function parseResponseHead(head: string): {
  statusCode: number
  headers: Record<string, string>
} {
  const lines = head.split('\r\n')
  const statusCode = Number(/^HTTP\/[\d.]+\s+(\d{3})/i.exec(lines[0])?.[1])
  const headers: Record<string, string> = {}
  for (const line of lines.slice(1)) {
    const index = line.indexOf(':')
    if (index <= 0) continue
    const key = line.slice(0, index).trim().toLowerCase()
    const value = line.slice(index + 1).trim()
    headers[key] = headers[key] ? `${headers[key]}, ${value}` : value
  }
  return { statusCode, headers }
}

async function establishSocks5Tunnel(
  writer: WritableStreamDefaultWriter<Uint8Array>,
  reader: SocketReader,
  target: URL,
  proxy: ProxyEndpoint,
): Promise<void> {
  const hasAuth = Boolean(proxy.username || proxy.password)
  const methods = hasAuth ? [0x00, 0x02] : [0x00]
  await writer.write(
    concatBytes([
      Uint8Array.of(0x05, methods.length),
      Uint8Array.of(...methods),
    ]),
  )
  const method = await reader.readBytes(2)
  if (method[0] !== 0x05)
    throw new RequestInvalidError(
      'PROXY_RESPONSE_INVALID',
      '代理返回的 SOCKS 版本不受支持',
    )
  if (method[1] === 0xff)
    throw new RequestInvalidError(
      'PROXY_AUTH_UNSUPPORTED',
      '代理不接受任何可用的认证方式',
    )
  if (method[1] === 0x02) {
    const user = encoder.encode(proxy.username)
    const password = encoder.encode(proxy.password)
    if (user.length > 255 || password.length > 255)
      throw new RequestInvalidError(
        'PROXY_AUTH_INVALID',
        '代理用户名或密码过长',
      )
    await writer.write(
      concatBytes([
        Uint8Array.of(0x01, user.length),
        user,
        Uint8Array.of(password.length),
        password,
      ]),
    )
    const auth = await reader.readBytes(2)
    if (auth[0] !== 0x01 || auth[1] !== 0x00)
      throw new RequestInvalidError(
        'PROXY_AUTH_FAILED',
        '代理用户名或密码认证失败',
      )
  }
  const host = encoder.encode(target.hostname)
  if (host.length > 255)
    throw new RequestInvalidError('PROXY_URL_INVALID', '目标主机名过长')
  const port = targetPort(target)
  await writer.write(
    concatBytes([
      Uint8Array.of(0x05, 0x01, 0x00, 0x03, host.length),
      host,
      Uint8Array.of((port >> 8) & 0xff, port & 0xff),
    ]),
  )
  const reply = await reader.readBytes(4)
  if (reply[0] !== 0x05)
    throw new RequestInvalidError(
      'PROXY_RESPONSE_INVALID',
      '代理返回的 SOCKS 版本不受支持',
    )
  if (reply[1] !== 0x00)
    throw new RequestInvalidError(
      'PROXY_CONNECT_REJECTED',
      `代理拒绝连接目标主机(SOCKS 错误码 ${reply[1]})`,
    )
  let addressLength = -1
  if (reply[3] === 0x01) addressLength = 4
  else if (reply[3] === 0x04) addressLength = 16
  else if (reply[3] === 0x03) addressLength = (await reader.readBytes(1))[0]
  if (addressLength < 0)
    throw new RequestInvalidError(
      'PROXY_RESPONSE_INVALID',
      '代理返回的 SOCKS 地址类型不受支持',
    )
  // 丢弃绑定地址与端口,隧道就绪。
  await reader.readBytes(addressLength + 2)
}

async function establishHttpTunnel(
  writer: WritableStreamDefaultWriter<Uint8Array>,
  reader: SocketReader,
  target: URL,
  proxy: ProxyEndpoint,
): Promise<void> {
  const authority = `${target.hostname}:${targetPort(target)}`
  const lines = [`CONNECT ${authority} HTTP/1.1`, `Host: ${authority}`]
  if (proxy.username || proxy.password)
    lines.push(
      `Proxy-Authorization: Basic ${bytesToBase64(
        encoder.encode(`${proxy.username}:${proxy.password}`),
      )}`,
    )
  lines.push('', '')
  await writer.write(encoder.encode(lines.join('\r\n')))
  const { statusCode } = parseResponseHead(await reader.readHeaders())
  if (!Number.isFinite(statusCode))
    throw new RequestInvalidError(
      'PROXY_RESPONSE_INVALID',
      '代理返回了无法解析的 CONNECT 响应',
    )
  if (statusCode < 200 || statusCode >= 300)
    throw new RequestInvalidError(
      'PROXY_CONNECT_REJECTED',
      statusCode === 407
        ? '代理认证失败(HTTP 407)'
        : `代理拒绝建立隧道(HTTP ${statusCode})`,
    )
}

function buildRequestHead(
  method: 'GET' | 'HEAD',
  target: URL,
  headers: Record<string, string>,
  absoluteForm: boolean,
  proxy?: ProxyEndpoint,
): string {
  const requestTarget = absoluteForm
    ? `${target.protocol}//${target.host}${target.pathname}${target.search}`
    : `${target.pathname}${target.search}`
  const lines = [`${method} ${requestTarget} HTTP/1.1`, `Host: ${target.host}`]
  if (absoluteForm && proxy && (proxy.username || proxy.password))
    lines.push(
      `Proxy-Authorization: Basic ${bytesToBase64(
        encoder.encode(`${proxy.username}:${proxy.password}`),
      )}`,
    )
  const skip = [
    'host',
    'connection',
    'accept-encoding',
    'content-length',
    'proxy-authorization',
  ]
  for (const [key, value] of Object.entries(headers)) {
    if (!skip.includes(key.toLowerCase())) lines.push(`${key}: ${value}`)
  }
  lines.push('accept-encoding: identity', 'connection: close', '', '')
  return lines.join('\r\n')
}

async function readBody(
  reader: SocketReader,
  headers: Record<string, string>,
  method: 'GET' | 'HEAD',
): Promise<Uint8Array> {
  if (method === 'HEAD') return new Uint8Array(0)
  if ((headers['transfer-encoding'] || '').toLowerCase().includes('chunked')) {
    const parts: Uint8Array[] = []
    for (;;) {
      const size = Number.parseInt(
        (await reader.readLine()).split(';')[0].trim(),
        16,
      )
      if (!Number.isFinite(size) || size < 0)
        throw new RequestInvalidError(
          'PROXY_RESPONSE_INVALID',
          '代理响应的分块长度无效',
        )
      if (size === 0) {
        // 0 长度分块后是拖车字段,读到空行即结束。
        for (let i = 0; i < 64; i++) {
          if ((await reader.readLine()) === '') break
        }
        break
      }
      parts.push(await reader.readBytes(size))
      await reader.readLine()
    }
    return concatBytes(parts)
  }
  const length = Number(headers['content-length'])
  if (Number.isFinite(length) && length >= 0) {
    if (length === 0) return new Uint8Array(0)
    return reader.readBytes(length)
  }
  return reader.readToEnd()
}

async function decodeBody(
  body: Uint8Array,
  headers: Record<string, string>,
): Promise<string> {
  if (!body.length) return ''
  const encoding = (headers['content-encoding'] || '').trim().toLowerCase()
  if (!encoding) return decoder.decode(body)
  if (encoding !== 'gzip' && encoding !== 'x-gzip' && encoding !== 'deflate')
    throw new RequestInvalidError(
      'PROXY_RESPONSE_INVALID',
      `代理响应使用了不支持的压缩格式:${encoding}`,
    )
  try {
    const stream = new Blob([new Uint8Array(body)])
      .stream()
      .pipeThrough(
        new DecompressionStream(encoding === 'deflate' ? 'deflate' : 'gzip'),
      )
    const chunks: Uint8Array[] = []
    const reader = stream.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
    }
    return decoder.decode(concatBytes(chunks))
  } catch {
    throw new RequestInvalidError(
      'PROXY_RESPONSE_INVALID',
      '代理响应内容解压失败',
    )
  }
}

async function exchangeThroughProxy(
  method: 'GET' | 'HEAD',
  target: URL,
  proxy: ProxyEndpoint,
  options: ProxyHttpRequestOptions,
): Promise<ProxyHttpResult> {
  const timeout = Number(options.timeout) || 8000
  const socket = connect(
    { hostname: proxy.hostname, port: proxy.port },
    { allowHalfOpen: false },
  )
  let active = socket
  let timer: ReturnType<typeof setTimeout> | undefined
  const closeActive = () => {
    void active.close().catch(() => {})
  }
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      // 到点强制关闭 socket,使未决读写一并失败释放资源。
      closeActive()
      reject(
        new RequestInvalidError(
          'PROXY_TIMEOUT',
          `拉取代理请求超时(${timeout} 毫秒)`,
        ),
      )
    }, timeout)
  })
  const work = async (): Promise<ProxyHttpResult> => {
    if (proxy.protocol === 'https')
      active = socket.startTls({ expectedServerHostname: proxy.hostname })
    let writer = active.writable.getWriter()
    let reader = new SocketReader(active.readable.getReader())
    if (proxy.protocol === 'socks5')
      await establishSocks5Tunnel(writer, reader, target, proxy)
    else await establishHttpTunnel(writer, reader, target, proxy)
    if (target.protocol === 'https:') {
      writer.releaseLock()
      reader.release()
      active = active.startTls({ expectedServerHostname: target.hostname })
      writer = active.writable.getWriter()
      reader = new SocketReader(active.readable.getReader())
    }
    // http 目标经 HTTP 代理走绝对形式请求行,无需隧道;其余在隧道内用来源形式。
    const absoluteForm =
      proxy.protocol !== 'socks5' && target.protocol !== 'https:'
    await writer.write(
      encoder.encode(
        buildRequestHead(
          method,
          target,
          options.headers || {},
          absoluteForm,
          proxy,
        ),
      ),
    )
    const { statusCode, headers } = parseResponseHead(
      await reader.readHeaders(),
    )
    if (!Number.isFinite(statusCode))
      throw new RequestInvalidError(
        'PROXY_RESPONSE_INVALID',
        '代理返回了无法解析的 HTTP 响应',
      )
    const body = await decodeBody(
      await readBody(reader, headers, method),
      headers,
    )
    return { headers, body, statusCode }
  }
  const workPromise = work()
  try {
    return await Promise.race([workPromise, timeoutPromise])
  } finally {
    clearTimeout(timer)
    // 超时竞速后迟到的失败不再向上抛,统一关闭连接。
    workPromise.catch(() => {})
    closeActive()
  }
}

/** 与原生 fetch 行为对齐:跟随重定向(GET/HEAD 语义不变),最多 10 次。 */
export async function proxyHttpRequest(
  method: 'GET' | 'HEAD',
  url: string,
  options: ProxyHttpRequestOptions,
  redirects = 0,
): Promise<ProxyHttpResult> {
  const proxy = parseProxyUrl(options.proxy)
  if (!proxy)
    throw new RequestInvalidError('PROXY_URL_INVALID', '拉取代理地址不能为空')
  let target: URL
  try {
    target = new URL(url)
  } catch {
    throw new RequestInvalidError(
      'INVALID_SOURCE_URL',
      '来源链接无效，请填写完整的 HTTP 或 HTTPS 地址',
    )
  }
  if (!/^https?:$/.test(target.protocol))
    throw new RequestInvalidError(
      'INVALID_SOURCE_URL',
      '拉取代理仅支持 HTTP 或 HTTPS 目标',
    )
  const response = await exchangeThroughProxy(method, target, proxy, options)
  const location = response.headers['location'] as string | undefined
  if (location && [301, 302, 303, 307, 308].includes(response.statusCode)) {
    if (redirects >= MAX_REDIRECTS)
      throw new RequestInvalidError(
        'PROXY_REDIRECT_LIMIT',
        '代理响应的重定向次数过多',
      )
    return proxyHttpRequest(
      method,
      new URL(location, url).toString(),
      options,
      redirects + 1,
    )
  }
  return response
}
