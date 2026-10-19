import { Skeleton } from '#/components/ui/skeleton'

/** 字段保留实际标签和控件高度，加载时不展示可编辑的默认值。 */
export function FieldSkeleton({
  label,
  className,
  multiline = false,
}: {
  label: string
  className?: string
  multiline?: boolean
}) {
  return (
    <div className={`grid min-w-0 content-start gap-2 ${className ?? ''}`}>
      <span className="text-sm leading-none font-medium">{label}</span>
      <Skeleton
        className={multiline ? 'h-24 w-full' : 'h-9 w-full'}
        aria-hidden
      />
    </div>
  )
}
