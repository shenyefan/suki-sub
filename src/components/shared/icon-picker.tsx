import { useId, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Check, ImageIcon, Loader2, Search } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '#/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'

// Same public icon collection format as Suki Sub: { icons: [{ name, url }] }.
const COLLECTIONS = [
  {
    name: 'Qure · 彩色',
    url: 'https://raw.githubusercontent.com/Koolson/Qure/master/Other/QureColor.json',
  },
  {
    name: 'Qure · 扩展',
    url: 'https://raw.githubusercontent.com/xream/Qure/refs/heads/master/xream/iconset.json',
  },
  {
    name: 'Orz-3 · mini',
    url: 'https://raw.githubusercontent.com/Orz-3/mini/master/mini.json',
  },
  {
    name: 'Orz-3 · 彩色',
    url: 'https://raw.githubusercontent.com/Orz-3/mini/master/miniColor.json',
  },
  {
    name: 'luestr · KeLee',
    url: 'https://raw.githubusercontent.com/luestr/IconResource/main/KeLee_icon.json',
  },
]

type IconItem = { name: string; url: string }

export function IconPreview({
  url,
  className = '',
  fit = 'contain',
  monochrome = false,
}: {
  url: string
  className?: string
  fit?: 'cover' | 'contain' | 'fill'
  monochrome?: boolean
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  return url && failedUrl !== url ? (
    <img
      src={url}
      style={{
        objectFit: fit,
        filter: monochrome ? 'grayscale(1)' : undefined,
      }}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailedUrl(url)}
      className={`object-contain ${className}`}
    />
  ) : (
    <ImageIcon aria-hidden className={`text-muted-foreground ${className}`} />
  )
}

export function IconPicker({
  value,
  onChange,
}: {
  value: string
  onChange: (url: string) => void
}) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [collection, setCollection] = useState(COLLECTIONS[0].url)
  const [customUrl, setCustomUrl] = useState('')
  const [loadedCustomUrl, setLoadedCustomUrl] = useState('')
  const [search, setSearch] = useState('')
  const [limit, setLimit] = useState(120)
  const [validation, setValidation] = useState('')
  const url = collection === 'custom' ? loadedCustomUrl : collection
  const icons = useQuery({
    queryKey: ['icon-collection', url],
    enabled: open && Boolean(url),
    staleTime: 30 * 60 * 1000,
    retry: 1,
    queryFn: async ({ signal }): Promise<IconItem[]> => {
      const response = await fetch(url, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      })
      if (!response.ok) throw new Error('图标集加载失败')
      const data: unknown = await response.json()
      if (
        !data ||
        typeof data !== 'object' ||
        !('icons' in data) ||
        !Array.isArray(data.icons)
      )
        throw new Error('图标集格式不正确，需要 icons 列表')
      return data.icons.flatMap((item: unknown) => {
        if (!item || typeof item !== 'object') return []
        const icon = item as Record<string, unknown>
        if (typeof icon.url !== 'string' || !/^https?:\/\//i.test(icon.url))
          return []
        return [
          {
            name: typeof icon.name === 'string' ? icon.name : '未命名图标',
            url: icon.url,
          },
        ]
      })
    },
  })
  const filtered = (icons.data ?? []).filter((icon) =>
    icon.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
  )

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" className="shrink-0">
          <ImageIcon aria-hidden />
          选择图标
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[85dvh] flex-col overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>选择图标</DialogTitle>
          <DialogDescription>
            搜索并点击图标，自动填入图标地址。
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor={`${id}-collection`}>图标集</Label>
            <Select
              value={collection}
              onValueChange={(next) => {
                setCollection(next)
                setLimit(120)
              }}
            >
              <SelectTrigger id={`${id}-collection`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COLLECTIONS.map((item) => (
                  <SelectItem key={item.url} value={item.url}>
                    {item.name}
                  </SelectItem>
                ))}
                <SelectItem value="custom">自定义图标集</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`${id}-search`}>搜索</Label>
            <div className="relative">
              <Search
                aria-hidden
                className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground"
              />
              <Input
                id={`${id}-search`}
                className="pl-9"
                value={search}
                placeholder="输入图标名称，如：香港、Netflix"
                onChange={(event) => {
                  setSearch(event.target.value)
                  setLimit(120)
                }}
              />
            </div>
          </div>
        </div>
        {collection === 'custom' && (
          <div className="flex gap-2">
            <Input
              aria-label="自定义图标集地址"
              value={customUrl}
              placeholder="https://…/icons.json（Suki Sub 图标集）"
              onChange={(event) => {
                setCustomUrl(event.target.value)
                setValidation('')
              }}
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                try {
                  const parsed = new URL(customUrl.trim())
                  if (!['https:', 'http:'].includes(parsed.protocol))
                    throw new Error()
                  setValidation('')
                  setLimit(120)
                  if (loadedCustomUrl === parsed.href) void icons.refetch()
                  else setLoadedCustomUrl(parsed.href)
                } catch {
                  setValidation('请输入有效的 HTTP 或 HTTPS 图标集地址')
                }
              }}
            >
              加载
            </Button>
          </div>
        )}
        {validation && (
          <div role="alert" className="text-sm text-destructive">
            {validation}
          </div>
        )}
        <div
          className="min-h-48 overflow-y-auto rounded-lg border bg-muted/20 p-3"
          aria-busy={icons.isFetching}
        >
          {icons.isFetching ? (
            <div
              role="status"
              className="flex min-h-48 items-center justify-center gap-2 text-sm text-muted-foreground"
            >
              <Loader2 aria-hidden className="size-4 animate-spin" />
              正在加载图标…
            </div>
          ) : icons.isError ? (
            <div
              role="alert"
              className="grid min-h-48 place-content-center justify-items-center gap-3 text-sm"
            >
              <span>无法加载图标集，请检查网络或切换图标集。</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void icons.refetch()}
              >
                重试
              </Button>
            </div>
          ) : !url || !filtered.length ? (
            <div
              role="status"
              className="grid min-h-48 place-content-center text-sm text-muted-foreground"
            >
              {!url
                ? '输入图标集地址后点击加载'
                : search
                  ? '没有匹配的图标，试试其他关键词'
                  : '图标集中暂无可用图标'}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                {filtered.slice(0, limit).map((icon, index) => (
                  <button
                    key={`${icon.url}-${index}`}
                    type="button"
                    aria-label={`选择 ${icon.name}`}
                    aria-pressed={value === icon.url}
                    title={icon.name}
                    className="relative flex min-w-0 flex-col items-center gap-2 rounded-lg border border-transparent p-3 transition-colors hover:border-border hover:bg-card focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none aria-pressed:border-ring aria-pressed:bg-card"
                    onClick={() => {
                      onChange(icon.url)
                      setOpen(false)
                    }}
                  >
                    <IconPreview url={icon.url} className="size-10" />
                    <span className="w-full truncate text-center text-xs">
                      {icon.name}
                    </span>
                    {value === icon.url && (
                      <Check
                        aria-hidden
                        className="absolute top-1 right-1 size-3 text-link"
                      />
                    )}
                  </button>
                ))}
              </div>
              {filtered.length > limit && (
                <Button
                  type="button"
                  variant="ghost"
                  className="mt-3 w-full"
                  onClick={() => setLimit((count) => count + 120)}
                >
                  加载更多（已显示 {Math.min(limit, filtered.length)} /{' '}
                  {filtered.length}）
                </Button>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
