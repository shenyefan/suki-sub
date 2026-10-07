import {
  OperatorValidationContext,
  useOperatorIssues,
  ValidationHint,
} from '#/components/shared/validation-hint'
import type { ValidationIssue } from '#/shared/resource-validation'
/**
 * 各操作符的参数编辑表单。onChange 回传新的 args(形状见 registry 注释)。
 */
import { useEffect, useId, useState } from 'react'
import { normalizeOperatorArgs } from './model'
import { parseScriptLink, buildScriptLink } from './script-params'
import { Plus, Trash2 } from 'lucide-react'

import { OPERATORS, PROXY_TYPES, REGIONS, REGION_FLAGS } from './registry'
import type { ProcessItem } from './registry'
import { CodeTextarea } from '#/components/shared/code-textarea'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { SwitchField } from '#/components/shared/switch-field'
import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'

type OnChange = (args: unknown) => void

function Row({
  label,
  htmlFor,
  children,
}: {
  label: string
  htmlFor?: string
  children: React.ReactNode
}) {
  return (
    <div className="grid min-w-0 content-start gap-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  )
}

/** 三态选择:默认 / 开启 / 关闭(Quick Setting 专用) */
const TRI_STATES = [
  { value: 'DEFAULT', label: '默认' },
  { value: 'ENABLED', label: '开启' },
  { value: 'DISABLED', label: '关闭' },
] as const

function QuickSettingForm({
  args,
  onChange,
}: {
  args: Record<string, unknown>
  onChange: OnChange
}) {
  const prefix = useId()
  const fields: { key: string; label: string }[] = [
    { key: 'useless', label: '过滤无用节点' },
    { key: 'udp', label: 'UDP' },
    { key: 'tfo', label: 'TCP Fast Open' },
    { key: 'scert', label: '跳过证书验证' },
    { key: 'vmess aead', label: 'VMess AEAD' },
    { key: 'reuse', label: '连接复用' },
    { key: 'ecn', label: 'ECN' },
  ]
  return (
    <div className="grid items-start gap-x-4 gap-y-4 @md:grid-cols-2">
      {fields.map((f) => (
        <Row key={f.key} label={f.label} htmlFor={`${prefix}-qs-${f.key}`}>
          <Select
            value={(args[f.key] as string | undefined) ?? 'DEFAULT'}
            onValueChange={(v) =>
              onChange({ ...args, [f.key]: v === 'DEFAULT' ? undefined : v })
            }
          >
            <SelectTrigger id={`${prefix}-qs-${f.key}`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TRI_STATES.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
      ))}
      {[
        {
          key: 'block-quic',
          label: '阻止 QUIC',
          options: [
            ['DEFAULT', '保持原值'],
            ['auto', '自动'],
            ['on', '开启'],
            ['off', '关闭'],
          ],
        },
        {
          key: 'ip-version',
          label: 'IP 版本',
          options: [
            ['DEFAULT', '保持原值'],
            ['dual', '双栈'],
            ['v4-only', '仅 IPv4'],
            ['v6-only', '仅 IPv6'],
            ['prefer-v4', '优先 IPv4'],
            ['prefer-v6', '优先 IPv6'],
          ],
        },
      ].map((field) => (
        <Row
          key={field.key}
          label={field.label}
          htmlFor={`${prefix}-${field.key}`}
        >
          <Select
            value={String(args[field.key] || 'DEFAULT')}
            onValueChange={(value) => onChange({ ...args, [field.key]: value })}
          >
            <SelectTrigger id={`${prefix}-${field.key}`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {field.options.map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
      ))}
    </div>
  )
}

function FlagForm({
  args,
  onChange,
}: {
  args: { mode?: string; tw?: string }
  onChange: OnChange
}) {
  const prefix = useId()
  return (
    <div className="grid items-start gap-x-4 gap-y-4 @md:grid-cols-2">
      <Row label="工作模式" htmlFor={`${prefix}-flag-mode`}>
        <Select
          value={args.mode ?? 'add'}
          onValueChange={(v) => onChange({ ...args, mode: v })}
        >
          <SelectTrigger id={`${prefix}-flag-mode`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="add">添加</SelectItem>
            <SelectItem value="remove">移除</SelectItem>
          </SelectContent>
        </Select>
      </Row>
      {args.mode !== 'remove' && (
        <Row label="台湾旗帜" htmlFor={`${prefix}-flag-tw`}>
          <Select
            value={args.tw ?? 'cn'}
            onValueChange={(v) => onChange({ ...args, tw: v })}
          >
            <SelectTrigger id={`${prefix}-flag-tw`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="tw">保持不变</SelectItem>
              <SelectItem value="ws">替换为 🇼🇸</SelectItem>
              <SelectItem value="cn">替换为 🇨🇳</SelectItem>
            </SelectContent>
          </Select>
        </Row>
      )}
    </div>
  )
}

function SortForm({ args, onChange }: { args?: string; onChange: OnChange }) {
  const prefix = useId()
  return (
    <Row label="顺序" htmlFor={`${prefix}-sort-order`}>
      <Select value={args ?? 'asc'} onValueChange={onChange}>
        <SelectTrigger id={`${prefix}-sort-order`} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="asc">正序</SelectItem>
          <SelectItem value="desc">逆序</SelectItem>
          <SelectItem value="random">随机</SelectItem>
        </SelectContent>
      </Select>
    </Row>
  )
}

function LinesField({
  value,
  onChange,
  placeholder,
  id,
  label,
}: {
  value: string[]
  onChange: (lines: string[]) => void
  placeholder?: string
  id: string
  label: string
}) {
  const serialized = value.join('\n')
  const [text, setText] = useState(serialized)
  useEffect(() => {
    setText((current) =>
      current
        .split('\n')
        .filter((line) => line.trim())
        .join('\n') === serialized
        ? current
        : serialized,
    )
  }, [serialized])
  return (
    <Row label={label} htmlFor={id}>
      <CodeTextarea
        id={id}
        language="text"
        value={text}
        placeholder={placeholder ?? '每行输入一个正则表达式'}
        onChange={(nextValue) => {
          setText(nextValue)
          onChange(nextValue.split('\n').filter((line) => line.trim()))
        }}
      />
    </Row>
  )
}

function RegexSortForm({
  args,
  onChange,
}: {
  args: { expressions?: string[]; order?: string }
  onChange: OnChange
}) {
  const prefix = useId()
  return (
    <div className="grid gap-4">
      <LinesField
        id={`${prefix}-regexsort-expr`}
        label="正则表达式(每行一个,按顺序优先)"
        value={args.expressions ?? []}
        placeholder={'每行一个，按顺序优先匹配\n香港\nHK'}
        onChange={(lines) => onChange({ ...args, expressions: lines })}
      />
      <Row label="未匹配节点排序" htmlFor={`${prefix}-regexsort-order`}>
        <Select
          value={args.order ?? 'asc'}
          onValueChange={(v) => onChange({ ...args, order: v })}
        >
          <SelectTrigger id={`${prefix}-regexsort-order`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="asc">正序</SelectItem>
            <SelectItem value="desc">逆序</SelectItem>
            <SelectItem value="original">不变</SelectItem>
          </SelectContent>
        </Select>
      </Row>
    </div>
  )
}

function RegexRenameForm({
  args,
  onChange,
}: {
  args: { expr: string; now: string }[]
  onChange: OnChange
}) {
  const prefix = useId()
  const items = Array.isArray(args) ? args : []
  return (
    <div className="grid gap-4">
      {items.map((pair, i) => (
        <div
          key={i}
          className="relative grid items-end gap-3 rounded-md border p-3 @md:grid-cols-[1fr_1fr_auto]"
        >
          <div className="grid min-w-0 gap-2">
            <Label
              className="pr-10 sm:pr-0"
              htmlFor={`${prefix}-rename-expr-${i}`}
            >
              正则 #{i + 1}
            </Label>
            <Input
              id={`${prefix}-rename-expr-${i}`}
              value={pair.expr}
              onChange={(e) => {
                const next = [...items]
                next[i] = { ...pair, expr: e.target.value }
                onChange(next)
              }}
            />
          </div>
          <div className="grid min-w-0 gap-2">
            <Label htmlFor={`${prefix}-rename-now-${i}`}>替换为</Label>
            <Input
              id={`${prefix}-rename-now-${i}`}
              value={pair.now}
              onChange={(e) => {
                const next = [...items]
                next[i] = { ...pair, now: e.target.value }
                onChange(next)
              }}
            />
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            className="absolute right-2 top-2 text-muted-foreground hover:text-destructive sm:static"
            aria-label={`删除规则 ${i + 1}`}
            onClick={() => onChange(items.filter((_, j) => j !== i))}
          >
            <Trash2 />
          </Button>
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        onClick={() => onChange([...items, { expr: '', now: '' }])}
      >
        <Plus aria-hidden />
        添加规则
      </Button>
    </div>
  )
}

function RegexDeleteForm({
  args,
  onChange,
}: {
  args: string[]
  onChange: OnChange
}) {
  const prefix = useId()
  return (
    <LinesField
      id={`${prefix}-regexdelete`}
      label="正则表达式(每行一个)"
      value={Array.isArray(args) ? args : []}
      onChange={onChange}
    />
  )
}

function HandleDuplicateForm({
  args,
  onChange,
}: {
  args: {
    action?: string
    template?: string
    link?: string
    position?: string
    field?: string[]
  }
  onChange: OnChange
}) {
  const prefix = useId()
  const [fieldText, setFieldText] = useState(
    (args.field ?? ['name']).join(', '),
  )
  return (
    <div className="grid items-start gap-x-4 gap-y-4 @md:grid-cols-2">
      <Row label="操作" htmlFor={`${prefix}-hd-action`}>
        <Select
          value={args.action ?? 'rename'}
          onValueChange={(v) => onChange({ ...args, action: v })}
        >
          <SelectTrigger id={`${prefix}-hd-action`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="rename">重命名</SelectItem>
            <SelectItem value="delete">删除</SelectItem>
          </SelectContent>
        </Select>
      </Row>
      <Row label="去重字段" htmlFor={`${prefix}-hd-field`}>
        <Input
          id={`${prefix}-hd-field`}
          value={fieldText}
          onChange={(e) => {
            setFieldText(e.target.value)
            onChange({
              ...args,
              field: e.target.value
                .split(/[,，]/)
                .map((value) => value.trim())
                .filter(Boolean),
            })
          }}
          placeholder="支持 lodash get 语法，多个字段用逗号分隔"
        />
      </Row>
      {args.action !== 'delete' && (
        <>
          <Row label="序号位置" htmlFor={`${prefix}-hd-position`}>
            <Select
              value={args.position ?? 'back'}
              onValueChange={(v) => onChange({ ...args, position: v })}
            >
              <SelectTrigger id={`${prefix}-hd-position`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="back">后缀</SelectItem>
                <SelectItem value="front">前缀</SelectItem>
              </SelectContent>
            </Select>
          </Row>
          <Row label="序号格式" htmlFor={`${prefix}-hd-template`}>
            <Input
              id={`${prefix}-hd-template`}
              value={args.template ?? ''}
              onChange={(e) => onChange({ ...args, template: e.target.value })}
              placeholder="用空格分隔，如：1 2 3 4 5 6 7 8 9"
            />
          </Row>
          <Row label="连接符" htmlFor={`${prefix}-hd-link`}>
            <Input
              id={`${prefix}-hd-link`}
              value={args.link ?? '-'}
              onChange={(e) => onChange({ ...args, link: e.target.value })}
            />
          </Row>
        </>
      )}
    </div>
  )
}

function ScriptForm({
  args,
  onChange,
  functionName,
}: {
  args: { mode?: string; content?: string; arguments?: Record<string, unknown> }
  onChange: OnChange
  functionName: string
}) {
  const prefix = useId()
  const issues = useOperatorIssues()
  const isLink = (args.mode ?? 'link') === 'link'
  const parsed = parseScriptLink(isLink ? (args.content ?? '') : '')
  const parameters = isLink ? parsed.arguments : (args.arguments ?? {})
  const [draftKey, setDraftKey] = useState('')
  const [draftValue, setDraftValue] = useState('')
  const [parameterError, setParameterError] = useState('')
  const updateParameters = (next: Record<string, unknown>) =>
    onChange({
      ...args,
      arguments: next,
      ...(isLink
        ? {
            content: buildScriptLink(
              parsed.url,
              next,
              parsed.noCache,
              parsed.insecure,
            ),
          }
        : {}),
    })
  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={`${prefix}-content`}>
          {isLink ? '脚本链接' : '脚本内容'}
        </Label>
        <Select
          value={isLink ? 'link' : 'script'}
          onValueChange={(mode) => onChange({ ...args, mode })}
        >
          <SelectTrigger
            id={`${prefix}-mode`}
            aria-label="脚本来源"
            className="h-8 w-32"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="link">远程链接</SelectItem>
            <SelectItem value="script">本地内容</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-1.5">
        {isLink ? (
          <Input
            id={`${prefix}-content`}
            data-validation-input
            aria-invalid={issues.length > 0}
            aria-describedby={`${prefix}-content-error`}
            className="font-mono text-xs"
            value={args.content ?? ''}
            placeholder="远程脚本 URL；#key=value 附加参数，#noCache 禁用缓存"
            onChange={(event) =>
              onChange({ ...args, content: event.target.value })
            }
          />
        ) : (
          <CodeTextarea
            id={`${prefix}-content`}
            data-validation-input
            aria-invalid={issues.length > 0}
            aria-describedby={`${prefix}-content-error`}
            language="javascript"
            value={args.content ?? ''}
            placeholder={`function ${functionName}(input) {\n  // 在这里编写脚本\n  return input\n}`}
            onChange={(value) => onChange({ ...args, content: value })}
          />
        )}
        <ValidationHint id={`${prefix}-content-error`} issues={issues} />
      </div>
      {isLink && (
        <div
          className={parsed.insecure ? 'grid gap-2 @md:grid-cols-2' : 'grid'}
        >
          <SwitchField
            label="关闭脚本缓存"
            checked={parsed.noCache}
            onCheckedChange={(value) =>
              onChange({
                ...args,
                content: buildScriptLink(
                  parsed.url,
                  parameters,
                  value,
                  parsed.insecure,
                ),
              })
            }
          />
          {parsed.insecure && (
            <SwitchField
              label="跳过 TLS 验证（当前环境不支持）"
              disabled={!parsed.insecure}
              checked={parsed.insecure}
              onCheckedChange={(value) =>
                onChange({
                  ...args,
                  content: buildScriptLink(
                    parsed.url,
                    parameters,
                    parsed.noCache,
                    value,
                  ),
                })
              }
            />
          )}
        </div>
      )}
      <details
        className="group"
        open={Object.keys(parameters).length > 0 || undefined}
      >
        <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
          脚本参数
          {Object.keys(parameters).length
            ? `（${Object.keys(parameters).length}）`
            : '（选填）'}
        </summary>
        <div className="mt-2 grid gap-2">
          {Object.entries(parameters).map(([key, value]) => (
            <div key={key} className="flex items-center gap-2">
              <span
                className="w-1/3 min-w-0 truncate font-mono text-xs"
                title={key}
              >
                {key}
              </span>
              <Input
                aria-label={`参数 ${key}`}
                value={
                  typeof value === 'string' ? value : JSON.stringify(value)
                }
                onChange={(event) =>
                  updateParameters({ ...parameters, [key]: event.target.value })
                }
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`删除参数 ${key}`}
                onClick={() => {
                  const next = { ...parameters }
                  delete next[key]
                  updateParameters(next)
                }}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
          <div className="grid gap-2 @md:grid-cols-[1fr_1fr_auto]">
            <Input
              aria-label="新参数名称"
              value={draftKey}
              placeholder="参数名称"
              onChange={(event) => {
                setDraftKey(event.target.value)
                setParameterError('')
              }}
            />
            <Input
              aria-label="新参数值"
              value={draftValue}
              placeholder="参数值，留空表示 true"
              onChange={(event) => setDraftValue(event.target.value)}
            />
            <Button
              type="button"
              variant="outline"
              disabled={!draftKey.trim()}
              onClick={() => {
                const key = draftKey.trim()
                if (Object.hasOwn(parameters, key)) {
                  setParameterError('参数名已存在，请直接编辑已有参数')
                  return
                }
                updateParameters({ ...parameters, [key]: draftValue || true })
                setDraftKey('')
                setDraftValue('')
              }}
            >
              <Plus aria-hidden />
              添加参数
            </Button>
          </div>
          {parameterError && (
            <div role="alert" className="text-sm text-destructive">
              {parameterError}
            </div>
          )}
        </div>
      </details>
    </div>
  )
}

function ResolveDomainForm({
  args,
  onChange,
}: {
  args: {
    provider?: string
    type?: string
    filter?: string
    cache?: string
    url?: string
    tlsSkipCertVerify?: boolean | string
    edns?: string
    concurrency?: number | string
    dnsConcurrency?: number | string
    timeout?: number
    cacheTtl?: number
  }
  onChange: OnChange
}) {
  const prefix = useId()
  const isCustom = (args.provider ?? 'Custom') === 'Custom'
  return (
    <div className="grid gap-4">
      <div className="grid gap-4 @md:grid-cols-2">
        <Row label="解析服务" htmlFor={`${prefix}-rd-provider`}>
          <Select
            value={args.provider ?? 'Custom'}
            onValueChange={(v) =>
              onChange({
                ...args,
                provider: v,
                type: v === 'IP-API' ? 'IPv4' : args.type,
              })
            }
          >
            <SelectTrigger id={`${prefix}-rd-provider`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[
                'Google',
                'IP-API',
                'Cloudflare',
                'Ali',
                'Tencent',
                'Custom',
              ].map((p) => (
                <SelectItem key={p} value={p}>
                  {p === 'Custom' ? '自定义' : p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
        <Row label="解析类型" htmlFor={`${prefix}-rd-type`}>
          <Select
            value={args.type ?? 'IPv4'}
            onValueChange={(v) => onChange({ ...args, type: v })}
          >
            <SelectTrigger id={`${prefix}-rd-type`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="IPv4">IPv4</SelectItem>
              <SelectItem value="IPv6" disabled={args.provider === 'IP-API'}>
                IPv6
              </SelectItem>
            </SelectContent>
          </Select>
        </Row>
      </div>
      {isCustom && (
        <div className="grid gap-3">
          <Row label="DNS 地址" htmlFor={`${prefix}-rd-url`}>
            <CodeTextarea
              id={`${prefix}-rd-url`}
              language="text"
              className="min-h-28"
              value={args.url ?? ''}
              onChange={(value) => onChange({ ...args, url: value })}
              placeholder="每行一个 DoH 地址，如 https://dns.google/dns-query"
            />
          </Row>
          <SwitchField
            id={`${prefix}-tls`}
            className="min-h-9 [&_label]:min-h-9"
            label="跳过 DNS TLS 证书验证"
            checked={
              args.tlsSkipCertVerify === true ||
              args.tlsSkipCertVerify === 'enabled'
            }
            onCheckedChange={(value) =>
              onChange({
                ...args,
                tlsSkipCertVerify: value ? 'enabled' : 'disabled',
              })
            }
          />
        </div>
      )}
      <div className="grid gap-4 border-t pt-4 @md:grid-cols-2">
        <Row label="结果过滤" htmlFor={`${prefix}-rd-filter`}>
          <Select
            value={args.filter || 'disabled'}
            onValueChange={(v) => onChange({ ...args, filter: v })}
          >
            <SelectTrigger id={`${prefix}-rd-filter`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="disabled">不过滤</SelectItem>
              <SelectItem value="removeFailed">移除失败</SelectItem>
              <SelectItem value="IPOnly">只保留 IP</SelectItem>
              <SelectItem value="IPv4Only">只保留 IPv4</SelectItem>
              <SelectItem value="IPv6Only">只保留 IPv6</SelectItem>
            </SelectContent>
          </Select>
        </Row>
        <Row label="EDNS 客户端 IP" htmlFor={`${prefix}-edns`}>
          <Input
            id={`${prefix}-edns`}
            value={args.edns ?? ''}
            placeholder="留空使用 223.6.6.6"
            onChange={(event) =>
              onChange({ ...args, edns: event.target.value })
            }
          />
        </Row>
        <Row label="节点解析并发" htmlFor={`${prefix}-concurrency`}>
          <Input
            id={`${prefix}-concurrency`}
            type="number"
            min={1}
            step={1}
            value={args.concurrency ?? ''}
            placeholder="留空使用默认并发"
            onChange={(event) =>
              onChange({
                ...args,
                concurrency: event.target.value || undefined,
              })
            }
          />
        </Row>
        {isCustom && (
          <Row
            label="每个节点的 DNS 并发"
            htmlFor={`${prefix}-dns-concurrency`}
          >
            <Input
              id={`${prefix}-dns-concurrency`}
              type="number"
              min={1}
              step={1}
              value={args.dnsConcurrency ?? ''}
              placeholder="多 DNS 地址时的并发数"
              onChange={(event) =>
                onChange({
                  ...args,
                  dnsConcurrency: event.target.value || undefined,
                })
              }
            />
          </Row>
        )}
        <Row label="超时（毫秒）" htmlFor={`${prefix}-rd-timeout`}>
          <Input
            id={`${prefix}-rd-timeout`}
            type="number"
            min={1}
            value={args.timeout ?? ''}
            onChange={(e) =>
              onChange({
                ...args,
                timeout: e.target.value ? Number(e.target.value) : undefined,
              })
            }
            placeholder="留空使用全局超时"
          />
        </Row>
      </div>
      <div className="grid gap-4 border-t pt-4">
        <SwitchField
          id={`${prefix}-rd-cache`}
          label="缓存解析结果"
          checked={args.cache !== 'disabled'}
          onCheckedChange={(enabled) =>
            onChange({ ...args, cache: enabled ? 'enabled' : 'disabled' })
          }
        />
        <div className="@md:max-w-[calc(50%-0.75rem)]">
          <Row label="缓存时长（秒）" htmlFor={`${prefix}-rd-cachettl`}>
            <Input
              id={`${prefix}-rd-cachettl`}
              type="number"
              min={1}
              disabled={args.cache === 'disabled'}
              value={args.cacheTtl ?? ''}
              onChange={(e) =>
                onChange({
                  ...args,
                  cacheTtl: e.target.value ? Number(e.target.value) : undefined,
                })
              }
              placeholder="留空使用全局缓存时长"
            />
          </Row>
        </div>
      </div>
    </div>
  )
}

function CheckGroup({
  options,
  selected,
  onToggle,
  render,
}: {
  options: readonly string[]
  selected: string[]
  onToggle: (value: string) => void
  render?: (value: string) => React.ReactNode
}) {
  return (
    <div className="grid grid-cols-2 gap-3 @md:grid-cols-3">
      {options.map((option) => (
        <label
          key={option}
          className="flex min-h-9 cursor-pointer items-center gap-2 text-sm"
        >
          <Checkbox
            checked={selected.includes(option)}
            onCheckedChange={() => onToggle(option)}
            aria-label={option}
          />
          {render ? render(option) : option}
        </label>
      ))}
    </div>
  )
}

function toggleValue(list: string[], value: string): string[] {
  return list.includes(value)
    ? list.filter((v) => v !== value)
    : [...list, value]
}

function RegionFilterForm({
  args,
  onChange,
}: {
  args: { value?: string[]; keep?: boolean }
  onChange: OnChange
}) {
  const prefix = useId()
  return (
    <div className="grid gap-4">
      <Row label="区域（按节点名旗帜匹配）">
        <CheckGroup
          options={REGIONS}
          selected={args.value ?? []}
          onToggle={(v) =>
            onChange({ ...args, value: toggleValue(args.value ?? [], v) })
          }
          render={(v) => `${REGION_FLAGS[v]} ${v}`}
        />
      </Row>
      <SwitchField
        label="保留模式(关闭则为过滤模式)"
        id={`${prefix}-region-keep`}
        checked={args.keep ?? true}
        onCheckedChange={(v) => onChange({ ...args, keep: v })}
      />
    </div>
  )
}

function TypeFilterForm({
  args,
  onChange,
}: {
  args: { value?: string[]; keep?: boolean }
  onChange: OnChange
}) {
  const prefix = useId()
  return (
    <div className="grid gap-4">
      <Row label="协议类型">
        <CheckGroup
          options={PROXY_TYPES}
          selected={args.value ?? []}
          onToggle={(v) =>
            onChange({ ...args, value: toggleValue(args.value ?? [], v) })
          }
        />
      </Row>
      <SwitchField
        label="保留模式(关闭则为过滤模式)"
        id={`${prefix}-type-keep`}
        checked={args.keep ?? true}
        onCheckedChange={(v) => onChange({ ...args, keep: v })}
      />
    </div>
  )
}

function RegexFilterForm({
  args,
  onChange,
}: {
  args: { regex?: string[]; keep?: boolean }
  onChange: OnChange
}) {
  const prefix = useId()
  return (
    <div className="grid gap-4">
      <LinesField
        id={`${prefix}-regexfilter`}
        label="正则表达式(每行一个)"
        value={args.regex ?? []}
        onChange={(lines) => onChange({ ...args, regex: lines })}
      />
      <SwitchField
        label="保留模式(关闭则为过滤模式)"
        id={`${prefix}-regex-keep`}
        checked={args.keep ?? true}
        onCheckedChange={(v) => onChange({ ...args, keep: v })}
      />
    </div>
  )
}

/** 按操作符类型渲染参数表单 */
function OperatorArgsForm({
  item,
  onChange,
}: {
  item: ProcessItem
  onChange: (args: unknown) => void
}) {
  const args = normalizeOperatorArgs(item.type, item.args) as never
  switch (item.type) {
    case 'Quick Setting Operator':
      return <QuickSettingForm args={args} onChange={onChange} />
    case 'Flag Operator':
      return <FlagForm args={args} onChange={onChange} />
    case 'Sort Operator':
      return (
        <SortForm args={item.args as string | undefined} onChange={onChange} />
      )
    case 'Regex Sort Operator':
      return <RegexSortForm args={args} onChange={onChange} />
    case 'Regex Rename Operator':
      return (
        <RegexRenameForm
          args={item.args as { expr: string; now: string }[]}
          onChange={onChange}
        />
      )
    case 'Regex Delete Operator':
      return (
        <RegexDeleteForm args={item.args as string[]} onChange={onChange} />
      )
    case 'Handle Duplicate Operator':
      return <HandleDuplicateForm args={args} onChange={onChange} />
    case 'Script Operator':
      return (
        <ScriptForm args={args} onChange={onChange} functionName="operator" />
      )
    case 'Script Filter':
      return (
        <ScriptForm args={args} onChange={onChange} functionName="filter" />
      )
    case 'Response Transformer':
      return (
        <ScriptForm
          args={args}
          onChange={onChange}
          functionName="transformFunction"
        />
      )
    case 'Resolve Domain Operator':
      return <ResolveDomainForm args={args} onChange={onChange} />
    case 'Region Filter':
      return <RegionFilterForm args={args} onChange={onChange} />
    case 'Type Filter':
      return <TypeFilterForm args={args} onChange={onChange} />
    case 'Regex Filter':
      return <RegexFilterForm args={args} onChange={onChange} />
    default: {
      const def = OPERATORS.find((o) => o.type === item.type)
      return (
        <p className="text-xs text-muted-foreground">
          {def ? def.description : '未知操作符,仅保留原始数据'}
        </p>
      )
    }
  }
}

export function OperatorArgsEditor({
  item,
  onChange,
  issues = [],
}: {
  item: ProcessItem
  onChange: OnChange
  issues?: ValidationIssue[]
}) {
  const script =
    item.type.includes('Script') || item.type === 'Response Transformer'
  return (
    <OperatorValidationContext.Provider value={issues}>
      <OperatorArgsForm item={item} onChange={onChange} />
      {!script && (
        <div className="mt-2">
          <ValidationHint issues={issues} />
        </div>
      )}
    </OperatorValidationContext.Provider>
  )
}
