import {
  SubscriptionBehaviorFields,
  SubscriptionNotificationField,
} from '#/components/shared/subscription-behavior'
import { useResourceValidation } from '#/lib/resource-validation'
import { ValidationHint } from '#/components/shared/validation-hint'
/**
 * 组合订阅编辑器:/collections/:name(UNTITLED 表示新建)。
 * 成员(已保存订阅或远程 URL)+ 节点操作管线。
 */
import { useEffect, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Globe, Loader2, Plus, Save, X } from 'lucide-react'
import { toast } from 'sonner'

import { ApiRoutes } from '#/shared/api-contract'
import type { Collection, Subscription } from '#/shared/types'
import { resourceLabel } from '#/lib/resource-display'
import { ResourceIdentity } from '#/components/shared/resource-identity'
import { api } from '#/lib/api'
import { useSubs } from '#/lib/queries'
import { cacheResource } from '#/lib/query-cache'
import { normalizeProcess } from '#/features/operators/model'
import { PipelineEditor } from '#/features/operators/pipeline-editor'
import type { ProcessItem } from '#/features/operators/registry'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { Badge } from '#/components/ui/badge'
import { EditorSkeleton } from '#/components/subs/editor-skeleton'
import { CollectionFlowFields } from '#/components/subs/collection-flow-fields'
import { IconField } from '#/components/shared/icon-fields'
import { EditorLayout } from '#/components/shared/editor-layout'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import {
  SortableList,
  SortableRow,
  SortHandle,
} from '#/components/shared/sortable-list'

export const Route = createFileRoute('/_app/collections_/$name')({
  component: CollectionEditorPage,
})

