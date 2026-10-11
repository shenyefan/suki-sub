/**
 * 订阅 / 组合资源卡:严格等高行结构,操作按钮内联。
 */
import { resourceLabel } from '#/lib/resource-display'
import type { Collection, Subscription } from '#/shared/types'
import { collectionFlowSource } from '#/shared/collection-flow'
import { useCollectionFlow, useFlow } from '#/lib/queries'
import {
  CardBadges,
  CardIcon,
  SortableCard,
} from '#/components/shared/resource-card'
import type { CardAction } from '#/components/shared/resource-card'
import {
  FlowUsageLine,
  FlowUsageProgress,
} from '#/components/shared/flow-usage'

export type { CardAction }

/** 单条订阅卡片 */
export function SubCard({
  sub,
  actions,
  moreActions,
}: {
  sub: Subscription
  actions: CardAction[]
  moreActions: CardAction[]
}) {
  const canFetchFlow = !sub.noFlow && (sub.url || sub.subUserinfo)
  const flow = useFlow(sub.name, Boolean(canFetchFlow))
  return (
    <SortableCard
      id={sub.name}
      icon={
        <CardIcon
          src={sub.icon || sub.img}
          name={resourceLabel(sub)}
          color={sub.isIconColor !== false}
          fit={sub.iconFit}
        />
      }
      title={
        <>
          {resourceLabel(sub)}
          <CardBadges items={sub.tag ?? []} />
        </>
      }
      subtitle={
        sub.displayName && sub.displayName !== sub.name ? sub.name : undefined
      }
      content1={
        sub.remark?.trim() ? (
          sub.remark
        ) : flow.data ? (
          <FlowUsageLine flow={flow.data} />
        ) : flow.isFetching ? (
          '流量信息加载中…'
        ) : (
          '无流量信息'
        )
      }
      content2={flow.data ? <FlowUsageProgress flow={flow.data} /> : undefined}
      actions={actions}
      moreActions={moreActions}
    />
  )
}

/** 组合订阅卡片：展示所选来源的流量，备注优先显示。 */
export function CollectionCard({
  collection,
  actions,
  moreActions,
}: {
  collection: Collection
  actions: CardAction[]
  moreActions: CardAction[]
}) {
  const showFlow =
    !collection.noFlow && collectionFlowSource(collection).type !== 'none'
  const flow = useCollectionFlow(collection.name, showFlow)
  return (
    <SortableCard
      id={collection.name}
      icon={
        <CardIcon
          src={collection.icon || collection.img}
          name={resourceLabel(collection)}
          color={collection.isIconColor !== false}
          fit={collection.iconFit}
        />
      }
      title={
        <>
          {resourceLabel(collection)}
          <CardBadges items={collection.tag ?? []} />
        </>
      }
      subtitle={
        collection.displayName && collection.displayName !== collection.name
          ? collection.name
          : undefined
      }
      content1={
        collection.remark?.trim() ? (
          collection.remark
        ) : showFlow && flow.data ? (
          <FlowUsageLine flow={flow.data} />
        ) : (
          `${collection.subscriptions.length} 个成员`
        )
      }
      content2={
        showFlow && flow.data ? (
          <FlowUsageProgress flow={flow.data} />
        ) : undefined
      }
      actions={actions}
      moreActions={moreActions}
    />
  )
}
