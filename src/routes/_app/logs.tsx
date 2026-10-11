import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  ChevronDown,
  RefreshCw,
  ListFilter,
  ScrollText,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'

import { ApiRoutes } from '#/shared/api-contract'
import { api } from '#/lib/api'
import { filterLogs, logOutcome, LOG_ACTION_LABELS } from '#/shared/logs'
import type { LogEntry, LogFilters } from '#/shared/logs'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { qk, useLogs } from '#/lib/queries'
import { formatDateTime } from '#/lib/format'
import { PageHeader } from '#/components/shared/page-header'
import { EmptyState } from '#/components/shared/empty-state'
import { ConfirmDialog } from '#/components/shared/confirm-dialog'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { Skeleton } from '#/components/ui/skeleton'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '#/components/ui/collapsible'
import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_app/logs')({
  component: LogsPage,
})

const LEVEL_VARIANT: Record<
  string,
  'default' | 'secondary' | 'destructive' | 'warning'
> = {
  error: 'destructive',
  warn: 'warning',
  info: 'secondary',
  log: 'secondary',
}

const EMPTY_FILTERS: LogFilters = {
  action: 'all',
  userId: '',
  requestId: '',
  outcome: 'all',
}
const ACTION_LABELS = LOG_ACTION_LABELS

