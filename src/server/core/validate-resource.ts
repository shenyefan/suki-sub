import { parseResourceLink } from '#/shared/resource-link'
import { redactDiagnostic } from './utils/diagnostics'
import {
  validateResource,
  validationIssuesFromError,
  issueLabel,
} from '#/shared/resource-validation'
import type { ValidationIssue } from '#/shared/resource-validation'
import { BaseError, RequestInvalidError, errorFields } from './errors'
import type { Collection, Subscription } from '#/shared/types'
import { getEngineStore } from '../store/engine-store'

export function assertResourceValid(
  kind: 'sub' | 'collection',
  draft: unknown,
) {
  const issues = validateResource(kind, draft)
  if (
    kind === 'collection' &&
    draft &&
    typeof draft === 'object' &&
    'subscriptions' in draft &&
    Array.isArray(draft.subscriptions)
  ) {
    for (const [index, member] of draft.subscriptions.entries()) {
      if (
        typeof member === 'string' &&
        member.trim() &&
        !/^https?:/i.test(member)
      ) {
        const sub = getEngineStore().subs.find((item) => item.name === member)
        if (!sub)
          issues.push({
            resourceKind: kind,
            resourceName: String('name' in draft ? draft.name : '未命名'),
            field: 'subscriptions',
            sourceLine: index + 1,
            message: `第 ${index + 1} 个成员「${member}」不存在`,
          })
        else issues.push(...validateResource('sub', sub))
      }
    }
  }
  if (issues.length)
    throw new RequestInvalidError(
      'RESOURCE_VALIDATION_FAILED',
      issueLabel(issues[0]),
      { issues },
    )
}

export function contextualResourceError(
  error: unknown,
  kind: 'sub' | 'collection',
  draft: Subscription | Collection,
) {
  if (validationIssuesFromError(error).length) return error
  const fields = error instanceof BaseError ? errorFields(error) : {}
  const sources = Array.isArray(fields.failures)
    ? (fields.failures as Record<string, unknown>[])
    : error instanceof BaseError
      ? [{ ...fields, message: error.message }]
      : []
  const issues: ValidationIssue[] = sources.length
    ? sources.map((source, index) => {
        const positions = validationIssuesFromError(source)
        const existing = positions[0]
        if (positions.length) return { ...source, ...existing }
        const entries =
          kind === 'sub'
            ? String((draft as Subscription).url || '')
                .split(/[\r\n]+/)
                .map((line) => line.trim())
                .filter(Boolean)
            : (draft as Collection).subscriptions
        const line = entries.findIndex((value) => {
          const link = redactDiagnostic(parseResourceLink(String(value)).url)
          return (
            link === source.url ||
            value === source.source ||
            source.subscription === `订阅「${value}」`
          )
        })
        return {
          ...source,
          resourceKind: kind,
          resourceName: draft.name,
          field:
            kind === 'sub'
              ? (draft as Subscription).source === 'local'
                ? 'content'
                : 'url'
              : 'subscriptions',
          sourceLine: line >= 0 ? line + 1 : index + 1,
          message: String(source.message || '处理失败'),
        }
      })
    : [
        {
          resourceKind: kind,
          resourceName: draft.name,
          field:
            kind === 'sub'
              ? (draft as Subscription).source === 'local'
                ? 'content'
                : 'url'
              : 'subscriptions',
          message: error instanceof Error ? error.message : String(error),
        },
      ]
  if (error instanceof BaseError) {
    if (issues.length === 1) {
      const { message: _, ...position } = issues[0]
      Object.assign(error, position)
    } else {
      error.issues = issues
      delete error.failures
    }
    return error
  }
  return new RequestInvalidError(
    'RESOURCE_PROCESSING_FAILED',
    issueLabel(issues[0]),
    { issues },
  )
}

export async function validateForSave(
  kind: 'sub' | 'collection',
  draft: Subscription | Collection,
) {
  assertResourceValid(kind, draft)
  const { previewProcess } = await import('./preview-process')
  try {
    await previewProcess(kind, draft, true)
  } catch (error) {
    // 保存使用同一条错误链，保留上游原因、状态与字段定位。
    throw contextualResourceError(error, kind, draft)
  }
}
