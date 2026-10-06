import * as React from 'react'
import * as SwitchPrimitive from '@radix-ui/react-switch'

import { cn } from '#/lib/utils'

function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border p-px outline-none transition-colors duration-150 before:absolute before:-inset-y-3 before:-inset-x-1 before:content-[''] data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=unchecked]:border-border data-[state=unchecked]:bg-muted hover:data-[state=unchecked]:border-muted-foreground/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          'pointer-events-none block size-4 shrink-0 rounded-full bg-white ring-1 ring-black/5 transition-[transform,background-color] duration-150 ease-out data-[state=checked]:translate-x-4 data-[state=checked]:bg-primary-foreground data-[state=unchecked]:translate-x-0 motion-reduce:transition-none',
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
