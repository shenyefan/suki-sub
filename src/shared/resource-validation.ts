import { parseResourceLink } from './resource-link'
import { OPERATORS, OPERATOR_LABELS } from '#/features/operators/registry'

export interface ValidationIssue {
  resourceKind: 'sub' | 'collection'
  resourceName: string
  field: string
  message: string
  operatorIndex?: number
  operatorId?: string
  operatorName?: string
  sourceLine?: number
}

export function validateResource(
  kind: 'sub' | 'collection',
  value: unknown,
): ValidationIssue[] {
  const draft =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  const resourceName =
    typeof draft.name === 'string' && draft.name.trim() ? draft.name : '未命名'
  const issues: ValidationIssue[] = []
  const add = (
    field: string,
    message: string,
    extra: Partial<ValidationIssue> = {},
  ) =>
    issues.push({ resourceKind: kind, resourceName, field, message, ...extra })
  if (
    typeof draft.name !== 'string' ||
    !draft.name.trim() ||
    resourceName.includes('/') ||
    resourceName === 'UNTITLED'
  )
    add('name', '名称不能为空、不能包含 /，且不能使用 UNTITLED')
  const validUrl = (linkValue: string) => {
    try {
      const url = new URL(parseResourceLink(linkValue).url)
      return ['http:', 'https:'].includes(url.protocol)
    } catch {
      return false
    }
  }
  if (kind === 'sub') {
    const local = draft.source === 'local'
    const merged = ['localFirst', 'remoteFirst'].includes(
      String(draft.mergeSources),
    )
    if (!local || merged) {
      const urls = typeof draft.url === 'string' ? draft.url.split(/\r?\n/) : []
      if (!urls.some((url) => url.trim())) add('url', '订阅来源链接不能为空')
      urls.forEach((url, index) => {
        if (url.trim() && !validUrl(url))
          add(
            'url',
            `第 ${index + 1} 行订阅链接无效，请填写完整的 HTTP 或 HTTPS 地址`,
            { sourceLine: index + 1 },
          )
      })
    }
    if (local && (typeof draft.content !== 'string' || !draft.content.trim()))
      add('content', '本地订阅内容不能为空')
  } else {
    if (!Array.isArray(draft.subscriptions) || !draft.subscriptions.length)
      add('subscriptions', '至少选择一个订阅或添加一个来源链接')
    if (Array.isArray(draft.subscriptions))
      draft.subscriptions.forEach((member, index) => {
        if (typeof member !== 'string' || !member.trim())
          add('subscriptions', `第 ${index + 1} 个成员不能为空`, {
            sourceLine: index + 1,
          })
        else if (/^(?:https?:|.*:\/\/)/i.test(member) && !validUrl(member))
          add('subscriptions', `第 ${index + 1} 个成员链接无效`, {
            sourceLine: index + 1,
          })
      })
  }
  if (draft.process != null && !Array.isArray(draft.process))
    add('process', '处理步骤必须是操作数组')
  if (Array.isArray(draft.process))
    draft.process.forEach((item: unknown, index) => {
      const operator =
        item && typeof item === 'object'
          ? (item as Record<string, unknown>)
          : {}
      if (operator.disabled === true) return
      const type = String(operator.type || '')
      const label = String(
        operator.customName || OPERATOR_LABELS[type] || type || '未知操作',
      )
      const fail = (message: string) =>
        add(`process.${index}`, message, {
          operatorIndex: index,
          operatorName: label,
          ...(typeof operator.id === 'string'
            ? { operatorId: operator.id }
            : {}),
        })
      if (!OPERATORS.some((op) => op.type === type)) {
        fail('不支持此操作类型')
        return
      }
      const args =
        operator.args && typeof operator.args === 'object'
          ? (operator.args as Record<string, unknown>)
          : {}
      if (type.includes('Script') || type === 'Response Transformer') {
        const content =
          typeof args.content === 'string' ? args.content.trim() : ''
        if (!content)
          fail(args.mode === 'link' ? '脚本链接不能为空' : '脚本内容不能为空')
        else if (
          args.mode === 'link' &&
          !validUrl(content) &&
          !/^\/api\/modules\/[^/#?]+(?:#.*)?$/.test(content)
        )
          fail('脚本链接无效，请填写 HTTP、HTTPS 或模块地址')
      }
      const expressions =
        type === 'Regex Rename Operator' && Array.isArray(operator.args)
          ? operator.args.map((arg) => arg?.expr)
          : type === 'Regex Delete Operator' && Array.isArray(operator.args)
            ? operator.args
            : type === 'Regex Filter'
              ? args.regex
              : type === 'Regex Sort Operator'
                ? args.expressions
                : []
      if (Array.isArray(expressions))
        expressions.forEach((expr, row) => {
          try {
            new RegExp(String(expr))
          } catch {
            fail(`第 ${row + 1} 条正则表达式无效`)
          }
        })
    })
  return issues
}

export function validationIssuesFromError(error: unknown): ValidationIssue[] {
  if (!error || typeof error !== 'object') return []
  if ('issues' in error && Array.isArray(error.issues))
    return error.issues as ValidationIssue[]
  if (
    'field' in error &&
    'resourceKind' in error &&
    'resourceName' in error &&
    'message' in error
  )
    return [
      {
        resourceKind: error.resourceKind as ValidationIssue['resourceKind'],
        resourceName: String(error.resourceName),
        field: String(error.field),
        message: String(error.message),
        ...Object.fromEntries(
          ['operatorIndex', 'operatorId', 'operatorName', 'sourceLine']
            .filter((key) => key in error)
            .map((key) => [key, (error as Record<string, unknown>)[key]]),
        ),
      },
    ]
  return []
}

export function issueLabel(issue: ValidationIssue): string {
  const resource = `${issue.resourceKind === 'sub' ? '订阅' : '组合'}「${issue.resourceName}」`
  const field = issue.field.startsWith('process.')
    ? `第 ${(issue.operatorIndex ?? Number(issue.field.split('.')[1])) + 1} 个操作${issue.operatorName ? `「${issue.operatorName}」` : ''}`
    : (
        {
          name: '名称',
          url: '来源链接',
          content: '本地内容',
          subscriptions: '成员订阅',
          process: '处理步骤',
        } as Record<string, string>
      )[issue.field] || issue.field
  return `${resource}${field ? ` · ${field}` : ''}：${issue.message}`
}
