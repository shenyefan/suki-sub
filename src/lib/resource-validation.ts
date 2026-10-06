import { useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  validateResource,
  validationIssuesFromError,
  issueLabel,
} from '#/shared/resource-validation'
import type { ValidationIssue } from '#/shared/resource-validation'

export function uniqueValidationIssues(issues: ValidationIssue[]) {
  const seen = new Set<string>()
  return issues.filter((issue) => {
    const key = JSON.stringify([
      issue.resourceKind,
      issue.resourceName,
      issue.field,
      issue.operatorIndex,
      issue.message,
    ])
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function useResourceValidation(
  kind: 'sub' | 'collection',
  draft: Record<string, unknown>,
) {
  const key = JSON.stringify(draft)
  const [failure, setFailure] = useState<{
    key: string
    issues: ValidationIssue[]
  } | null>(null)
  const navigation = useRef(0)
  const latestKey = useRef(key)
  latestKey.current = key
  const issues = failure?.key === key ? failure.issues : []
  const show = (found: ValidationIssue[]) => {
    if (latestKey.current !== key) return
    const unique = uniqueValidationIssues(found)
    setFailure({ key, issues: unique })
    const generation = ++navigation.current
    const first = unique.at(0)
    if (!first) return
    toast.error('请修正后再试', {
      description: issueLabel(first),
      id: 'resource-validation',
    })
    const ownResource =
      first.resourceKind === kind &&
      first.resourceName === String(draft.name || '未命名')
    const operatorIndex = ownResource ? first.operatorIndex : undefined
    // Wait for the folded form and closing preview dialog to commit.
    const reveal = (attempt = 0) => {
      if (navigation.current !== generation || latestKey.current !== key) return
      const section =
        operatorIndex != null
          ? document.querySelector<HTMLElement>(
              `[data-validation-operator="${operatorIndex}"]`,
            )
          : null
      const field = ownResource ? first.field : 'subscriptions'
      const target =
        section?.querySelector<HTMLElement>('[data-validation-input]') ??
        section?.querySelector<HTMLElement>(
          '[data-validation-content] textarea, [data-validation-content] input, [data-validation-content] [role="combobox"]',
        ) ??
        section ??
        document.getElementById(
          kind === 'sub'
            ? `sub-${field === 'url' ? 'url' : field === 'content' ? 'content' : 'name'}`
            : field === 'name'
              ? 'col-name'
              : 'col-members',
        )
      if (attempt < 4 || !target || !target.getClientRects().length) {
        if (attempt < 12) requestAnimationFrame(() => reveal(attempt + 1))
        return
      }
      target.scrollIntoView({
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 'instant'
          : 'smooth',
        block: 'center',
      })
      target.focus({ preventScroll: true })
    }
    requestAnimationFrame(() => reveal())
  }
  const validate = () => {
    const found = validateResource(kind, draft)
    show(found)
    return found.length === 0
  }
  const report = (error?: unknown) => {
    if (!error) {
      show([])
      return
    }
    const found = validationIssuesFromError(error)
    show(
      found.length
        ? found
        : [
            {
              resourceKind: kind,
              resourceName: String(draft.name || '未命名'),
              field:
                typeof error === 'object' &&
                'code' in error &&
                [
                  'DUPLICATE_KEY',
                  'INVALID_NAME',
                  'CLONE_NAME_EXHAUSTED',
                ].includes(String(error.code))
                  ? 'name'
                  : kind === 'sub'
                    ? 'url'
                    : 'subscriptions',
              message: error instanceof Error ? error.message : String(error),
            },
          ],
    )
  }
  return { issues, report, validate }
}
