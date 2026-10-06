import { useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { Button } from '#/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '#/components/ui/dropdown-menu'

export type EditorAction = {
  id: string
  label: string
  icon: ReactNode
  onClick: () => void
  disabled?: boolean
  destructive?: boolean
}

/** Keep primary actions visible as space permits, with save pinned to the right. */
export function EditorActions({
  items,
  save,
}: {
  items: EditorAction[]
  save?: ReactNode
}) {
  const container = useRef<HTMLDivElement>(null)
  const measure = useRef<HTMLDivElement>(null)
  const saved = useRef<HTMLDivElement>(null)
  const [count, setCount] = useState(0)
  const [fullWidth, setFullWidth] = useState<number>()
  useLayoutEffect(() => {
    const host = container.current
    const measurements = measure.current
    if (!host || !measurements) return
    const update = () => {
      const gap = parseFloat(getComputedStyle(host).columnGap) || 0
      const widths = Array.from(measurements.children).map(
        (child) => child.getBoundingClientRect().width,
      )
      const saveWidth = saved.current?.getBoundingClientRect().width ?? 0
      const available = host.clientWidth - (saveWidth ? saveWidth + gap : 0)
      const total = widths.reduce((sum, width) => sum + width, 0)
      setFullWidth(
        total +
          Math.max(0, widths.length - 1) * gap +
          (saveWidth ? saveWidth + (widths.length ? gap : 0) : 0),
      )
      if (total + Math.max(0, widths.length - 1) * gap <= available) {
        setCount(items.length)
        return
      }
      // Reserve the overflow button before deciding which actions fit.
      let used = 32
      let visible = 0
      for (const width of widths) {
        if (used + gap + width > available) break
        used += gap + width
        visible++
      }
      setCount(visible)
    }
    const observer = new ResizeObserver(update)
    observer.observe(host)
    observer.observe(measurements)
    if (saved.current) observer.observe(saved.current)
    update()
    return () => observer.disconnect()
  }, [items, save])
  const shown = items.slice(0, count)
  const overflow = items.slice(count)
  return (
    <div
      ref={container}
      style={{ maxWidth: fullWidth }}
      className="relative flex w-full min-w-0 items-center justify-end gap-1.5 sm:gap-2"
      role="group"
      aria-label="编辑操作"
    >
      <div
        ref={measure}
        aria-hidden
        inert
        className="invisible pointer-events-none absolute flex w-max gap-2"
      >
        {items.map((item) => (
          <Button key={item.id} variant="outline" size="sm" tabIndex={-1}>
            {item.icon}
            {item.label}
          </Button>
        ))}
      </div>
      {overflow.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="更多编辑操作"
            >
              <MoreHorizontal aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="bottom" align="end" sideOffset={8}>
            {overflow.map((item) => (
              <DropdownMenuItem
                key={item.id}
                disabled={item.disabled}
                variant={item.destructive ? 'destructive' : undefined}
                onSelect={item.onClick}
              >
                {item.icon}
                {item.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {shown.map((item) => (
        <Button
          key={item.id}
          type="button"
          variant="outline"
          size="sm"
          className={item.destructive ? 'text-destructive' : undefined}
          disabled={item.disabled}
          onClick={item.onClick}
        >
          {item.icon}
          {item.label}
        </Button>
      ))}
      {save && (
        <div ref={saved} className="flex shrink-0 items-center">
          {save}
        </div>
      )}
    </div>
  )
}
