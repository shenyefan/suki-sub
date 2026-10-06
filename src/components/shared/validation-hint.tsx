import { createContext, useContext } from 'react'
import { CircleAlert } from 'lucide-react'
import type { ValidationIssue } from '#/shared/resource-validation'

export const OperatorValidationContext = createContext<ValidationIssue[]>([])
export const useOperatorIssues = () => useContext(OperatorValidationContext)

export function ValidationHint({
  issues,
  id,
}: {
  issues: ValidationIssue[]
  id?: string
}) {
  const messages = [
    ...new Set(
      issues.map((issue) =>
        issue.message.replace(/^第 \d+ 个操作「[^」]+」：/, ''),
      ),
    ),
  ]
  if (!messages.length) return null
  return (
    <div
      id={id}
      className="flex items-start gap-1.5 text-xs leading-relaxed text-destructive"
      role="alert"
    >
      <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <div>
        {messages.map((message) => (
          <p key={message}>{message}</p>
        ))}
      </div>
    </div>
  )
}
