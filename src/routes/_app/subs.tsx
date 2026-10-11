/**
 * 订阅管理:单条订阅 + 组合订阅两个分区,资源卡网格,操作按钮直接放在卡片上。
 */
import { useMemo, useRef, useState } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  CopyPlus,
  Download,
  FilePlus2,
  Layers,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Share2,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'

import { ApiRoutes } from '#/shared/api-contract'
import type { Collection, Subscription } from '#/shared/types'
import { resourceLabel } from '#/lib/resource-display'
import { api } from '#/lib/api'
import {
  qk,
  refreshFlow,
  refreshCollectionFlow,
  useCollections,
  useSortMutation,
  useSubs,
} from '#/lib/queries'
import { cacheResource, removeCachedResource } from '#/lib/query-cache'
import { PageHeader } from '#/components/shared/page-header'
import { EmptyState } from '#/components/shared/empty-state'
import { ConfirmDialog } from '#/components/shared/confirm-dialog'
import { ShareDialog } from '#/components/shared/share-dialog'
import type { ShareTarget } from '#/components/shared/share-dialog'
import { SortableList } from '#/components/shared/sortable-list'
import { CollectionCard, SubCard } from '#/components/subs/sub-item-card'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Skeleton } from '#/components/ui/skeleton'

export const Route = createFileRoute('/_app/subs')({
  component: SubsPage,
})

interface Searchable {
  name: string
  displayName?: string
  remark?: string
  tag?: string[]
}

function matchKeyword(item: Searchable, keyword: string): boolean {
  if (!keyword) return true
  const haystack = `${item.name} ${item.displayName ?? ''} ${item.remark ?? ''}`
  return haystack.toLowerCase().includes(keyword.toLowerCase())
}

