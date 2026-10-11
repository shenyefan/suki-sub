/**
 * 分享弹窗:为资源创建只读 token 并复制下载/原始内容链接。
 */
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { ApiRoutes } from '#/shared/api-contract'
import type { TokenItem } from '#/shared/types'
import { api, copyToClipboard, shareUrl } from '#/lib/api'
import { cacheToken } from '#/lib/query-cache'
import { resourceLabel } from '#/lib/resource-display'
import { ResourceIdentity } from './resource-identity'
import { useSubs, useCollections } from '#/lib/queries'
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'

export interface ShareTarget {
  kind: 'sub' | 'collection'
  name: string
}

const DURATION_OPTIONS = [
  { value: 'forever', label: '永久' },
  { value: '86400000', label: '1 天' },
  { value: '604800000', label: '7 天' },
  { value: '2592000000', label: '30 天' },
  { value: '31536000000', label: '365 天' },
] as const

const TARGET_PLATFORMS = [
  'auto',
  'JSON',
  'clash',
  'clashmeta',
  'surge',
  'surgemac',
  'loon',
  'stash',
  'qx',
  'shadowrocket',
  'surfboard',
  'sing-box',
  'egern',
  'v2ray',
  'uri',
] as const

export function ShareDialog({
  target,
  open,
  onOpenChange,
}: {
  target: ShareTarget | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const subs = useSubs()
  const collections = useCollections()
  const resource = (
    target?.kind === 'sub' ? subs.data : collections.data
  )?.find((item) => item.name === target?.name)
  const [duration, setDuration] = useState<string>('forever')
  const [count, setCount] = useState<string>('')
  const [platform, setPlatform] = useState<string>('auto')
  const [creating, setCreating] = useState(false)

  const createToken = async () => {
    if (!target) return
    setCreating(true)
    try {
      const body: Record<string, unknown> = {
        type: target.kind,
        name: target.name,
      }
      if (duration !== 'forever') body.endAt = Date.now() + Number(duration)
      const n = Number(count)
      if (count && Number.isFinite(n) && n > 0) body.count = n
      const token = await api.post<TokenItem>(ApiRoutes.shares, body)
      await cacheToken(queryClient, token)
      const link = shareUrl(
        token.id,
        platform === 'auto' ? undefined : platform,
      )
      if (await copyToClipboard(link)) {
        toast.success('分享链接已创建并复制')
      } else {
        toast.success('分享已创建，可在分享页复制链接')
      }
    } catch (err) {
      toast.error(
        `创建失败:${err instanceof Error ? err.message : String(err)}`,
      )
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            分享
            {target && (
              <ResourceIdentity
                resource={resource}
                name={resourceLabel(resource, target.name)}
              />
            )}
          </DialogTitle>
          <DialogDescription>
            创建订阅分享链接，设置有效期与可用次数。
          </DialogDescription>
        </DialogHeader>

        {target && (
          <div className="grid gap-2">
            <label className="text-sm font-medium" htmlFor="share-platform">
              目标平台
            </label>
            <Select value={platform} onValueChange={setPlatform}>
              <SelectTrigger id="share-platform" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TARGET_PLATFORMS.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p === 'auto' ? '自动识别' : p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-2">
            <label className="text-sm font-medium" htmlFor="share-duration">
              有效期
            </label>
            <Select value={duration} onValueChange={setDuration}>
              <SelectTrigger id="share-duration" className="w-full">
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
          <div className="grid gap-2">
            <label className="text-sm font-medium" htmlFor="share-count">
              可用次数
            </label>
            <Input
              id="share-count"
              type="number"
              min={1}
              placeholder="留空不限次数"
              value={count}
              onChange={(e) => setCount(e.target.value)}
            />
          </div>
        </div>

        <Button onClick={() => void createToken()} loading={creating}>
          {creating ? '创建中…' : '创建分享并复制链接'}
        </Button>
      </DialogContent>
    </Dialog>
  )
}
