import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva } from 'class-variance-authority'
import type { VariantProps } from 'class-variance-authority'
import { Loader2 } from 'lucide-react'

import { cn } from '#/lib/utils'

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
  {
    variants: {
      variant: {
        default:
          'bg-primary text-primary-foreground shadow-xs hover:bg-primary/90',
        destructive:
          'bg-destructive text-destructive-foreground shadow-xs hover:bg-destructive/90',
        outline:
          'border border-input bg-card shadow-xs hover:bg-accent hover:text-accent-foreground',
        secondary:
          'bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-link underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-4 py-2 has-[>svg]:px-3',
        sm: 'h-8 gap-1.5 px-3 has-[>svg]:px-2.5',
        lg: 'h-10 px-6 has-[>svg]:px-4',
        icon: 'size-9',
        'icon-sm': 'size-8',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  loading = false,
  disabled,
  children,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
    /** 请求进行中：禁用按钮，已有图标替换为旋转图标，无图标时前置。 */
    loading?: boolean
  }) {
  const Comp = asChild ? Slot : 'button'
  // asChild 时保持单一子元素；普通模式加载时隐藏原图标，保留文字和布局。
  return (
    <Comp
      data-slot="button"
      className={cn(
        buttonVariants({ variant, size, className }),
        loading && !asChild && '[&>svg:not([data-slot=button-spinner])]:hidden',
      )}
      disabled={disabled || loading || undefined}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && !asChild ? (
        <>
          <Loader2
            data-slot="button-spinner"
            className="animate-spin"
            aria-hidden
          />
          {children}
        </>
      ) : (
        children
      )}
    </Comp>
  )
}

export { Button, buttonVariants }
