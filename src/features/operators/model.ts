import { OPERATORS } from './registry'
import type { ProcessItem } from './registry'

/** Older Suki Sub exports used arrays for these arguments. Keep unknown fields. */
export function normalizeOperatorArgs(type: string, value: unknown): unknown {
  const fallback = OPERATORS.find(
    (operator) => operator.type === type,
  )?.defaultArgs()
  if (value == null) return fallback ?? {}
  if (Array.isArray(value)) {
    if (type === 'Region Filter' || type === 'Type Filter')
      return normalizeOperatorArgs(type, { value, keep: true })
    if (type === 'Regex Sort Operator')
      return { expressions: value, order: 'asc' }
    return value
  }
  if (typeof value !== 'object') return value
  const args = { ...value } as Record<string, unknown>
  if (type.includes('Script') || type === 'Response Transformer') {
    if (args.mode === 'local') args.mode = 'script'
  }
  if (type === 'Type Filter' && Array.isArray(args.value)) {
    args.value = args.value.map((entry) =>
      entry === 'shadowsocks' ? 'ss' : entry === 'shadowsocksr' ? 'ssr' : entry,
    )
  }
  if (type === 'Resolve Domain Operator') {
    const filters: Record<string, string> = {
      ipOnly: 'IPOnly',
      ipv4Only: 'IPv4Only',
      ipv6Only: 'IPv6Only',
      '': 'disabled',
    }
    if (typeof args.filter === 'string')
      args.filter = filters[args.filter] ?? args.filter
    if (args.cache === 'disable') args.cache = 'disabled'
    if (args.cache === '') args.cache = 'enabled'
    if (args.type === 'IP4P') args.type = 'IPv6'
  }
  return args
}

export function normalizeProcess(items: ProcessItem[]): ProcessItem[] {
  const used = new Set<string>()
  return items.map((item) => {
    let id = item.id
    if (!id || used.has(id)) id = crypto.randomUUID()
    used.add(id)
    return { ...item, id, args: normalizeOperatorArgs(item.type, item.args) }
  })
}

export function importProcess(text: string): ProcessItem[] {
  const parsed: unknown = JSON.parse(text)
  const value =
    parsed && typeof parsed === 'object' && 'data' in parsed
      ? parsed.data
      : parsed
  const items = Array.isArray(value) ? value : [value]
  if (
    !items.length ||
    items.some(
      (item) =>
        !item || typeof item !== 'object' || typeof item.type !== 'string',
    )
  ) {
    throw new Error('请输入 Suki Sub 操作对象或操作数组')
  }
  const allowed = OPERATORS.map((operator) => operator.type)
  if (items.some((item) => !allowed.includes(item.type)))
    throw new Error('包含不适用于当前资源的操作类型')
  if (
    parsed &&
    typeof parsed === 'object' &&
    'source' in parsed &&
    parsed.source !== 'subscription'
  ) {
    throw new Error('仅支持订阅操作')
  }
  return normalizeProcess(items.map((item) => ({ ...item, id: undefined })))
}
