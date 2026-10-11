/**
 * 资源卡片(suki-auth 应用卡风格),严格等高布局:
 * - 头部:图标 + 右侧一行主标题、一行副标题
 * - 内容:固定两行(空则占位空白)
 * - 底部:操作按钮行
 * 所有行禁止换行,超出横向滚动;行数固定保证网格内高度一致。
 */
import { GripVertical, MoreVertical } from 'lucide-react'
import { useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

import { cn } from '#/lib/utils'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'

/** 固定单行:不换行,超出横向滚动(无可见滚动条),子项不压缩 */
const lineClass =
  'flex w-full items-center gap-1 overflow-x-auto whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&>*]:shrink-0'

export interface CardAction {
  key: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  onClick: () => void
  destructive?: boolean
  className?: string
}

export function CardIcon({
  src,
  name,
  color = true,
  fit,
  className,
}: {
  src?: string
  name: string
  /** false 时灰度显示(原版 isIconColor) */
  color?: boolean
  /** 图片适配方式(原版 iconFit) */
  fit?: string
  className?: string
}) {
  const [failedSrc, setFailedSrc] = useState<string>()
  if (src && failedSrc !== src) {
    return (
      <img
        src={src}
        alt=""
        loading="lazy"
        onError={() => setFailedSrc(src)}
        className={cn(
          'size-10 shrink-0 rounded-md border bg-card object-cover',
          !color && 'grayscale',
          className,
        )}
        style={
          fit ? { objectFit: fit as 'contain' | 'cover' | 'fill' } : undefined
        }
      />
    )
  }
  return (
    <span
      aria-hidden
      className={cn(
        'flex size-10 shrink-0 items-center justify-center rounded-md border bg-card text-sm font-semibold',
        className,
      )}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  )
}

/** 统一布局实现:头部(图标/标题行/副标题/手柄)+ 两行内容 + 操作行 */
function CardLayout({
  icon,
  title,
  subtitle,
  content1,
  content2,
  actions,
  moreActions,
  dragHandle,
  className,
  setNodeRef,
  style,
}: {
  icon?: React.ReactNode
  title: React.ReactNode
  subtitle?: React.ReactNode
  content1?: React.ReactNode
  content2?: React.ReactNode
  actions: CardAction[]
  moreActions: CardAction[]
  dragHandle: React.ReactNode
  className?: string
  setNodeRef?: (node: HTMLElement | null) => void
  style?: React.CSSProperties
}) {
  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn(
        'group relative flex flex-col rounded-lg border bg-card p-3',
        className,
      )}
    >
      <div className="flex items-center gap-3">
        {icon}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div
            className={cn(lineClass, 'h-5 text-sm font-medium')}
            title={typeof title === 'string' ? title : undefined}
          >
            {title}
          </div>
          <div
            className={cn(lineClass, 'h-4 text-xs text-muted-foreground')}
            title={typeof subtitle === 'string' ? subtitle : undefined}
          >
            {subtitle ?? '\u00A0'}
          </div>
        </div>
        {dragHandle}
      </div>

      <div className="mt-2 grid gap-1">
        <div className={cn(lineClass, 'h-4 text-xs text-muted-foreground')}>
          {content1 ?? '\u00A0'}
        </div>
        <div className={cn(lineClass, 'h-4 text-xs text-muted-foreground')}>
          {content2 ?? '\u00A0'}
        </div>
      </div>

      <div
        className="mt-2 flex h-8 items-center gap-0.5 border-t pt-2"
        role="group"
        aria-label="操作"
      >
        {actions.map((action) => (
          <Button
            key={action.key}
            variant="ghost"
            size="icon-sm"
            aria-label={action.label}
            title={action.label}
            onClick={action.onClick}
            className={cn(
              action.destructive && 'text-destructive hover:text-destructive',
              action.className,
            )}
          >
            <action.icon className="size-4" />
          </Button>
        ))}
        {moreActions.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="更多操作"
                title="更多操作"
                className="ml-auto"
              >
                <MoreVertical className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {moreActions.map((action) => (
                <DropdownMenuItem
                  key={action.key}
                  variant={action.destructive ? 'destructive' : 'default'}
                  onSelect={action.onClick}
                >
                  <action.icon aria-hidden />
                  {action.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </li>
  )
}

/** 通用资源卡(不可排序):与 SortableCard 同一布局,供无排序需求的页面复用 */
export function Card({
  icon,
  title,
  subtitle,
  content1,
  content2,
  actions = [],
  moreActions = [],
  className,
}: {
  icon?: React.ReactNode
  title: React.ReactNode
  subtitle?: React.ReactNode
  content1?: React.ReactNode
  content2?: React.ReactNode
  actions?: CardAction[]
  moreActions?: CardAction[]
  className?: string
}) {
  return (
    <CardLayout
      icon={icon}
      title={title}
      subtitle={subtitle}
      content1={content1}
      content2={content2}
      actions={actions}
      moreActions={moreActions}
      dragHandle={null}
      className={className}
    />
  )
}

/**
 * 可排序资源卡:等高固定行结构,内容两行为空时保持占位。
 */
export function SortableCard({
  id,
  icon,
  title,
  subtitle,
  content1,
  content2,
  actions = [],
  moreActions = [],
  className,
}: {
  id: string
  icon?: React.ReactNode
  title: React.ReactNode
  subtitle?: React.ReactNode
  /** 内容第一行(可为空,占位) */
  content1?: React.ReactNode
  /** 内容第二行(可为空,占位) */
  content2?: React.ReactNode
  /** 内联图标按钮(常用操作) */
  actions?: CardAction[]
  /** 溢出操作,收进省略号菜单 */
  moreActions?: CardAction[]
  className?: string
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id })
  return (
    <CardLayout
      icon={icon}
      title={title}
      subtitle={subtitle}
      content1={content1}
      content2={content2}
      actions={actions}
      moreActions={moreActions}
      dragHandle={
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label="拖动排序(聚焦后空格拾起,方向键移动)"
          className="flex size-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-accent focus-visible:opacity-100 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none group-hover:opacity-100 active:cursor-grabbing"
        >
          <GripVertical className="size-4" aria-hidden />
        </button>
      }
      className={cn(className, isDragging && 'z-10 opacity-80')}
      setNodeRef={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    />
  )
}

export function CardBadges({ items }: { items: string[] }) {
  if (!items.length) return null
  return (
    <>
      {items.map((item) => (
        <Badge key={item} variant="secondary">
          {item}
        </Badge>
      ))}
    </>
  )
}
