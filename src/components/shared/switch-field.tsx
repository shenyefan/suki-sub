import { useId } from 'react'
import type { ComponentProps } from 'react'
import { Label } from '#/components/ui/label'
import { Switch } from '#/components/ui/switch'
import { cn } from '#/lib/utils'

/** Flat settings row: the label owns the space, the control keeps a fixed size. */
export function SwitchField({
  label,
  id,
  className,
  ...props
}: ComponentProps<typeof Switch> & { label: string }) {
  const generatedId = useId()
  const controlId = id ?? generatedId
  return (
    <div
      className={cn(
        'flex min-h-11 min-w-0 items-center justify-between gap-6 self-end',
        className,
      )}
    >
      <Label
        htmlFor={controlId}
        className={cn(
          'flex min-h-11 flex-1 cursor-pointer items-center py-2 text-sm font-medium leading-5',
          props.disabled && 'cursor-not-allowed opacity-50',
        )}
      >
        {label}
      </Label>
      <Switch id={controlId} {...props} />
    </div>
  )
}