function exportJson(item: Record<string, unknown>) {
  const blob = new Blob([JSON.stringify(item, null, 2)], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `suki-sub_${String(item.name)}.json`
  a.click()
  URL.revokeObjectURL(url)
}

function SubsPage() {
  const client = useQueryClient()
  const navigate = useNavigate()
  const subs = useSubs()
  const collections = useCollections()
  const [keyword, setKeyword] = useState('')
  const [tag, setTag] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [shareTarget, setShareTarget] = useState<ShareTarget | null>(null)
  const [shareOpen, setShareOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<{
    kind: 'sub' | 'collection'
    name: string
  } | null>(null)

  const allTags = useMemo(() => {
    const set = new Set<string>()
    for (const item of [...(subs.data ?? []), ...(collections.data ?? [])]) {
      for (const t of item.tag ?? []) set.add(t)
    }
    return [...set].sort()
  }, [subs.data, collections.data])

  const filter = (items: Searchable[] | undefined) =>
    (items ?? []).filter(
      (item) =>
        matchKeyword(item, keyword) && (!tag || (item.tag ?? []).includes(tag)),
    )

  const filteredSubs = filter(subs.data) as Subscription[]
  const filteredCols = filter(collections.data) as Collection[]

  const sortSubs = useSortMutation('subs')
  const sortCols = useSortMutation('collections')

  const deleteMutation = useMutation({
    mutationFn: async (target: NonNullable<typeof deleteTarget>) => {
      const url =
        target.kind === 'sub'
          ? ApiRoutes.sub(target.name)
          : ApiRoutes.collection(target.name)
      return api.del(url)
    },
    onSuccess: async (_, target) => {
      await removeCachedResource(client, target.kind, target.name)
      toast.success('已删除')
      setDeleteTarget(null)
    },
    onError: (err) => toast.error(`删除失败:${err.message}`),
  })

  const importJson = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as unknown
      const toCreate: { subs: unknown[]; collections: unknown[] } = {
        subs: [],
        collections: [],
      }
      const data = (
        parsed && typeof parsed === 'object' && 'data' in parsed
          ? (parsed as { data?: Record<string, unknown> }).data
          : parsed
      ) as Record<string, unknown> | unknown[] | null
      if (Array.isArray(data)) {
        toCreate.subs = data
      } else if (data && typeof data === 'object') {
        toCreate.subs = (data['subs'] ?? []) as unknown[]
        toCreate.collections = (data['collections'] ?? []) as unknown[]
      }
      if (!toCreate.subs.length && !toCreate.collections.length) {
        toast.error('文件中没有可导入的订阅')
        return
      }
      let ok = 0
      let fail = 0
      for (const item of toCreate.subs as { name?: string }[]) {
        try {
          const saved = await api.post<Subscription>(ApiRoutes.subs, item)
          await cacheResource(client, 'sub', saved)
          ok++
        } catch {
          fail++
        }
      }
      for (const item of toCreate.collections as { name?: string }[]) {
        try {
          const saved = await api.post<Collection>(ApiRoutes.collections, item)
          await cacheResource(client, 'collection', saved)
          ok++
        } catch {
          fail++
        }
      }
      toast.success(
        `导入完成:成功 ${ok}${fail ? `,失败 ${fail}(重名跳过)` : ''}`,
      )
      void client.invalidateQueries({ queryKey: qk.subs })
      void client.invalidateQueries({ queryKey: qk.collections })
    } catch (err) {
      toast.error(`导入失败:${err instanceof Error ? err.message : err}`)
    }
  }

  const exportItem = async (kind: 'sub' | 'collection', name: string) => {
    try {
      const data = await api.get<Record<string, unknown>>(
        kind === 'sub' ? ApiRoutes.sub(name) : ApiRoutes.collection(name),
      )
      exportJson(data)
    } catch (err) {
      toast.error(`读取失败:${err instanceof Error ? err.message : err}`)
    }
  }

  const cloneMutation = useMutation({
    mutationFn: async (target: {
      kind: 'sub' | 'collection'
      name: string
    }) => {
      const url =
        target.kind === 'sub'
          ? ApiRoutes.subClone(target.name)
          : ApiRoutes.collectionClone(target.name)
      return api.post<Subscription | Collection>(url)
    },
    onSuccess: async (clone, target) => {
      await cacheResource(client, target.kind, clone)
      toast.success(`已克隆为 ${resourceLabel(clone)}`)
    },
    onError: (err) => toast.error(`克隆失败:${err.message}`),
  })

  const loading = subs.isLoading || collections.isLoading
  const hasAny = (subs.data?.length ?? 0) + (collections.data?.length ?? 0) > 0

  const gridClass = 'grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3'

  return (
    <div className="page-container">
      <PageHeader
        eyebrow="SUBSCRIPTIONS"
        title="订阅"
        description="管理单条订阅与组合订阅。"
        actions={
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void importJson(file)
                e.target.value = ''
              }}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
            >
              <FilePlus2 aria-hidden />
              导入
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link to="/collections/$name" params={{ name: 'UNTITLED' }}>
                <Layers aria-hidden />
                新建组合
              </Link>
            </Button>
            <Button size="sm" asChild>
              <Link to="/subs/$name" params={{ name: 'UNTITLED' }}>
                <Plus aria-hidden />
                新建订阅
              </Link>
            </Button>
          </>
        }
      />

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative min-w-56 flex-1">
          <Search
            className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索名称或备注…"
            aria-label="搜索订阅"
            className="pl-8"
          />
        </div>
        {allTags.length > 0 && (
          <div
            className="flex min-w-0 items-center gap-1 overflow-x-auto whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&>*]:shrink-0"
            role="group"
            aria-label="按标签筛选"
          >
            <button
              type="button"
              onClick={() => setTag(null)}
              aria-pressed={tag === null}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                tag === null
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-card hover:bg-accent'
              }`}
            >
              全部
            </button>
            {allTags.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTag(t === tag ? null : t)}
                aria-pressed={tag === t}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  tag === t
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-card hover:bg-accent'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        )}
      </div>

      {loading ? (
        <div className={gridClass}>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-36 w-full" />
          ))}
        </div>
      ) : !hasAny ? (
        <EmptyState
          icon={Layers}
          title="还没有订阅"
          description="创建一个单条订阅,或把多个订阅组合到一起。"
          action={
            <Button size="sm" asChild>
              <Link to="/subs/$name" params={{ name: 'UNTITLED' }}>
                <Plus aria-hidden />
                新建订阅
              </Link>
            </Button>
          }
        />
      ) : (
        <div className="grid gap-6">
          <section
            id="subscriptions"
            className="scroll-mt-16"
            aria-label="单条订阅"
          >
            <h2 className="mb-2 px-1 text-sm font-medium">
              单条订阅
              <span className="ml-1 text-muted-foreground">
                ({filteredSubs.length})
              </span>
            </h2>
            {filteredSubs.length === 0 ? (
              <p className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
                {keyword || tag ? '没有匹配的订阅' : '暂无单条订阅'}
              </p>
            ) : (
              <SortableList
                items={filteredSubs}
                getId={(s) => s.name}
                getLabel={resourceLabel}
                onReorder={(next) =>
                  sortSubs.mutate(
                    next.map((s) => s.name),
                    {
                      onError: (err) => toast.error(`排序失败:${err.message}`),
                    },
                  )
                }
                className={gridClass}
                layout="grid"
              >
                {(sub) => (
                  <SubCard
                    key={sub.name}
                    sub={sub}
                    actions={[
                      {
                        key: 'edit',
                        label: '编辑',
                        icon: Pencil,
                        onClick: () =>
                          navigate({
                            to: '/subs/$name',
                            params: { name: sub.name },
                          }),
                      },
                      {
                        key: 'share',
                        label: '分享',
                        icon: Share2,
                        onClick: () => {
                          setShareTarget({ kind: 'sub', name: sub.name })
                          setShareOpen(true)
                        },
                      },
                      {
                        key: 'refresh',
                        label: '刷新流量',
                        icon: RefreshCw,
                        onClick: async () => {
                          try {
                            await refreshFlow(client, sub.name)
                          } catch (err) {
                            toast.error(
                              `刷新失败:${err instanceof Error ? err.message : err}`,
                            )
                          }
                        },
                      },
                    ]}
                    moreActions={[
                      {
                        key: 'clone',
                        label: '克隆',
                        icon: CopyPlus,
                        onClick: () =>
                          cloneMutation.mutate({ kind: 'sub', name: sub.name }),
                      },
                      {
                        key: 'export',
                        label: '导出 JSON',
                        icon: Download,
                        onClick: () => void exportItem('sub', sub.name),
                      },
                      {
                        key: 'delete',
                        label: '删除',
                        icon: Trash2,
                        destructive: true,
                        onClick: () =>
                          setDeleteTarget({ kind: 'sub', name: sub.name }),
                      },
                    ]}
                  />
                )}
              </SortableList>
            )}
          </section>

          <section
            id="collections"
            className="scroll-mt-16"
            aria-label="组合订阅"
          >
            <h2 className="mb-2 px-1 text-sm font-medium">
              组合订阅
              <span className="ml-1 text-muted-foreground">
                ({filteredCols.length})
              </span>
            </h2>
            {filteredCols.length === 0 ? (
              <p className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
                {keyword || tag ? '没有匹配的组合' : '暂无组合订阅'}
              </p>
            ) : (
              <SortableList
                items={filteredCols}
                getId={(c) => c.name}
                getLabel={resourceLabel}
                onReorder={(next) =>
                  sortCols.mutate(
                    next.map((c) => c.name),
                    {
                      onError: (err) => toast.error(`排序失败:${err.message}`),
                    },
                  )
                }
                className={gridClass}
                layout="grid"
              >
                {(collection) => (
                  <CollectionCard
                    key={collection.name}
                    collection={collection}
                    actions={[
                      {
                        key: 'edit',
                        label: '编辑',
                        icon: Pencil,
                        onClick: () =>
                          navigate({
                            to: '/collections/$name',
                            params: { name: collection.name },
                          }),
                      },
                      {
                        key: 'share',
                        label: '分享',
                        icon: Share2,
                        onClick: () => {
                          setShareTarget({
                            kind: 'collection',
                            name: collection.name,
                          })
                          setShareOpen(true)
                        },
                      },
                      {
                        key: 'refresh',
                        label: '刷新流量',
                        icon: RefreshCw,
                        onClick: async () => {
                          try {
                            await refreshCollectionFlow(client, collection.name)
                          } catch (error) {
                            toast.error(
                              `刷新失败:${error instanceof Error ? error.message : error}`,
                            )
                          }
                        },
                      },
                    ]}
                    moreActions={[
                      {
                        key: 'clone',
                        label: '克隆',
                        icon: CopyPlus,
                        onClick: () =>
                          cloneMutation.mutate({
                            kind: 'collection',
                            name: collection.name,
                          }),
                      },
                      {
                        key: 'export',
                        label: '导出 JSON',
                        icon: Download,
                        onClick: () =>
                          void exportItem('collection', collection.name),
                      },
                      {
                        key: 'delete',
                        label: '删除',
                        icon: Trash2,
                        destructive: true,
                        onClick: () =>
                          setDeleteTarget({
                            kind: 'collection',
                            name: collection.name,
                          }),
                      },
                    ]}
                  />
                )}
              </SortableList>
            )}
          </section>
        </div>
      )}

      <ShareDialog
        target={shareTarget}
        open={shareOpen}
        onOpenChange={setShareOpen}
      />
      <ConfirmDialog
        open={deleteTarget != null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
        title={`删除「${resourceLabel(
          (deleteTarget?.kind === 'sub' ? subs.data : collections.data)?.find(
            (item) => item.name === deleteTarget?.name,
          ),
          deleteTarget?.name,
        )}」`}
        description="删除后无法恢复,关联的产出会一并解除引用。"
        confirmText="删除"
        loading={deleteMutation.isPending}
        onConfirm={() => {
          if (deleteTarget) deleteMutation.mutate(deleteTarget)
        }}
      />
    </div>
  )
}
