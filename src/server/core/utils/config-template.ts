import { parseDocument } from 'yaml'
import YAML from './yaml'
import { RequestInvalidError } from '../errors'

type Config = Record<string, any>
const CONFIG_KEYS =
  /^(?:proxy-groups|proxy-providers|rule-providers|rules|proxies|dns|tun|hosts|sniffer|profile|mixed-port|port|socks-port|redir-port|tproxy-port|allow-lan|mode|log-level|external-controller|ipv6)$/

/** 配置文本单独解析，不能交给 JavaScript 沙箱。 */
export function parseConfigTemplate(content: string): Config | null {
  if (typeof content !== 'string') return null
  const firstLine =
    content
      .split('\n')
      .find((line) => line.trim() && !/^\s*(?:#|---\s*$)/.test(line)) ?? ''
  if (
    !/^[^\s:#]+:(?:\s|$)/.test(firstLine) &&
    !content.trimStart().startsWith('{')
  )
    return null
  const yamlConfig = content.split('\n').some((line) => {
    const match = /^([^\s:#]+):(?:\s|$)/.exec(line)
    return match && CONFIG_KEYS.test(match[1].replace(/^[+<]|[+!>]$/g, ''))
  })
  if (!yamlConfig && !content.trimStart().startsWith('{')) return null
  const document = parseDocument(content, { merge: true, prettyErrors: false })
  if (document.errors.length) {
    if (!yamlConfig) return null
    const problem = document.errors[0]
    throw new RequestInvalidError(
      'INVALID_CONFIG_TEMPLATE',
      '配置模板格式无效',
      {
        reason: problem.message,
        configLine: content.slice(0, problem.pos[0]).split('\n').length,
      },
    )
  }
  const config = document.toJS({ maxAliasCount: 100 })
  if (!config || typeof config !== 'object' || Array.isArray(config))
    return null
  if (
    !Object.keys(config).some((key) =>
      CONFIG_KEYS.test(key.replace(/^[+<]|[+!>]$/g, '')),
    )
  )
    return null
  return config
}

/** 与 Suki Sub 的配置补丁约定一致：对象合并，数组替换，+ 前置/后置，! 覆盖。 */
function mergeConfig(target: Config, patch: Config): Config {
  for (const [rawKey, value] of Object.entries(patch)) {
    const key = rawKey.replace(/^\+|[+!]$/g, '').replace(/^<|>$/g, '')
    if (['__proto__', 'prototype', 'constructor'].includes(key)) continue
    if (rawKey.endsWith('!')) target[key] = structuredClone(value)
    else if (Array.isArray(value)) {
      const current = Array.isArray(target[key]) ? target[key] : []
      target[key] = rawKey.startsWith('+')
        ? [...value, ...current]
        : rawKey.endsWith('+')
          ? [...current, ...value]
          : structuredClone(value)
    } else if (value && typeof value === 'object') {
      const current = target[key]
      target[key] = mergeConfig(
        current && typeof current === 'object' && !Array.isArray(current)
          ? current
          : {},
        value,
      )
    } else target[key] = value
  }
  return target
}

export function applyConfigTemplates(
  output: string,
  patches: Config[],
): string {
  const config = YAML.safeLoad(output) as Config
  const proxies = config.proxies
  for (const patch of patches) mergeConfig(config, patch)
  // 节点由订阅处理管线生成，模板提供策略组、规则及其他配置。
  config.proxies = proxies
  return YAML.safeDump(config, { lineWidth: -1 })
}

export function supportsConfigTemplate(platform: string): boolean {
  return [
    'clash',
    'clashmeta',
    'clash.meta',
    'meta',
    'mihomo',
    'stash',
  ].includes(platform.toLowerCase())
}
