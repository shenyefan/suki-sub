import { useEditorActions } from '#/components/shared/editor-layout'
import { EditorActions } from '#/components/shared/editor-actions'
import type { EditorAction } from '#/components/shared/editor-actions'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '#/components/ui/dropdown-menu'
import type { ValidationIssue } from '#/shared/resource-validation'
import { useId, useMemo, useState, useRef, useEffect } from 'react'
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Eye,
  Loader2,
  MoreHorizontal,
  ListFilter,
  Plus,
  Search,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { OPERATORS, OPERATOR_LABELS } from './registry'
import type { ProcessItem } from './registry'
import { importProcess, normalizeProcess } from './model'
import { OperatorArgsEditor } from './operator-forms'
import {
  SortableList,
  SortableRow,
  SortHandle,
} from '#/components/shared/sortable-list'
import { CodeTextarea } from '#/components/shared/code-textarea'
import { Button } from '#/components/ui/button'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '#/components/ui/tabs'
import { Input } from '#/components/ui/input'
import { Switch } from '#/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import { ApiRoutes } from '#/shared/api-contract'
import { api, copyToClipboard } from '#/lib/api'
import { cn } from '#/lib/utils'

function AddOperatorDialog({
  open,
  onOpenChange,
  onAdd,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onAdd: (types: string[]) => void
}) {
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('全部')
  const [selected, setSelected] = useState<string[]>([])
  const available = OPERATORS
  const results = available.filter(
    (operator) =>
      (category === '全部' || operator.category === category) &&
      `${operator.label} ${operator.type} ${operator.description}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
  )
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="p-6 pb-4">
          <DialogTitle>添加节点操作</DialogTitle>
          <DialogDescription>可多选，按选择顺序添加到末尾。</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 border-b px-6 pb-4">
          <div className="relative">
            <Search
              aria-hidden
              className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground"
            />
            <Input
              aria-label="搜索节点操作"
              placeholder="搜索名称或用途，如：重命名、过滤、脚本"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="pl-9"
            />
          </div>
          <div
            className="flex flex-wrap gap-1"
            role="group"
            aria-label="操作分类"
          >
            {['全部', '操作', '过滤', '响应'].map((value) => (
              <Button
                key={value}
                type="button"
                size="sm"
                variant={value === category ? 'secondary' : 'ghost'}
                aria-pressed={value === category}
                onClick={() => setCategory(value)}
              >
                {value}
              </Button>
            ))}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:px-6">
          {results.length ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {results.map((operator) => {
                const order = selected.indexOf(operator.type)
                return (
                  <button
                    key={operator.type}
                    type="button"
                    aria-pressed={order !== -1}
                    className="flex min-w-0 items-start gap-3 rounded-md border bg-card p-3 text-left transition-colors hover:border-muted-foreground/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none aria-pressed:border-foreground aria-pressed:bg-muted/40"
                    onClick={() =>
                      setSelected((current) =>
                        order === -1
                          ? [...current, operator.type]
                          : current.filter((value) => value !== operator.type),
                      )
                    }
                  >
                    <span className="grid min-w-0 flex-1 gap-1">
                      <span className="text-sm font-medium">
                        {operator.label}
                      </span>
                      <span className="text-xs leading-5 text-muted-foreground">
                        {operator.description}
                      </span>
                    </span>
                    <span
                      className={cn(
                        'flex size-5 shrink-0 items-center justify-center rounded-sm border text-xs',
                        order !== -1 &&
                          'border-primary bg-primary text-primary-foreground',
                      )}
                    >
                      {order !== -1 ? (
                        order + 1
                      ) : (
                        <Plus className="size-3" aria-hidden />
                      )}
                    </span>
                  </button>
                )
              })}
            </div>
          ) : (
            <div
              role="status"
              className="py-12 text-center text-sm text-muted-foreground"
            >
              没有匹配的操作，试试其他关键词
            </div>
          )}
        </div>
        <div className="flex items-center justify-between gap-3 border-t px-6 py-4">
          <span role="status" className="text-xs text-muted-foreground">
            已选择 {selected.length} 项
          </span>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              取消
            </Button>
            <Button
              type="button"
              disabled={!selected.length}
              onClick={() => {
                onAdd(selected)
                onOpenChange(false)
              }}
            >
              <Check aria-hidden />
              添加{selected.length > 0 ? ` ${selected.length} 项` : ''}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function PipelineEditor({
  items,
  onChange,
  preview,
  issues = [],
  onValidation,
  onValidate,
}: {
  issues?: ValidationIssue[]
  onValidation?: (error?: unknown) => void
  onValidate?: () => boolean
  preview?: {
    kind: 'sub' | 'collection'
    draft: Record<string, unknown>
  }
  items: ProcessItem[]
  onChange: (items: ProcessItem[]) => void
}) {
  const setEditorActions = useEditorActions()
  const prefix = useId()
  // IDs from older exports can be missing or duplicated. Persist repaired IDs on the next edit.
  const normalized = useMemo(() => normalizeProcess(items), [items])
  const latestItems = useRef(normalized)
  latestItems.current = normalized
  const previewFailed = useRef(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewBusy, setPreviewBusy] = useState(false)
  const [previewResult, setPreviewResult] = useState<{
    before: unknown
    after: unknown
  } | null>(null)
  const runPreview = async () => {
    if (!preview || (onValidate && !onValidate())) return
    previewFailed.current = false
    setPreviewOpen(true)
    setPreviewBusy(true)
    setPreviewResult(null)
    try {
      setPreviewResult(
        await api.post(ApiRoutes.preview(preview.kind), {
          draft: {
            ...preview.draft,
            process: normalized,
          },
        }),
      )
      onValidation?.()
    } catch (error) {
      previewFailed.current = true
      setPreviewOpen(false)
      onValidation?.(error)
      if (!onValidation)
        toast.error(error instanceof Error ? error.message : '预览失败')
    } finally {
      setPreviewBusy(false)
    }
  }
  const [addOpen, setAddOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState('')
  const [importError, setImportError] = useState('')
  const [folded, setFolded] = useState<Record<string, boolean>>({})
  useEffect(() => {
    if (!issues.length) return
    setFolded((previous) => {
      const next = { ...previous }
      for (const issue of issues) {
        const item = normalized.find(
          (entry, index) =>
            issue.operatorId === entry.id || issue.operatorIndex === index,
        )
        if (item?.id) next[item.id] = false
      }
      return next
    })
  }, [issues, normalized])
  const updateItem = (id: string, patch: Partial<ProcessItem>) =>
    onChange(
      normalized.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    )
  const addOperators = (types: string[]) => {
    onChange([
      ...normalized,
      ...normalizeProcess(
        types.map((type) => ({ type, disabled: false, customName: '' })),
      ),
    ])
  }
  const move = (index: number, delta: number) => {
    const next = [...normalized]
    const destination = index + delta
    if (destination < 0 || destination >= next.length) return
    ;[next[index], next[destination]] = [next[destination], next[index]]
    onChange(next)
  }
  const previewHandler = useRef(runPreview)
  previewHandler.current = runPreview
  const hasPreview = Boolean(preview)
  const toolbarActions = useMemo<EditorAction[]>(
    () => [
      ...(hasPreview
        ? [
            {
              id: 'preview',
              label: '预览',
              icon: previewBusy ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <Eye aria-hidden />
              ),
              disabled: previewBusy,
              onClick: () => void previewHandler.current(),
            },
          ]
        : []),
      {
        id: 'add',
        label: '添加操作',
        icon: <Plus aria-hidden />,
        onClick: () => setAddOpen(true),
      },
      {
        id: 'import',
        label: '导入操作',
        icon: <Download aria-hidden />,
        onClick: () => {
          setImportError('')
          setImportOpen(true)
        },
      },
    ],
    [hasPreview, previewBusy],
  )
  useEffect(() => {
    setEditorActions?.(toolbarActions)
    return () => setEditorActions?.([])
  }, [setEditorActions, toolbarActions])
  return (
    <div className="grid min-w-0 gap-3">
      {!setEditorActions && <EditorActions items={toolbarActions} />}
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold">节点操作</h2>
        <span className="text-xs text-muted-foreground">
          {normalized.length} 项 · 按顺序执行
        </span>
      </div>
      {!normalized.length ? (
        <div className="grid justify-items-center gap-3 rounded-lg border border-dashed bg-card px-4 py-6 text-center">
          <ListFilter className="size-6 text-muted-foreground" aria-hidden />
          <p className="text-sm text-muted-foreground">尚未添加节点操作</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setAddOpen(true)}
          >
            <Plus aria-hidden />
            添加第一个操作
          </Button>
        </div>
      ) : (
        <SortableList
          items={normalized}
          layout="grid"
          getId={(item) => item.id!}
          onReorder={onChange}
          className="grid items-start gap-3"
        >
          {(item, index) => {
            const id = item.id!
            const label =
              item.customName || OPERATOR_LABELS[item.type] || item.type
            const panelId = `${prefix}-${id}-content`
            return (
              <SortableRow key={id} id={id} className="min-w-0">
                <section
                  className={cn(
                    '@container min-w-0 rounded-lg border bg-card',
                    item.disabled && 'border-dashed',
                  )}
                  id={`editor-operation-${index}`}
                  data-editor-section={`${index + 1}. ${label}`}
                  data-editor-summary={`${item.disabled ? '已停用' : '已启用'} · ${OPERATORS.find((operator) => operator.type === item.type)?.description ?? item.type}`}
                  data-validation-operator={index}
                  tabIndex={-1}
                  aria-label={`${index + 1}. ${label}`}
                >
                  <div className="flex items-center gap-1 px-2 py-2">
                    <div className="flex min-w-0 flex-1 items-center gap-0.5">
                      <SortHandle />
                      <button
                        type="button"
                        onClick={() =>
                          setFolded((previous) => ({
                            ...previous,
                            [id]: !previous[id],
                          }))
                        }
                        aria-expanded={!folded[id]}
                        aria-controls={panelId}
                        aria-label={`${folded[id] ? '展开' : '折叠'} ${label}`}
                        className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                      >
                        {folded[id] ? (
                          <ChevronRight className="size-4" />
                        ) : (
                          <ChevronDown className="size-4" />
                        )}
                      </button>
                      <span className="font-mono text-xs text-muted-foreground">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <Input
                        value={item.customName ?? ''}
                        placeholder={OPERATOR_LABELS[item.type] ?? item.type}
                        aria-label={`${index + 1}. 自定义操作名称`}
                        title={
                          OPERATORS.find(
                            (operator) => operator.type === item.type,
                          )?.description
                        }
                        className="h-8 border-transparent bg-transparent px-2 font-medium shadow-none hover:border-input focus-visible:border-input"
                        onChange={(event) =>
                          updateItem(id, { customName: event.target.value })
                        }
                      />
                    </div>
                    <div className="ml-auto flex shrink-0 items-center gap-1">
                      <label className="flex min-h-8 cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                        <span className="sr-only">
                          {item.disabled ? '已停用' : '启用'}
                        </span>
                        <Switch
                          checked={!item.disabled}
                          onCheckedChange={(enabled) =>
                            updateItem(id, { disabled: !enabled })
                          }
                          aria-label={`${label}：启用操作`}
                        />
                      </label>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`更多操作：${label}`}
                            title="更多操作"
                          >
                            <MoreHorizontal aria-hidden />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            disabled={index === 0}
                            onSelect={() => move(index, -1)}
                          >
                            <ArrowUp />
                            上移
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={index === normalized.length - 1}
                            onSelect={() => move(index, 1)}
                          >
                            <ArrowDown />
                            下移
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() =>
                              onChange([
                                ...normalized.slice(0, index + 1),
                                {
                                  ...structuredClone(item),
                                  id: crypto.randomUUID(),
                                },
                                ...normalized.slice(index + 1),
                              ])
                            }
                          >
                            <Copy />
                            复制
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={async () => {
                              if (
                                await copyToClipboard(
                                  JSON.stringify({
                                    data: item,
                                  }),
                                )
                              )
                                toast.success(
                                  '已复制，可在 Suki Sub 或此处导入',
                                )
                              else toast.error('复制失败，请检查剪贴板权限')
                            }}
                          >
                            <Download className="rotate-180" />
                            导出
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-muted-foreground hover:text-destructive"
                            onSelect={() => {
                              onChange(
                                normalized.filter((entry) => entry.id !== id),
                              )
                              toast.success('已删除操作', {
                                action: {
                                  label: '撤销',
                                  onClick: () => {
                                    const current = latestItems.current
                                    if (
                                      current.some((entry) => entry.id === id)
                                    )
                                      return
                                    const restored = [...current]
                                    restored.splice(
                                      Math.min(index, current.length),
                                      0,
                                      item,
                                    )
                                    onChange(restored)
                                  },
                                },
                              })
                            }}
                          >
                            <Trash2 />
                            删除
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                  <div
                    id={panelId}
                    data-validation-content
                    hidden={Boolean(folded[id])}
                    className="border-t p-3"
                  >
                    <OperatorArgsEditor
                      item={item}
                      issues={issues.filter(
                        (issue) =>
                          issue.operatorId === id ||
                          issue.operatorIndex === index,
                      )}
                      onChange={(args) => updateItem(id, { args })}
                    />
                  </div>
                </section>
              </SortableRow>
            )
          }}
        </SortableList>
      )}
      {addOpen && (
        <AddOperatorDialog
          open={addOpen}
          onOpenChange={setAddOpen}
          onAdd={addOperators}
        />
      )}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent
          onCloseAutoFocus={(event) => {
            if (previewFailed.current) event.preventDefault()
          }}
          className="flex max-h-[85dvh] flex-col overflow-hidden sm:max-w-4xl"
        >
          <DialogHeader>
            <DialogTitle>操作结果预览</DialogTitle>
            <DialogDescription>
              使用当前未保存内容，检查来源、节点操作和响应修改。
            </DialogDescription>
          </DialogHeader>
          {previewBusy && (
            <div
              role="status"
              className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground"
            >
              <Loader2 className="size-4 animate-spin" aria-hidden />
              正在处理…
            </div>
          )}
          {previewResult && (
            <Tabs
              defaultValue="after"
              className="min-h-0 gap-4 overflow-y-auto"
            >
              <TabsList
                aria-label="预览阶段"
                className="w-full shrink-0 sm:hidden"
              >
                <TabsTrigger value="before">处理前</TabsTrigger>
                <TabsTrigger value="after">处理后</TabsTrigger>
              </TabsList>
              <div className="grid min-h-0 gap-4 sm:grid-cols-2">
                {(['before', 'after'] as const).map((key) => {
                  const value = previewResult[key]
                  const shown = Array.isArray(value)
                    ? value.slice(0, 100)
                    : value
                  return (
                    <TabsContent
                      key={key}
                      value={key}
                      forceMount
                      className="hidden min-w-0 content-start gap-2 data-[state=active]:grid sm:grid"
                    >
                      <span className="text-sm font-medium">
                        {key === 'before' ? '处理前' : '处理后'}
                        {Array.isArray(value)
                          ? ` · ${value.length} 个节点${value.length > 100 ? '（展示前 100 个）' : ''}`
                          : ''}
                      </span>
                      <CodeTextarea
                        language={Array.isArray(value) ? 'json' : 'auto'}
                        aria-label={
                          key === 'before' ? '处理前结果' : '处理后结果'
                        }
                        readOnly
                        value={
                          typeof shown === 'string'
                            ? shown
                            : JSON.stringify(shown, null, 2)
                        }
                        className="min-h-64 sm:h-96"
                      />
                    </TabsContent>
                  )
                })}
              </div>
            </Tabs>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>导入节点操作</DialogTitle>
            <DialogDescription>
              支持 Suki Sub 复制的操作、单个操作对象或操作数组。
            </DialogDescription>
          </DialogHeader>
          <CodeTextarea
            aria-label="操作 JSON"
            language="json"
            value={importText}
            placeholder="粘贴操作 JSON，导入后追加到当前列表"
            className="min-h-48"
            onChange={(value) => {
              setImportText(value)
              setImportError('')
            }}
          />
          {importError && (
            <div role="alert" className="text-sm text-destructive">
              {importError}
            </div>
          )}
          <Button
            type="button"
            disabled={!importText.trim()}
            onClick={() => {
              try {
                const imported = importProcess(importText)
                onChange([...normalized, ...imported])
                setImportOpen(false)
                setImportText('')
                toast.success(`已导入 ${imported.length} 项操作`)
              } catch (error) {
                setImportError(
                  error instanceof Error ? error.message : '导入失败',
                )
              }
            }}
          >
            导入
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  )
}
