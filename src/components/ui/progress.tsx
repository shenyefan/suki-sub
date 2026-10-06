import * as React from 'react'
import * as ProgressPrimitive from '@radix-ui/react-progress'

import { cn } from '#/lib/utils'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '#/components/ui/tooltip'

function Progress({
  className,
  value,
  tooltip,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root> & {
  tooltip?: React.ReactNode
}) {
  return (
    <Tooltip delayDuration={150}>
      <TooltipTrigger asChild>
        <ProgressPrimitive.Root
          data-slot="progress"
          value={value}
          tabIndex={0}
          className={cn(
            'bg-secondary relative h-1.5 w-full overflow-hidden rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            className,
          )}
          {...props}
        >
          <ProgressPrimitive.Indicator
            data-slot="progress-indicator"
            className="bg-primary h-full w-full flex-1 transition-transform motion-reduce:transition-none"
            style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
          />
        </ProgressPrimitive.Root>
      </TooltipTrigger>
      <TooltipContent sideOffset={6}>
        {tooltip ??
          (value == null ? '进度未知' : `已完成 ${Math.round(value)}%`)}
      </TooltipContent>
    </Tooltip>
  )
}

export { Progress }