function CollectionEditorPage() {
  const { name } = Route.useParams()
  const navigate = useNavigate()
  const client = useQueryClient()
  const isNew = name === 'UNTITLED'
  const subs = useSubs()

  const { data: existing, isLoading } = useQuery({
    queryKey: ['collection', name],
    queryFn: ({ signal }) =>
      api.get<Collection>(ApiRoutes.collection(name), signal),
    enabled: !isNew,
  })

  const [form, setForm] = useState<Collection>({
    name: '',
    subscriptions: [],
    process: [],
  })
  const [tagText, setTagText] = useState('')
  const [urlDraft, setUrlDraft] = useState('')

  useEffect(() => {
    if (isNew || !existing) return
    setForm({
      ...existing,
      subscriptions: existing.subscriptions,
      process: existing.process ?? [],
    })
    setTagText(
      Array.isArray(existing.tag)
        ? existing.tag.join(', ')
        : typeof existing.tag === 'string'
          ? existing.tag
          : '',
    )
  }, [isNew, existing])

  const patch = (p: Partial<Collection>) =>
    setForm((prev) => ({
      ...prev,
      ...p,
      ...(p.subscriptions && prev.flowSource && !p.flowSource
        ? {
            flowSource: {
              ...prev.flowSource,
              subscriptions: prev.flowSource.subscriptions?.filter((member) =>
                p.subscriptions?.includes(member),
              ),
            },
          }
        : {}),
    }))

  const validation = useResourceValidation('collection', form)

  const save = useMutation({
    mutationFn: async () => {
      if (!form.name || form.name.includes('/')) {
        throw new Error('名称不能为空且不能包含 /')
      }
      const tags = tagText
        .split(/[,，]/)
        .map((t) => t.trim())
        .filter(Boolean)
      const payload = {
        ...form,
        process: normalizeProcess(form.process ?? []),
        tag: tags.length ? tags : undefined,
      }
      if (isNew) return api.post<Collection>(ApiRoutes.collections, payload)
      return api.patch<Collection>(ApiRoutes.collection(name), payload)
    },
    onSuccess: async (saved) => {
      await cacheResource(client, 'collection', saved, isNew ? undefined : name)
      toast.success(isNew ? '组合已创建' : '组合已保存')
      void navigate({
        to: '/collections/$name',
        params: { name: saved.name },
        replace: true,
      })
    },
    onError: (err) => {
      validation.report(err)
    },
  })

  const addMember = (member: string) => {
    if (!member || form.subscriptions.includes(member)) return
    patch({ subscriptions: [...form.subscriptions, member] })
  }

  const subNames = (subs.data ?? []).map((s: Subscription) => s.name)

  if (!isNew && isLoading) {
    return <EditorSkeleton kind="collection" />
  }

  const process = (form.process ?? []) as ProcessItem[]

  return (
    <div className="editor-page">
      <EditorLayout
        title={isNew ? '新建组合订阅' : `编辑:${resourceLabel(form)}`}
        eyebrow="COLLECTION"
        actions={
          <Button
            size="sm"
            onClick={() => {
              if (validation.validate()) save.mutate()
            }}
            disabled={save.isPending}
          >
            {save.isPending ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <Save aria-hidden />
            )}
            保存
          </Button>
        }
      >
        <section
          id="editor-basic"
          data-editor-section="基础信息"
          data-editor-summary={
            form.name ? `订阅：${resourceLabel(form)}` : '名称、来源及订阅设置'
          }
          tabIndex={-1}
          aria-label="基础信息"
          className="editor-section"
        >
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            <h2 className="editor-section-title sm:col-span-2 ">基本信息</h2>
            <div className="grid min-w-0 content-start gap-2">
              <Label htmlFor="col-name">名称</Label>
              <Input
                id="col-name"
                aria-invalid={validation.issues.some(
                  (issue) => issue.field === 'name',
                )}
                aria-describedby="col-name-error"
                value={form.name}
                onChange={(e) => patch({ name: e.target.value })}
                placeholder="唯一名称，不可包含 /"
              />
              <ValidationHint
                id="col-name-error"
                issues={validation.issues.filter(
                  (issue) => issue.field === 'name',
                )}
              />
            </div>
            <div className="grid min-w-0 content-start gap-2">
              <Label htmlFor="col-display-name">显示名称</Label>
              <Input
                id="col-display-name"
                value={form.displayName ?? ''}
                onChange={(e) => patch({ displayName: e.target.value })}
                placeholder="选填，留空使用名称"
              />
            </div>
            <IconField
              item={form}
              patch={patch}
              id="col-icon"
              value={form.icon ?? ''}
              onChange={(icon) => patch({ icon })}
            />
            <div className="grid min-w-0 content-start gap-2">
              <Label htmlFor="col-tag">标签</Label>
              <Input
                id="col-tag"
                value={tagText}
                placeholder="逗号分隔"
                onChange={(e) => setTagText(e.target.value)}
              />
            </div>
            <div className="grid min-w-0 content-start gap-1.5">
              <Label htmlFor="col-remark">备注</Label>
              <Input
                id="col-remark"
                value={form.remark ?? ''}
                onChange={(e) => patch({ remark: e.target.value })}
                placeholder="选填，记录组合用途或其他备注"
              />
            </div>
          </div>
          <div className="grid min-w-0 gap-3 border-t pt-4 sm:grid-cols-2">
            <h2 className="text-sm font-semibold sm:col-span-2">组合成员</h2>
            <div className="grid gap-2">
              <Label htmlFor="member-sub">从已保存订阅添加</Label>
              <Select value="" onValueChange={addMember}>
                <SelectTrigger id="member-sub" className="w-full">
                  <SelectValue placeholder="选择订阅…" />
                </SelectTrigger>
                <SelectContent>
                  {subNames
                    .filter((n) => !form.subscriptions.includes(n))
                    .map((n) => (
                      <SelectItem key={n} value={n}>
                        <ResourceIdentity
                          resource={subs.data?.find((sub) => sub.name === n)}
                          name={n}
                        />
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="member-url">添加远程 URL</Label>
              <div className="flex gap-2">
                <Input
                  id="member-url"
                  value={urlDraft}
                  placeholder="https://…"
                  onChange={(e) => setUrlDraft(e.target.value)}
                />
                <Button
                  variant="outline"
                  onClick={() => {
                    addMember(urlDraft.trim())
                    setUrlDraft('')
                  }}
                  disabled={!urlDraft.trim()}
                >
                  <Plus aria-hidden />
                  添加
                </Button>
              </div>
            </div>

            <div
              id="col-members"
              tabIndex={-1}
              className="scroll-mt-20 sm:col-span-2"
            >
              <p className="mb-2 text-sm font-medium">
                成员列表(拖动调整合并顺序)
              </p>
              <ValidationHint
                issues={validation.issues.filter(
                  (issue) =>
                    issue.field === 'subscriptions' ||
                    issue.resourceKind !== 'collection' ||
                    issue.resourceName !== form.name,
                )}
              />
              <SortableList
                layout="grid"
                items={form.subscriptions}
                getId={(m) => m}
                getLabel={(m) =>
                  resourceLabel(
                    subs.data?.find((sub) => sub.name === m),
                    m,
                  )
                }
                onReorder={(next) => patch({ subscriptions: next })}
                className="grid gap-2"
              >
                {(member) => (
                  <SortableRow key={member} id={member}>
                    <div className="flex items-center gap-1 rounded-md border bg-card px-2 py-1.5">
                      <SortHandle />
                      {/^https?:\/\//.test(member) ? (
                        <Globe
                          className="size-4 shrink-0 text-muted-foreground"
                          aria-hidden
                        />
                      ) : null}
                      <span
                        className="min-w-0 flex-1 truncate text-sm"
                        title={member}
                      >
                        {/^https?:\/\//.test(member) ? (
                          member
                        ) : (
                          <ResourceIdentity
                            resource={subs.data?.find(
                              (sub) => sub.name === member,
                            )}
                            name={member}
                          />
                        )}
                      </span>
                      {!/^https?:\/\//.test(member) && (
                        <Badge variant="secondary">订阅</Badge>
                      )}
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`移除 ${resourceLabel(
                          subs.data?.find((sub) => sub.name === member),
                          member,
                        )}`}
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() =>
                          patch({
                            subscriptions: form.subscriptions.filter(
                              (m) => m !== member,
                            ),
                          })
                        }
                      >
                        <X />
                      </Button>
                    </div>
                  </SortableRow>
                )}
              </SortableList>
            </div>
          </div>
          <CollectionFlowFields
            collection={form}
            subs={subs.data || []}
            onChange={patch}
          />
          <ValidationHint
            issues={validation.issues.filter(
              (issue) => issue.field === 'flowSource',
            )}
          />
          <details className="min-w-0 border-t pt-3">
            <summary className="cursor-pointer text-sm font-medium text-muted-foreground">
              高级设置
            </summary>
            <div className="mt-3 grid gap-3">
              <SubscriptionBehaviorFields value={form} onChange={patch} />
              <SubscriptionNotificationField
                id="col-telegram"
                className="border-t pt-4"
                value={form}
                onChange={patch}
              />
            </div>
          </details>
        </section>
        <section
          id="editor-process"
          data-editor-section="节点操作"
          data-editor-summary={`${process.length} 项操作，按从上到下的顺序执行`}
          tabIndex={-1}
          aria-label="节点操作"
          className="min-w-0"
        >
          <PipelineEditor
            issues={validation.issues.filter(
              (issue) =>
                issue.resourceKind === 'collection' &&
                issue.resourceName === (form.name || '未命名'),
            )}
            onValidation={validation.report}
            onValidate={validation.validate}
            preview={{ kind: 'collection', draft: form }}
            items={process}
            onChange={(next) => patch({ process: next })}
          />
        </section>
      </EditorLayout>
    </div>
  )
}
