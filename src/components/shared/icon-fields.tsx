import { useId } from 'react'
import { Pencil } from 'lucide-react'
import { IconPicker, IconPreview } from './icon-picker'
import { cn } from '#/lib/utils'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { Switch } from '#/components/ui/switch'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '#/components/ui/popover'

type IconStyle = { isIconColor?: boolean; iconFit?: string }
const FIT_OPTIONS = [
  { value: 'cover', label: '填充' },
  { value: 'contain', label: '适应' },
  { value: 'fill', label: '拉伸' },
] as const

/** Appearance controls stay with the icon, outside the main form's field grid. */
export function IconField({
  id,
  value,
  onChange,
  item,
  patch,
  className,
}: {
  className?: string
  id: string
  value: string
  onChange: (url: string) => void
  item: IconStyle
  patch: (style: IconStyle) => void
}) {
  const controlId = useId()
  const fit =
    FIT_OPTIONS.find((option) => option.value === item.iconFit)?.value ??
    'cover'
  return (
    <div className={cn('grid min-w-0 content-start gap-1.5', className)}>
      <Label htmlFor={id}>图标</Label>
      <div className="flex items-center gap-2">
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="relative flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-md border bg-background p-1 transition-colors hover:border-muted-foreground/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background data-[state=open]:border-foreground"
              aria-label="编辑图标外观"
              title="编辑图标外观"
            >
              <span className="flex size-7 items-center justify-center overflow-hidden rounded-sm">
                <IconPreview
                  url={value}
                  fit={fit}
                  monochrome={item.isIconColor === false}
                  className="size-7"
                />
              </span>
              <span className="pointer-events-none absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full border bg-card text-foreground">
                <Pencil className="size-2.5" aria-hidden />
              </span>
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="w-64 max-w-[calc(100vw-2rem)] rounded-lg p-4"
            aria-label="图标显示设置"
          >
            <div className="flex min-h-11 items-center justify-between gap-4">
              <Label
                htmlFor={`${controlId}-color`}
                className="cursor-pointer text-sm font-normal leading-5"
              >
                保留原色
              </Label>
              <Switch
                id={`${controlId}-color`}
                checked={item.isIconColor !== false}
                onCheckedChange={(isIconColor) => patch({ isIconColor })}
              />
            </div>
            <fieldset className="mt-2 min-w-0">
              <legend className="mb-2 text-sm">显示方式</legend>
              <div className="grid grid-cols-3 gap-1 rounded-md bg-muted p-1">
                {FIT_OPTIONS.map((option) => (
                  <label key={option.value} className="relative">
                    <input
                      type="radio"
                      name={`${controlId}-fit`}
                      value={option.value}
                      checked={fit === option.value}
                      onChange={() => patch({ iconFit: option.value })}
                      className="peer sr-only"
                    />
                    <span className="flex h-8 cursor-pointer items-center justify-center rounded-sm border border-transparent text-xs text-muted-foreground transition-colors hover:text-foreground peer-checked:border-border peer-checked:bg-card peer-checked:text-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-ring">
                      {option.label}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          </PopoverContent>
        </Popover>
        <Input
          id={id}
          value={value}
          placeholder="输入图标 URL，或从图标库选择"
          onChange={(event) => onChange(event.target.value)}
        />
        <IconPicker value={value} onChange={onChange} />
      </div>
    </div>
  )
}
