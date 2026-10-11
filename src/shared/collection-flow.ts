import type { Collection, CollectionFlowSource } from './types'

/** 未配置新来源的组合继续遵循原有首成员与自定义流量设置。 */
export function collectionFlowSource(
  collection: Collection,
): CollectionFlowSource {
  if (collection.noFlow) return { type: 'none' }
  return (
    collection.flowSource ||
    (collection.subUserinfo?.trim()
      ? { type: 'custom', custom: collection.subUserinfo }
      : { type: collection.firstSubFlow === false ? 'none' : 'first' })
  )
}

/** 重命名与删除成员时同步维护显式流量引用。 */
export function updateCollectionFlowMember(
  collection: Collection,
  previous: string,
  next?: string,
): Collection {
  return {
    ...collection,
    subscriptions: collection.subscriptions.flatMap((name) =>
      name === previous ? (next ? [next] : []) : [name],
    ),
    ...(collection.flowSource
      ? {
          flowSource: {
            ...collection.flowSource,
            subscriptions: collection.flowSource.subscriptions?.flatMap(
              (name) => (name === previous ? (next ? [next] : []) : [name]),
            ),
          },
        }
      : {}),
  }
}
