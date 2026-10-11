import type {
  Collection,
  CollectionFlowSource,
  Subscription,
} from '#/shared/types'
import { collectionFlowSource } from '#/shared/collection-flow'
import { ResourceIdentity } from '#/components/shared/resource-identity'
import { Checkbox } from '#/components/ui/checkbox'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'

/** 组合的流量来源设置与普通订阅保持相同的基础信息表单风格。 */
export function CollectionFlowFields({
  collection,
  subs,
  onChange,
}: {
  collection: Collection
  subs: Subscription[]
  onChange: (patch: Partial<Collection>) => void
}) {
  const source = collectionFlowSource(collection)
  const members = [...new Set(collection.subscriptions)]
  const selected = source.subscriptions || []
  const update = (flowSource: CollectionFlowSource) =>
    onChange({ flowSource, noFlow: flowSource.type === 'none' })
  const identity = (name: string) =>
    /^https?:\/\//i.test(name) ? (
      <span className="min-w-0 truncate" title={name}>
        {name}
      </span>
    ) : (
      <ResourceIdentity
        resource={subs.find((sub) => sub.name === name)}
        name={name}
      />
    )
  return (
    <div className="grid min-w-0 gap-3 border-t pt-4 sm:grid-cols-2">
      <h2 className="text-sm font-semibold sm:col-span-2">流量信息</h2>
      <div className="grid min-w-0 content-start gap-2">
        <Label htmlFor="col-flow-source">流量来源</Label>
        <Select
          value={source.type}
          onValueChange={(type) =>
            update({
              type: type as CollectionFlowSource['type'],
              ...(type === 'subscription'
                ? { subscriptions: selected.slice(0, 1) }
                : {}),
              ...(type === 'sum' ? { subscriptions: selected } : {}),
              ...(type === 'custom'
                ? { custom: source.custom || collection.subUserinfo || '' }
                : {}),
            })
          }
        >
          <SelectTrigger id="col-flow-source" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="first">第一个成员</SelectItem>
            <SelectItem value="subscription">指定一个成员</SelectItem>
            <SelectItem value="sum">汇总多个成员</SelectItem>
            <SelectItem value="custom">自定义流量信息</SelectItem>
            <SelectItem value="none">不显示流量信息</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {source.type === 'subscription' && (
        <div className="grid min-w-0 content-start gap-2">
          <Label htmlFor="col-flow-member">成员订阅</Label>
          <Select
            value={selected[0] || ''}
            onValueChange={(name) =>
              update({ type: 'subscription', subscriptions: [name] })
            }
          >
            <SelectTrigger id="col-flow-member" className="w-full">
              <SelectValue placeholder="选择组合内的订阅…" />
            </SelectTrigger>
            <SelectContent>
              {members.map((name) => (
                <SelectItem key={name} value={name}>
                  {identity(name)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {source.type === 'sum' && (
        <fieldset className="grid min-w-0 gap-2 sm:col-span-2">
          <legend className="mb-2 text-sm font-medium">参与汇总的成员</legend>
          {members.length ? (
            members.map((name, index) => (
              <Label
                key={name}
                htmlFor={`col-flow-member-${index}`}
                className="flex min-w-0 items-center gap-2 rounded-md border px-3 py-2"
              >
                <Checkbox
                  id={`col-flow-member-${index}`}
                  checked={selected.includes(name)}
                  onCheckedChange={(checked) =>
                    update({
                      type: 'sum',
                      subscriptions:
                        checked === true
                          ? [...new Set([...selected, name])]
                          : selected.filter((item) => item !== name),
                    })
                  }
                />
                {identity(name)}
              </Label>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">请先添加组合成员</p>
          )}
          <p className="text-xs text-muted-foreground">
            累加所选成员的上传、下载及总额度，到期时间取最早日期。来源缺失时不显示部分汇总。
          </p>
        </fieldset>
      )}
      {source.type === 'custom' && (
        <div className="grid min-w-0 content-start gap-2">
          <Label htmlFor="col-flow-custom">流量信息或地址</Label>
          <Input
            id="col-flow-custom"
            value={source.custom || ''}
            onChange={(event) =>
              update({ type: 'custom', custom: event.target.value })
            }
            placeholder="填写 subscription-userinfo 头内容或获取地址"
          />
        </div>
      )}
    </div>
  )
}
