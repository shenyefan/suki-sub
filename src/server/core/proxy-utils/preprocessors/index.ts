/**
 * 内容预处理器(Clash YAML 归一化等)。
 */
import { safeLoad } from '#/server/core/utils/yaml'
import { Base64 } from 'js-base64'
import $ from '#/server/core/app'
import { RequestInvalidError } from '#/server/core/errors'

export function normalizeClashYaml(raw: any) {
  if (
    typeof raw !== 'string' ||
    !raw.includes('proxies:') ||
    !raw.includes('short-id:')
  ) {
    return raw
  }

  try {
    const content = safeLoad(raw)
    if (!Array.isArray(content.proxies) || content.proxies.length === 0)
      return raw
  } catch (e) {
    return raw
  }
  // 防止 VLESS 节点 reality-opts 里的 short-id 被 YAML 标量推断成数字
  // 例如 08 / 0088 在部分内核重新解析时会触发 invalid REALITY short ID
  return raw.replace(/short-id:([ \t]*[^#\n,}]*)/g, (_matched, value) => {
    const afterTrim = value.trim()

    if (!afterTrim || afterTrim === '') {
      return 'short-id: ""'
    }

    if (/^(['"]).*\1$/.test(afterTrim)) {
      return `short-id: ${afterTrim}`
    } else if (['null'].includes(afterTrim)) {
      return `short-id: ${afterTrim}`
    } else {
      return `short-id: "${afterTrim}"`
    }
  })
}

function HTML() {
  const name = 'HTML'
  const test = (raw: any) => /^<!DOCTYPE html>/.test(raw)
  // simply discard HTML
  const parse = () => {
    throw new RequestInvalidError(
      'UPSTREAM_CONTENT_INVALID',
      '上游返回了 HTML 页面，无法作为订阅使用',
    )
  }
  return { name, test, parse }
}

function Base64Encoded() {
  const name = 'Base64 Pre-processor'

  const keys = [
    'dm1lc3M', // vmess
    'c3NyOi8v', // ssr://
    'c29ja3M6Ly', // socks://
    'dHJvamFu', // trojan
    'c3M6Ly', // ss:/
    'c3NkOi8v', // ssd://
    'c2hhZG93', // shadow
    'aHR0c', // htt
    'dmxlc3M=', // vless
    'aHlzdGVyaWEy', // hysteria2
    'aHkyOi8v', // hy2://
    'd2lyZWd1YXJkOi8v', // wireguard://
    'd2c6Ly8=', // wg://
    'dHVpYzovLw==', // tuic://
  ]

  const test = function (raw: any) {
    return (
      Base64.isValid(raw) &&
      !/^\w+:\/\/\w+/im.test(raw) &&
      keys.some((k) => raw.indexOf(k) !== -1)
    )
  }
  const parse = function (raw: any) {
    const decoded = Base64.decode(raw)
    if (!/^\w+(:\/\/|\s*?=\s*?)\w+/m.test(decoded)) {
      $.debug(
        `Base64 Pre-processor error: decoded line does not start with protocol`,
      )
      return raw
    }

    return decoded
  }
  return { name, test, parse }
}

function fallbackBase64Encoded() {
  const name = 'Fallback Base64 Pre-processor'

  const test = function (raw: any) {
    return Base64.isValid(raw)
  }
  const parse = function (raw: any) {
    const decoded = Base64.decode(raw)
    if (!/^\w+(:\/\/|\s*?=\s*?)\w+/m.test(decoded)) {
      $.debug(
        `Fallback Base64 Pre-processor error: decoded line does not start with protocol`,
      )
      return raw
    }

    return decoded
  }
  return { name, test, parse }
}

function Clash() {
  const name = 'Clash Pre-processor'
  const test = function (raw: any) {
    if (!/proxies/.test(raw)) return false
    const content = safeLoad(raw)
    return (
      Array.isArray(content.proxies) || Array.isArray(content['proxy-groups'])
    )
  }
  const parse = function (raw: any, includeProxies: any) {
    // Clash YAML format

    const afterReplace = normalizeClashYaml(raw)

    const { proxies } = safeLoad(afterReplace)
    return (
      (includeProxies ? 'proxies:\n' : '') +
      (Array.isArray(proxies) ? proxies : [])
        .map((p: any) => {
          return `${includeProxies ? '  - ' : ''}${JSON.stringify(p)}\n`
        })
        .join('')
    )
  }
  return { name, test, parse }
}

function SSD() {
  const name = 'SSD Pre-processor'
  const test = function (raw: any) {
    return raw.indexOf('ssd://') === 0
  }
  const parse = function (raw: any) {
    // preprocessing for SSD subscription format
    const output = []
    const ssdinfo = JSON.parse(Base64.decode(raw.split('ssd://')[1]))
    let port = ssdinfo.port
    let method = ssdinfo.encryption
    let password = ssdinfo.password
    // servers config
    const servers = ssdinfo.servers
    for (let i = 0; i < servers.length; i++) {
      const server = servers[i]
      method = server.encryption ? server.encryption : method
      password = server.password ? server.password : password
      const userinfo = Base64.encode(method + ':' + password)
      const hostname = server.server
      port = server.port ? server.port : port
      const tag = server.remarks ? server.remarks : i
      const plugin = server.plugin_options
        ? '/?plugin=' +
          encodeURIComponent(server.plugin + ';' + server.plugin_options)
        : ''
      output[i] =
        'ss://' + userinfo + '@' + hostname + ':' + port + plugin + '#' + tag
    }
    return output.join('\n')
  }
  return { name, test, parse }
}

function FullConfig() {
  const name = 'Full Config Preprocessor'
  const test = function (raw: any) {
    return /^(\[server_local\]|\[Proxy\])/gm.test(raw)
  }
  const parse = function (raw: any) {
    const match = raw.match(
      /^\[server_local|Proxy\]([\s\S]+?)^\[.+?\](\r?\n|$)/im,
    )?.[1]
    return match || raw
  }
  return { name, test, parse }
}

export default [
  HTML(),
  Clash(),
  Base64Encoded(),
  SSD(),
  FullConfig(),
  fallbackBase64Encoded(),
]
