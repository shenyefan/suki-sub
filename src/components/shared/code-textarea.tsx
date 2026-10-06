/** 等宽字体的多行代码编辑(textarea) */
import { Textarea } from '#/components/ui/textarea'
import { cn } from '#/lib/utils'

export function CodeTextarea({
  className,
  ...props
}: React.ComponentProps<typeof Textarea>) {
  return (
    <Textarea
      spellCheck={false}
      className={cn(
        'min-h-48 font-mono text-xs leading-relaxed field-sizing-normal',
        className,
      )}
      {...props}
    />
  )
}
