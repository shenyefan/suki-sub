import { cn } from '#/lib/utils'

/** 页头:Geist Mono 眉题 + 标题 + 右侧操作区 */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  eyebrow?: string
  title: string
  description?: string
  actions?: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'page-header mb-6 flex min-w-0 flex-col gap-4 lg:flex-row lg:items-center lg:justify-between',
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        {eyebrow && <p className="eyebrow mb-1">{eyebrow}</p>}
        <h1 className="break-words text-xl font-semibold tracking-tight sm:text-2xl">
          {title}
        </h1>
        {description && (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && (
        <div className="page-header-actions flex shrink-0 flex-wrap items-center gap-2">
          {actions}
        </div>
      )}
    </div>
  )
}
