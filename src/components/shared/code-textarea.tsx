import { lazy, Suspense } from 'react'
import type { ComponentProps } from 'react'
import { ClientOnly } from '@tanstack/react-router'
import { Textarea } from '#/components/ui/textarea'
import { cn } from '#/lib/utils'

export type CodeLanguage = 'auto' | 'json' | 'yaml' | 'javascript' | 'text'

export type CodeTextareaProps = Pick<
  ComponentProps<typeof Textarea>,
  | 'id'
  | 'className'
  | 'placeholder'
  | 'readOnly'
  | 'disabled'
  | 'aria-label'
  | 'aria-describedby'
  | 'aria-invalid'
  | 'aria-labelledby'
> & {
  value?: string
  onChange?: (value: string) => void
  language?: CodeLanguage
  'data-validation-input'?: boolean
}

const CodeEditor = lazy(() => import('./code-editor'))

/** 大段内容统一使用代码编辑器；服务端与加载阶段保留可编辑的回退输入。 */
export function CodeTextarea(props: CodeTextareaProps) {
  const { language: _language, onChange, className, ...fallbackProps } = props
  const fallback = (
    <Textarea
      {...fallbackProps}
      spellCheck={false}
      className={cn(
        'min-h-48 font-mono text-xs leading-relaxed field-sizing-normal',
        className,
      )}
      onChange={(event) => onChange?.(event.target.value)}
    />
  )
  return (
    <ClientOnly fallback={fallback}>
      <Suspense fallback={fallback}>
        <CodeEditor {...props} />
      </Suspense>
    </ClientOnly>
  )
}
