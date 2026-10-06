/**
 * DNS 解析:DoH(dns-packet + fetch 二进制查询)。
 */
import dnsPacket from 'dns-packet'
import { upstreamHttpError } from './diagnostics'
import { Buffer } from 'node:buffer'
import { isIPv4, isIPv6 } from '#/server/core/utils'

const DNS_DEFAULT_PORT = 53
const DNS_TLS_DEFAULT_PORT = 853

function buildDnsQuery({ domain, type = 'A', edns }: any) {
  const additionals = []
  if (edns) {
    additionals.push({
      type: 'OPT',
      name: '.',
      udpPayloadSize: 4096,
      flags: 0,
      options: [
        {
          code: 'CLIENT_SUBNET',
          ip: edns,
          sourcePrefixLength: isIPv4(edns) ? 24 : 56,
          scopePrefixLength: 0,
        },
      ],
    })
  }

  return dnsPacket.encode({
    type: 'query',
    id: 0,
    flags: dnsPacket.RECURSION_DESIRED,
    questions: [
      {
        type,
        name: domain,
      },
    ],
    additionals,
  } as any)
}

function normalizeDnsTimeout(timeout: any) {
  return timeout || 8000
}

function normalizeDnsHost(host: string) {
  return host.replace(/^\[(.*)\]$/, '$1')
}

function parseDnsPort(port: any, defaultPort = DNS_DEFAULT_PORT) {
  if (!port) return defaultPort
  const parsed = Number(port)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error('自定义 DNS 端口号应为 1-65535 的整数')
  }
  return parsed
}

function assertNoDnsServerUrlExtraParts(parsed: URL, raw: string) {
  if (
    parsed.username ||
    parsed.password ||
    (parsed.pathname && parsed.pathname !== '/') ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(`自定义 DNS 地址格式无效: ${raw}`)
  }
}

function parseDnsServerUrl(raw: string, protocol: string | undefined) {
  try {
    const value = protocol ? raw : `udp://${isIPv6(raw) ? `[${raw}]` : raw}`
    const parsed = new URL(value)
    assertNoDnsServerUrlExtraParts(parsed, raw)
    const host = normalizeDnsHost(parsed.hostname)
    if (!host) throw new Error(`自定义 DNS 地址格式无效: ${raw}`)
    return {
      protocol: protocol || 'udp',
      host,
      port: parseDnsPort(
        parsed.port,
        protocol === 'tls' ? DNS_TLS_DEFAULT_PORT : DNS_DEFAULT_PORT,
      ),
    }
  } catch (e) {
    if ((e as any)?.message?.includes('自定义 DNS')) throw e
    throw new Error(`自定义 DNS 地址格式无效: ${raw}`)
  }
}

export function parseDnsResolver(url: any) {
  const raw = `${url || ''}`.trim()
  if (!raw) throw new Error('自定义 DNS 不能为空')
  if (/^https?:\/\//i.test(raw)) {
    return {
      protocol: 'doh',
      url: raw,
    }
  }

  const protocol = raw.match(/^([a-z][a-z\d+.-]*):\/\//i)?.[1]
  const normalizedProtocol = protocol?.toLowerCase()
  if (
    normalizedProtocol &&
    !['udp', 'tcp', 'tls'].includes(normalizedProtocol)
  ) {
    throw new Error(`自定义 DNS 不支持 ${protocol} 协议`)
  }

  return parseDnsServerUrl(raw, normalizedProtocol)
}

export async function doh({
  url,
  domain,
  type = 'A',
  timeout,
  edns,
  skipCertVerify,
}: any) {
  const buf = buildDnsQuery({
    domain,
    type,
    edns,
  })

  const b64 = Buffer.from(buf).toString('base64')
  const b64url = b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

  void skipCertVerify
  const res = await fetch(`${url}?dns=${encodeURIComponent(b64url)}`, {
    headers: {
      Accept: 'application/dns-message',
      // 'Content-Type': 'application/dns-message',
    },
    signal: AbortSignal.timeout(normalizeDnsTimeout(timeout)),
  })

  if (!res.ok)
    throw upstreamHttpError(
      res.status,
      url,
      '',
      Object.fromEntries(res.headers),
    )
  return dnsPacket.decode(Buffer.from(await res.arrayBuffer()))
}

export async function resolveDns({
  url,
  domain,
  type = 'A',
  timeout,
  edns,
  skipCertVerify,
}: any) {
  const raw = `${url || ''}`.trim()
  const protocol: any = raw
    .match(/^([a-z][a-z\d+.-]*):\/\//i)?.[1]
    ?.toLowerCase()
  const isDoh = ['http', 'https'].includes(protocol)
  if (
    ['auto', 'system'].includes(raw.toLowerCase()) ||
    ['h3', 'quic'].includes(protocol)
  ) {
    throw new Error('auto/system 和 DoH3/DoQ 仅支持 Loon Build ≥ 988')
  }
  if (
    raw &&
    !isDoh &&
    (!protocol || ['udp', 'tcp', 'tls'].includes(protocol))
  ) {
    throw new Error(
      'DoT 和 TCP DNS 仅支持 Node.js; UDP DNS 支持 Node.js 或 Loon Build ≥ 988',
    )
  }

  const resolver: any = parseDnsResolver(url)
  if (resolver.protocol === 'doh') {
    return doh({
      url: resolver.url,
      domain,
      type,
      timeout,
      edns,
      skipCertVerify,
    })
  }

  throw new Error(
    'DoT 和 TCP DNS 仅支持 Node.js; UDP DNS 支持 Node.js 或 Loon Build ≥ 988',
  )
}
