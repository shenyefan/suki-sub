/**
 * 分享 token 管理:资源卡网格 + 详情弹窗(复制链接、删除)。
 */
import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link2, Plus, QrCode, Share2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { ApiRoutes } from '#/shared/api-contract'
import { isTokenExpired } from '#/shared/token'
import type { TokenItem } from '#/shared/types'
import { api, copyToClipboard, shareUrl } from '#/lib/api'
import { useTokens, useSubs, useCollections } from '#/lib/queries'
import { cacheToken, removeCachedToken } from '#/lib/query-cache'
import { resourceLabel } from '#/lib/resource-display'
import { ShareLinkDialog } from '#/components/shared/share-link-dialog'
import { ResourceIdentity } from '#/components/shared/resource-identity'
import { formatDateTime } from '#/lib/format'
import { PageHeader } from '#/components/shared/page-header'
import { EmptyState } from '#/components/shared/empty-state'
import { ConfirmDialog } from '#/components/shared/confirm-dialog'
import {
  Card,
  CardIcon,
  ResourceCardSkeleton,
} from '#/components/shared/resource-card'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { Badge } from '#/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'

export const Route = createFileRoute('/_app/shares')({
  component: TokensPage,
  validateSearch: (
    search: Record<string, unknown>,
  ): { share?: string; platform?: string } => ({
    share:
      typeof search.share === 'string' && search.share
        ? search.share
        : undefined,
    platform:
      typeof search.platform === 'string' && search.platform
        ? search.platform
        : undefined,
  }),
})

const TYPE_LABELS: Record<string, string> = {
  sub: '单条订阅',
  collection: '组合订阅',
}

const DURATION_OPTIONS = [
  { value: 'forever', label: '永久' },
  { value: '86400000', label: '1 天' },
  { value: '604800000', label: '7 天' },
  { value: '2592000000', label: '30 天' },
  { value: '31536000000', label: '365 天' },
] as const

function tokenLink(token: TokenItem): string | null {
  if (token.name === '*') return null
  return shareUrl(token.id)
}

function CreateTokenDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (token: TokenItem) => void
}) {
  const client = useQueryClient()
  const subs = useSubs()
  const collections = useCollections()
  const targets = [
    ...(subs.data ?? []).map((sub) => ({
      value: JSON.stringify(['sub', sub.name]),
      type: 'sub',
      name: sub.name,
      label: resourceLabel(sub),
      resource: sub,
    })),
    ...(collections.data ?? []).map((collection) => ({
      value: JSON.stringify(['collection', collection.name]),
      type: 'collection',
      name: collection.name,
      label: resourceLabel(collection),
      resource: collection,
    })),
  ]
  const [selection, setSelection] = useState('')
  const selected = targets.find((target) => target.value === selection)
  const [duration, setDuration] = useState<string>('forever')
  const [count, setCount] = useState('')

  const create = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error('请选择要分享的订阅')
      const body: Record<string, unknown> = {
        type: selected.type,
        name: selected.name,
      }
      if (duration !== 'forever') body.endAt = Date.now() + Number(duration)
      const n = Number(count)
      if (count && Number.isFinite(n) && n > 0) body.count = n
      return api.post<TokenItem>(ApiRoutes.shares, body)
    },
    onSuccess: async (token) => {
      await cacheToken(client, token)
      toast.success('分享已创建')
      onOpenChange(false)
      setSelection('')
      setCount('')
      onCreated(token)
    },
    onError: (err) => toast.error(`创建失败:${err.message}`),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>新建分享</DialogTitle>
          <DialogDescription>选择订阅，创建分享链接。</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="share-resource">分享订阅</Label>
            <Select value={selection} onValueChange={setSelection}>
              <SelectTrigger
                id="share-resource"
                className="w-full"
                disabled={
                  subs.isLoading || collections.isLoading || !targets.length
                }
              >
                <SelectValue
                  placeholder={
                    subs.isLoading || collections.isLoading
                      ? '加载中…'
                      : '请选择订阅'
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {targets.map((target) => (
                  <SelectItem key={target.value} value={target.value}>
                    <ResourceIdentity
                      resource={target.resource}
                      name={target.name}
                    />{' '}
                    · {TYPE_LABELS[target.type]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {subs.isError || collections.isError ? (
              <p role="alert" className="text-xs text-destructive">
                订阅列表加载失败，请重试。
              </p>
            ) : !subs.isLoading && !collections.isLoading && !targets.length ? (
              <p className="text-xs text-muted-foreground">请先创建订阅。</p>
            ) : null}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label>有效期</Label>
              <Select value={duration} onValueChange={setDuration}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DURATION_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="token-count">次数</Label>
              <Input
                id="token-count"
                type="number"
                min={1}
                value={count}
                onChange={(e) => setCount(e.target.value)}
                placeholder="留空不限次数"
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button
            onClick={() => create.mutate()}
            disabled={!selected}
            loading={create.isPending}
          >
            <Plus aria-hidden />
            创建
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function TokensPage() {
  const { share, platform } = Route.useSearch()
  const navigate = Route.useNavigate()
  const showLink = (id: string) => {
    void navigate({ search: { share: id } })
  }
  const subs = useSubs()
  const collections = useCollections()
  const tokens = useTokens()
  const client = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const remove = useMutation({
    mutationFn: (id: string) => api.del(ApiRoutes.share(id)),
    onSuccess: async (_, id) => {
      await removeCachedToken(client, id)
      toast.success('已删除')
      setDeleteId(null)
    },
    onError: (err) => toast.error(`删除失败:${err.message}`),
  })

  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  return (
    <div className="page-container">
      <PageHeader
        eyebrow="SHARING"
        title="分享"
        description="创建和管理订阅分享链接。"
        actions={
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus aria-hidden />
            新建分享
          </Button>
        }
      />

      {tokens.isLoading ? (
        <ul
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
          role="status"
          aria-label="正在加载分享"
          aria-busy="true"
        >
          {Array.from({ length: 3 }, (_, i) => (
            <ResourceCardSkeleton key={i} />
          ))}
        </ul>
      ) : !tokens.data?.length ? (
        <EmptyState
          icon={Share2}
          title="还没有分享"
          description="选择订阅，创建第一个分享链接。"
          action={
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              新建分享
            </Button>
          }
        />
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {tokens.data.map((token) => {
            const link = tokenLink(token)
            const resource = (
              token.type === 'sub' ? subs.data : collections.data
            )?.find((item) => item.name === token.name)
            return (
              <Card
                key={token.id}
                icon={
                  <CardIcon
                    src={resource?.icon || resource?.img}
                    name={resourceLabel(resource, token.name)}
                    color={resource?.isIconColor}
                    fit={resource?.iconFit}
                  />
                }
                title={
                  <>
                    {resourceLabel(resource, token.name)}
                    {isTokenExpired(token, now) && (
                      <Badge variant="destructive">已过期</Badge>
                    )}
                  </>
                }
                subtitle={TYPE_LABELS[token.type] ?? token.type}
                content1={
                  <>
                    {token.endAt ? `至 ${formatDateTime(token.endAt)}` : '永久'}
                    {token.count != null &&
                      ` · 已用 ${token.usedCount ?? 0}/${token.count}`}
                  </>
                }
                content2={
                  token.createdAt
                    ? `创建于 ${formatDateTime(token.createdAt)}`
                    : undefined
                }
                actions={[
                  ...(link
                    ? [
                        {
                          key: 'copy-link',
                          label: '复制链接',
                          icon: Link2,
                          onClick: async () => {
                            if (await copyToClipboard(link)) {
                              toast.success('链接已复制')
                            }
                          },
                        },
                        {
                          key: 'qr-code',
                          label: '查看二维码',
                          icon: QrCode,
                          onClick: () => showLink(token.id),
                        },
                      ]
                    : []),
                  {
                    key: 'delete',
                    label: '删除',
                    icon: Trash2,
                    destructive: true,
                    className: 'ml-auto',
                    onClick: () => setDeleteId(token.id),
                  },
                ]}
              />
            )
          })}
        </ul>
      )}

      <CreateTokenDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(token) => showLink(token.id)}
      />
      <ShareLinkDialog
        shareId={share}
        platform={platform}
        onOpenChange={(open) => {
          if (!open) void navigate({ search: {}, replace: true })
        }}
      />
      <ConfirmDialog
        open={deleteId != null}
        onOpenChange={(open) => {
          if (!open) setDeleteId(null)
        }}
        title="删除分享"
        description="删除后，此分享链接将失效。"
        confirmText="删除"
        loading={remove.isPending}
        onConfirm={() => {
          if (deleteId) remove.mutate(deleteId)
        }}
      />
    </div>
  )
}