function LogsPage() {
  const logs = useLogs()
  const client = useQueryClient()
  const [clearOpen, setClearOpen] = useState(false)
  const [draft, setDraft] = useState<LogFilters>(EMPTY_FILTERS)
  const [filters, setFilters] = useState<LogFilters>(EMPTY_FILTERS)
  const entries = logs.data ?? []
  const filtered = filterLogs(entries, filters)
  const actions = Array.from(
    new Set([
      ...Object.keys(ACTION_LABELS),
      ...entries.map((entry) =>
        String(entry.details?.action ?? 'processing.warning'),
      ),
    ]),
  )
  const setField = (key: keyof LogFilters, value: string) =>
    setDraft((current) => ({ ...current, [key]: value }))

  const clear = useMutation({
    mutationFn: () => api.del(ApiRoutes.logs),
    onSuccess: async () => {
      await client.cancelQueries({ queryKey: qk.logs })
      client.setQueryData(qk.logs, [])
      toast.success('已清空')
      setClearOpen(false)
      void client.invalidateQueries({ queryKey: qk.logs })
    },
    onError: (err) => toast.error(`清空失败:${err.message}`),
  })

  return (
    <div className="page-container">
      <PageHeader
        eyebrow="LOGS"
        title="日志"
        description="查看关键操作与异常记录。"
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              loading={logs.isFetching}
              onClick={() =>
                void client.invalidateQueries({ queryKey: qk.logs })
              }
            >
              <RefreshCw aria-hidden />
              刷新
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => setClearOpen(true)}
            >
              <Trash2 aria-hidden />
              清空
            </Button>
          </>
        }
      />

      <form
        className="mb-6 grid items-start gap-4 sm:grid-cols-2 lg:grid-cols-[repeat(4,minmax(0,1fr))_auto]"
        onSubmit={(event) => {
          event.preventDefault()
          setFilters({ ...draft })
        }}
      >
        <div className="grid min-w-0 grid-rows-[1rem_2.25rem] gap-2">
          <Label htmlFor="log-action">事件类型</Label>
          <Select
            value={draft.action}
            onValueChange={(value) => setField('action', value)}
          >
            <SelectTrigger id="log-action" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部</SelectItem>
              {actions.map((action) => (
                <SelectItem key={action} value={action}>
                  {ACTION_LABELS[action] ?? action}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid min-w-0 grid-rows-[1rem_2.25rem] gap-2">
          <Label htmlFor="log-user">操作者</Label>
          <Input
            id="log-user"
            placeholder="显示名称或 ID"
            value={draft.userId}
            onChange={(event) => setField('userId', event.target.value)}
          />
        </div>
        <div className="grid min-w-0 grid-rows-[1rem_2.25rem] gap-2">
          <Label htmlFor="log-request">请求 ID</Label>
          <Input
            id="log-request"
            value={draft.requestId}
            onChange={(event) => setField('requestId', event.target.value)}
          />
        </div>
        <div className="grid min-w-0 grid-rows-[1rem_2.25rem] gap-2">
          <Label htmlFor="log-outcome">操作结果</Label>
          <Select
            value={draft.outcome}
            onValueChange={(value) => setField('outcome', value)}
          >
            <SelectTrigger id="log-outcome" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部</SelectItem>
              <SelectItem value="success">成功</SelectItem>
              <SelectItem value="failure">失败</SelectItem>
              <SelectItem value="warning">提醒</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid min-w-0 grid-rows-[1rem_2.25rem] gap-2">
          <Label className="invisible" aria-hidden>
            筛选
          </Label>
          <div className="flex h-9 items-center gap-2">
            <Button type="submit">
              <ListFilter aria-hidden />
              筛选
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setDraft(EMPTY_FILTERS)
                setFilters(EMPTY_FILTERS)
              }}
            >
              重置
            </Button>
          </div>
        </div>
      </form>

      {logs.isLoading ? (
        <div className="grid gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      ) : logs.isError ? (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
        >
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
          日志加载失败：{logs.error.message}
        </div>
      ) : !logs.data?.length ? (
        <EmptyState icon={ScrollText} title="暂无日志" />
      ) : !filtered.length ? (
        <EmptyState
          icon={ScrollText}
          title="没有符合筛选条件的日志"
          description="调整条件或点击重置查看全部日志。"
        />
      ) : (
        <div className="overflow-hidden rounded-lg border bg-card">
          <div className="divide-y">
            {filtered.map((entry) => (
              <LogRow key={entry.id} entry={entry} />
            ))}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={clearOpen}
        onOpenChange={setClearOpen}
        title="清空日志"
        description="清空当前日志记录。"
        confirmText="清空"
        loading={clear.isPending}
        onConfirm={() => clear.mutate()}
      />
    </div>
  )
}

const DETAIL_LABELS: Record<string, string> = {
  repeatCount: '发生次数',
  firstTime: '首次发生',
  lastTime: '最近发生',
  relatedRequests: '相关请求',
  processingDetails: '处理详情',
  targetResourceName: '目标订阅',
  targetResourceKind: '目标类型',
  targetDisplayName: '目标显示名称',
  target: '通知目标序号',
  sent: '已发送数量',
  total: '通知目标数量',
  retryAfter: '重试等待秒数',
  userId: '用户标识',
  userName: '操作用户',
  userEmail: '用户邮箱',
  ip: 'IP 地址',
  clientUserAgent: '客户端',
  deviceType: '设备类型',
  requestHost: '访问域名',
  auditRequestId: '操作请求编号',
  resourceDisplayName: '显示名称',
  order: '排序结果',
  method: '请求方法',
  path: '请求路径',
  country: '国家或地区',
  region: '地区',
  city: '城市',
  colo: '接入节点',
  asn: 'ASN',
  asOrganization: '网络运营商',
  cfRay: '请求追踪',
  resourceName: '资源名称',
  resourceKind: '资源类型',
  type: '绑定类型',
  nodeCount: '节点数量',
  subscription: '订阅',
  collection: '组合订阅',
  platform: '输出平台',
  code: '错误代码',
  status: '上游状态码',
  httpStatus: '响应状态码',
  url: '来源链接',
  source: '来源',
  userAgent: '请求 UA',
  reason: '原因',
  requestId: '请求编号',
  durationMs: '耗时',
  field: '出错位置',
  operatorName: '操作',
  operatorIndex: '操作序号',
  sourceLine: '来源行',
  configLine: '配置行',
  scriptLine: '脚本行',
  scriptColumn: '脚本列',
  parser: '解析格式',
  invalidLines: '无法解析的行',
  failures: '失败来源',
  issues: '配置问题',
  replaced: '条目数量',
  count: '可用次数',
  endAt: '有效期',
  schedule: '执行计划',
}
const REQUEST_DETAIL_KEYS = new Set([
  'clientUserAgent',
  'deviceType',
  'requestHost',
  'auditRequestId',
  'method',
  'path',
  'country',
  'region',
  'city',
  'colo',
  'asn',
  'asOrganization',
  'cfRay',
  'userAgent',
  'requestId',
  'durationMs',
  'relatedRequests',
])
const RESOURCE_LABELS: Record<string, string> = {
  sub: '单条订阅',
  collection: '组合订阅',
  module: '脚本模块',
  share: '分享',
}

function LogRow({ entry }: { entry: LogEntry }) {
  const failed = logOutcome(entry) === 'failure'
  const resource =
    entry.details?.targetDisplayName ||
    entry.details?.resourceDisplayName ||
    entry.details?.collection ||
    entry.details?.subscription ||
    entry.details?.resourceName
  return (
    <Collapsible>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="group grid w-full grid-cols-[minmax(0,1fr)_3rem_1rem] items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset md:grid-cols-[minmax(0,1fr)_3rem_8.5rem_1rem] md:gap-x-2"
          aria-label={`查看日志详情：${entry.message}`}
        >
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{entry.message}</p>
            <div className="mt-1 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
              {resource != null && (
                <span className="min-w-0 truncate">{String(resource)}</span>
              )}
              {entry.details?.userName != null && (
                <span className="min-w-0 truncate">
                  {resource != null ? '· ' : ''}
                  {String(entry.details.userName)}
                </span>
              )}
              <time className="shrink-0 md:hidden" dateTime={entry.time}>
                {formatDateTime(entry.time)}
              </time>
            </div>
          </div>
          <Badge
            className="w-full justify-center"
            variant={
              failed
                ? 'destructive'
                : (LEVEL_VARIANT[entry.level] ?? 'secondary')
            }
          >
            {failed ? '失败' : entry.level === 'warn' ? '提醒' : '成功'}
          </Badge>
          <time
            className="hidden text-xs text-muted-foreground tabular-nums md:block"
            dateTime={entry.time}
          >
            {formatDateTime(entry.time)}
          </time>
          <ChevronDown
            className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180"
            aria-hidden
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="data-[state=open]:animate-in data-[state=open]:fade-in-0 duration-150">
        <div className="border-t bg-muted/20 px-4 py-4">
          <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
            <LogDetail label="发生时间" value={formatDateTime(entry.time)} />
            {(entry.message.length > 160 || entry.message.includes('\n')) && (
              <LogDetail label="完整信息" value={entry.message} wide />
            )}
            {Object.entries(entry.details ?? {})
              .filter(
                ([key, value]) =>
                  key !== 'action' &&
                  key !== 'aggregationKey' &&
                  !REQUEST_DETAIL_KEYS.has(key) &&
                  value != null &&
                  !(
                    key === 'resourceName' &&
                    (entry.details?.subscription || entry.details?.collection)
                  ),
              )
              .sort(
                ([keyA, valueA], [keyB, valueB]) =>
                  Number(isWideDetail(keyA, valueA)) -
                  Number(isWideDetail(keyB, valueB)),
              )
              .map(([key, value]) => (
                <LogDetail
                  key={key}
                  label={DETAIL_LABELS[key] ?? key}
                  value={detailValue(key, value)}
                  wide={isWideDetail(key, value)}
                />
              ))}
          </dl>
          {Object.entries(entry.details ?? {}).some(
            ([key, value]) => REQUEST_DETAIL_KEYS.has(key) && value != null,
          ) && (
            <details className="mt-4 border-t pt-3">
              <summary className="cursor-pointer text-xs text-muted-foreground">
                请求详情
              </summary>
              <dl className="mt-4 grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
                {Object.entries(entry.details ?? {})
                  .filter(
                    ([key, value]) =>
                      REQUEST_DETAIL_KEYS.has(key) && value != null,
                  )
                  .map(([key, value]) => (
                    <LogDetail
                      key={key}
                      label={DETAIL_LABELS[key] ?? key}
                      value={detailValue(key, value)}
                      wide={isWideDetail(key, value)}
                    />
                  ))}
              </dl>
            </details>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

function isWideDetail(key: string, value: unknown): boolean {
  return (
    Array.isArray(value) ||
    (value != null && typeof value === 'object') ||
    ['reason', 'url', 'source'].includes(key)
  )
}

function detailValue(key: string, value: unknown): unknown {
  if (key === 'field') {
    const fields: Record<string, string> = {
      name: '名称',
      url: '订阅链接',
      content: '本地内容',
      subscriptions: '成员订阅',
      process: '节点操作',
    }
    return /^process\.\d+$/.test(String(value))
      ? `第 ${Number(String(value).split('.')[1]) + 1} 个操作`
      : (fields[String(value)] ?? value)
  }
  if (key === 'resourceKind' || key === 'targetResourceKind' || key === 'type')
    return RESOURCE_LABELS[String(value)] ?? value
  if (key === 'durationMs') return `${value} ms`
  if (key === 'operatorIndex' && typeof value === 'number') return value + 1
  if (key === 'endAt' && typeof value === 'number') return formatDateTime(value)
  return value
}

function LogDetail({
  label,
  value,
  wide = false,
}: {
  label: string
  value: unknown
  wide?: boolean
}) {
  const structured = value != null && typeof value === 'object'
  return (
    <div
      className={`min-w-0 space-y-1 ${wide ? 'sm:col-span-2 lg:col-span-3' : ''}`}
    >
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm break-words [overflow-wrap:anywhere]">
        {structured ? (
          <pre className="max-h-64 overflow-auto rounded-md border bg-background p-3 font-mono text-xs whitespace-pre-wrap">
            {JSON.stringify(value, null, 2)}
          </pre>
        ) : (
          String(value ?? '—')
        )}
      </dd>
    </div>
  )
}
