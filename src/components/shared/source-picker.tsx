import { useId } from 'react'
import { FileText, Globe } from 'lucide-react'

/** Native radios provide arrow-key navigation without adding a second tab panel. */
export function SourcePicker({
  value,
  onChange,
  disabled = false,
}: {
  value: 'remote' | 'local'
  onChange: (value: 'remote' | 'local') => void
  disabled?: boolean
}) {
  const name = useId()
  return (
    <fieldset
      disabled={disabled}
      className="flex min-w-0 rounded-md border bg-muted/40 p-1 disabled:opacity-60"
    >
      <legend className="sr-only">来源类型</legend>
      {(
        [
          { value: 'remote', label: '远程链接', icon: Globe },
          { value: 'local', label: '本地内容', icon: FileText },
        ] as const
      ).map((option) => (
        <label key={option.value} className="relative flex-1">
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
            className="peer sr-only"
          />
          <span className="flex min-h-9 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-sm border border-transparent px-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground peer-checked:border-border peer-checked:bg-card peer-checked:text-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-disabled:cursor-not-allowed motion-reduce:transition-none">
            <option.icon className="size-4" aria-hidden />
            {option.label}
          </span>
        </label>
      ))}
    </fieldset>
  )
}
