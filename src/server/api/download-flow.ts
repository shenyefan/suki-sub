import { collectionFlowSource } from '#/shared/collection-flow'
import type { Collection, Subscription } from '#/shared/types'
import {
  getFlowHeaders,
  normalizeFlowHeader,
  parseFlowHeaders,
} from '../core/utils/flow'
import { parseResourceLink } from '#/shared/resource-link'
import $ from '../core/app'

/** 自定义地址允许从正文读取流量；普通订阅地址只提取响应头。 */
async function customFlow(value: unknown, noCache: boolean) {
  if (typeof value !== 'string' || !value.trim()) return undefined
  if (!/^https?:\/\//i.test(value.trim())) return value
  return getFlowHeaders(value, undefined, undefined, value, undefined, noCache)
}

async function safely(task: () => Promise<string | undefined>) {
  try {
    return await task()
  } catch (error) {
    $.warn(
      '流量信息暂不可用',
      error instanceof Error ? error.message : String(error),
    )
    return undefined
  }
}

export async function subscriptionFlow(sub: Subscription, noCache: boolean) {
  if (sub.noFlow) return undefined
  const firstUrl =
    (sub.url || '')
      .split(/[\r\n]+/)
      .map((url) => url.trim())
      .find(Boolean) || ''
  const args = parseResourceLink(firstUrl).arguments
  const remote =
    sub.source !== 'local' ||
    ['localFirst', 'remoteFirst'].includes(sub.mergeSources || '')
  const bypass = noCache || sub.noCache === true
  const [custom, upstream] = await Promise.all([
    safely(() => customFlow(sub.subUserinfo, bypass)),
    remote && !args.noFlow
      ? safely(() =>
          getFlowHeaders(
            firstUrl,
            args.flowUserAgent || sub.ua,
            undefined,
            args.flowUrl,
            args.flowHeaders,
            bypass,
          ),
        )
      : undefined,
  ])
  return [custom, upstream].filter(Boolean).join('; ')
}

/** 汇总只在全部来源取得有效流量时返回，避免显示误导性的部分额度。 */
export function sumFlowHeaders(
  values: (string | undefined)[],
): string | undefined {
  if (
    !values.length ||
    values.some(
      (value) =>
        !value || !/(?:^|;)\s*(?:upload|download|total)\s*=/i.test(value),
    )
  )
    return undefined
  const flows = values.map((value) =>
    parseFlowHeaders(normalizeFlowHeader(value, false)),
  )
  if (flows.some((flow) => !flow)) return undefined
  const upload = flows.reduce(
    (total, flow) => total + Math.max(0, flow?.usage?.upload || 0),
    0,
  )
  const download = flows.reduce(
    (total, flow) => total + Math.max(0, flow?.usage?.download || 0),
    0,
  )
  const totals = flows.map((flow) => flow?.total)
  const expiries = flows
    .map((flow) => flow?.expires)
    .filter(
      (value): value is number =>
        value != null && value > 0 && Number.isFinite(value),
    )
  const fields = [`upload=${upload}`, `download=${download}`]
  if (
    totals.every(
      (value) => value != null && Number.isFinite(value) && value > 0,
    )
  )
    fields.push(
      `total=${totals.reduce<number>((total, value) => total + (value || 0), 0)}`,
    )
  if (expiries.length) fields.push(`expire=${Math.min(...expiries)}`)
  return fields.join('; ')
}

export async function collectionFlow(
  collection: Collection,
  resolveSub: (name: string) => Promise<Subscription | null>,
  noCache: boolean,
) {
  if (collection.noFlow) return undefined
  const config =
    !collection.flowSource && collection.firstSubFlow !== false
      ? { type: 'first' as const }
      : collectionFlowSource(collection)
  const bypass = noCache || collection.noCache === true
  if (config.type === 'none') return undefined
  if (config.type === 'custom')
    return safely(() => customFlow(config.custom, bypass))
  const members =
    config.type === 'first'
      ? collection.subscriptions.slice(0, 1)
      : [...new Set(config.subscriptions || [])]
  if (
    !members.length ||
    members.some((member) => !collection.subscriptions.includes(member))
  )
    return undefined
  if (config.type === 'subscription' && members.length !== 1) return undefined
  const flows = await Promise.all(
    members.map(async (member) => {
      const sub = /^https?:\/\//i.test(member)
        ? { name: member, url: member }
        : await resolveSub(member)
      return sub ? subscriptionFlow(sub, bypass) : undefined
    }),
  )
  const result = config.type === 'sum' ? sumFlowHeaders(flows) : flows[0]
  // 原有配置仍允许组合字段覆盖首成员；显式新配置完全按选定来源获取。
  if (!collection.flowSource && config.type === 'first') {
    const custom = await safely(() =>
      customFlow(collection.subUserinfo, bypass),
    )
    return [custom, result].filter(Boolean).join('; ')
  }
  return result
}

export function flowResponseHeaders(value: string | undefined) {
  return value
    ? (normalizeFlowHeader(value, true) as Record<string, string>)
    : {}
}
