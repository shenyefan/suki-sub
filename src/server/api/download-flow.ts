import type { Collection, Subscription } from '#/shared/types'
import { getFlowHeaders, normalizeFlowHeader } from '../core/utils/flow'
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

export async function collectionFlow(
  collection: Collection,
  firstSub: Subscription | null,
  noCache: boolean,
) {
  if (collection.noFlow) return undefined
  const [custom, first] = await Promise.all([
    safely(() =>
      customFlow(
        collection.subUserinfo,
        noCache || collection.noCache === true,
      ),
    ),
    collection.firstSubFlow !== false && firstSub
      ? subscriptionFlow(firstSub, noCache || collection.noCache === true)
      : undefined,
  ])
  return [custom, first].filter(Boolean).join('; ')
}

export function flowResponseHeaders(value: string | undefined) {
  return value
    ? (normalizeFlowHeader(value, true) as Record<string, string>)
    : {}
}
