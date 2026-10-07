import {
  SubscriptionBehaviorFields,
  SubscriptionNotificationField,
} from '#/components/shared/subscription-behavior'
import { resourceLabel } from '#/lib/resource-display'
import { useResourceValidation } from '#/lib/resource-validation'
import { ValidationHint } from '#/components/shared/validation-hint'
/**
 * 单条订阅编辑器:/subs/:name(name=UNTITLED 表示新建)。
 * 基础设置(来源/拉取/外观)+ 节点操作管线。
 */
import { useEffect, useMemo, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, Loader2, Save } from 'lucide-react'
import { toast } from 'sonner'

import { ApiRoutes } from '#/shared/api-contract'
import type { Subscription } from '#/shared/types'
import { api } from '#/lib/api'
import { cn } from '#/lib/utils'
import { qk } from '#/lib/queries'
import { normalizeProcess } from '#/features/operators/model'
import { PipelineEditor } from '#/features/operators/pipeline-editor'
import type { ProcessItem } from '#/features/operators/registry'
import { SourcePicker } from '#/components/shared/source-picker'
import { CodeTextarea } from '#/components/shared/code-textarea'
import { IconField } from '#/components/shared/icon-fields'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { SwitchField } from '#/components/shared/switch-field'
import { Skeleton } from '#/components/ui/skeleton'
import { EditorLayout } from '#/components/shared/editor-layout'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'

export const Route = createFileRoute('/_app/subs_/$name')({
  component: SubEditorPage,
})

function Field({
  label,
  htmlFor,
  className,
  children,
}: {
  label: string
  htmlFor?: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn('grid min-w-0 content-start gap-2', className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  )
}

/** age 密钥对生成结果展示 */
function AgeKeyDialog({
  open,
  onOpenChange,
  keys,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  keys: { publicKey: string; secretKey: string } | null
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>age 密钥对</DialogTitle>
          <DialogDescription>
            私钥请自行妥善保存;此处把公钥填入表单。
          </DialogDescription>
        </DialogHeader>
        {keys && (
          <div className="grid gap-3 text-sm">
            <div>
              <p className="mb-1 font-medium">公钥</p>
              <code className="block break-all rounded-md border bg-muted p-2 font-mono text-xs">
                {keys.publicKey}
              </code>
            </div>
            <div>
              <p className="mb-1 font-medium">私钥</p>
              <code className="block break-all rounded-md border bg-muted p-2 font-mono text-xs">
                {keys.secretKey}
              </code>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function SubEditorPage() {
  const { name } = Route.useParams()
  const navigate = useNavigate()
  const client = useQueryClient()
  const isNew = name === 'UNTITLED'

  const { data: existing, isLoading } = useQuery({
    queryKey: ['sub', name],
    queryFn: () => api.get<Subscription>(ApiRoutes.sub(name)),
    enabled: !isNew,
  })

  const [form, setForm] = useState<Subscription>({
    name: '',
    source: 'remote',
    url: '',
    process: [],
  })
  const [tagText, setTagText] = useState('')
  const [ageKeys, setAgeKeys] = useState<{
    publicKey: string
    secretKey: string
  } | null>(null)
  const [ageOpen, setAgeOpen] = useState(false)

  useEffect(() => {
    if (isNew) return
    if (!existing) return
    setForm({ ...existing, process: existing.process ?? [] })
    setTagText(
      Array.isArray(existing.tag)
        ? existing.tag.join(', ')
        : typeof existing.tag === 'string'
          ? existing.tag
          : '',
    )
  }, [isNew, existing])

  const patch = (p: Partial<Subscription>) =>
    setForm((prev) => ({ ...prev, ...p }))

  const process = useMemo(
    () => (form.process ?? []) as ProcessItem[],
    [form.process],
  )

  const validation = useResourceValidation('sub', form)

  const save = useMutation({
    mutationFn: async () => {
      if (!form.name || form.name.includes('/')) {
        throw new Error('名称不能为空且不能包含 /')
      }
      const tags = tagText
        .split(/[,，]/)
        .map((t) => t.trim())
        .filter(Boolean)
      const payload = {
        ...form,
        process: normalizeProcess(form.process ?? []),
        tag: tags.length ? tags : undefined,
      }
      if (isNew) return api.post(ApiRoutes.subs, payload)
      return api.patch(ApiRoutes.sub(name), payload)
    },
    onSuccess: (saved) => {
      toast.success(isNew ? '订阅已创建' : '订阅已保存')
      void client.invalidateQueries({ queryKey: qk.subs })
      const resource = saved as Subscription
      client.setQueryData(['sub', resource.name], resource)
      if (resource.name === name)
        void client.invalidateQueries({ queryKey: ['sub', name] })
      void client.invalidateQueries({ queryKey: qk.tokens })
      void client.invalidateQueries({ queryKey: qk.collections })
      void navigate({
        to: '/subs/$name',
        params: { name: (saved as Subscription).name },
        replace: true,
      })
    },
    onError: (err) => {
      validation.report(err)
    },
  })

  const generateAgeKeys = async () => {
    try {
      const keys = await api.post<{ publicKey: string; secretKey: string }>(
        ApiRoutes.ageKeyPair,
      )
      patch({ agePublicKey: keys.publicKey })
      setAgeKeys(keys)
      setAgeOpen(true)
    } catch (err) {
      toast.error(`生成失败:${err instanceof Error ? err.message : err}`)
    }
  }

  if (!isNew && isLoading) {
    return (
      <div className="page-container grid gap-3">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-96 w-full" />
      </div>
    )
  }

  const isLocal = form.source === 'local'

  return (
    <div className="editor-page">
      <EditorLayout
        title={isNew ? '新建单条订阅' : `编辑:${resourceLabel(form)}`}
        eyebrow="SUBSCRIPTION"
        actions={
          <Button
            size="sm"
            onClick={() => {
              if (validation.validate()) save.mutate()
            }}
            disabled={save.isPending}
          >
            {save.isPending ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <Save aria-hidden />
            )}
            保存
          </Button>
        }
      >
        <section
          id="editor-basic"
          data-editor-section="基础信息"
          data-editor-summary={
            form.name ? `订阅：${resourceLabel(form)}` : '名称、来源及订阅设置'
          }
          tabIndex={-1}
          aria-label="基础信息"
          className="editor-section"
        >
          <div className="grid min-w-0 gap-3">
            <h2 className="editor-section-title">基本信息</h2>
            <div className="grid items-start gap-3 sm:grid-cols-2">
              <Field label="名称" htmlFor="sub-name">
                <Input
                  id="sub-name"
                  aria-invalid={validation.issues.some(
                    (issue) => issue.field === 'name',
                  )}
                  aria-describedby="sub-name-error"
                  value={form.name}
                  onChange={(e) => patch({ name: e.target.value })}
                  placeholder="唯一名称，不可包含 /"
                />
                <ValidationHint
                  id="sub-name-error"
                  issues={validation.issues.filter(
                    (issue) => issue.field === 'name',
                  )}
                />
              </Field>
              <Field label="显示名称" htmlFor="sub-display-name">
                <Input
                  id="sub-display-name"
                  value={form.displayName ?? ''}
                  onChange={(e) => patch({ displayName: e.target.value })}
                  placeholder="选填，留空使用名称"
                />
              </Field>
              <Field label="标签" htmlFor="sub-tag">
                <Input
                  id="sub-tag"
                  value={tagText}
                  onChange={(e) => setTagText(e.target.value)}
                  placeholder="多个标签用逗号分隔，如：主用, 机场"
                />
              </Field>
              <Field label="备注" htmlFor="sub-remark">
                <Input
                  id="sub-remark"
                  value={form.remark ?? ''}
                  onChange={(e) => patch({ remark: e.target.value })}
                  placeholder="选填，记录订阅用途或其他备注"
                />
              </Field>
              <IconField
                className="sm:col-span-2"
                item={form}
                patch={patch}
                id="sub-icon"
                value={form.icon ?? ''}
                onChange={(icon) => patch({ icon })}
              />
            </div>
          </div>
          <div className="grid min-w-0 items-start gap-4 border-t pt-4">
            <div className="grid min-w-0 gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold tracking-tight">
                  订阅来源
                </h2>
                <SourcePicker
                  value={isLocal ? 'local' : 'remote'}
                  onChange={(source) => patch({ source })}
                  disabled={!isNew}
                />
              </div>

              {isLocal && (
                <Field label="本地订阅内容" htmlFor="sub-content">
                  <CodeTextarea
                    id="sub-content"
                    aria-invalid={validation.issues.some(
                      (issue) => issue.field === 'content',
                    )}
                    aria-describedby="sub-content-error"
                    className="min-h-40"
                    value={form.content ?? ''}
                    onChange={(value) => patch({ content: value })}
                    placeholder="粘贴本地订阅内容或节点链接"
                  />
                  <ValidationHint
                    id="sub-content-error"
                    issues={validation.issues.filter(
                      (issue) => issue.field === 'content',
                    )}
                  />
                </Field>
              )}

              {isLocal && (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <Label htmlFor="sub-merge" className="shrink-0 leading-5">
                    合并远程订阅
                  </Label>
                  <Select
                    value={form.mergeSources || 'none'}
                    onValueChange={(v) =>
                      patch({ mergeSources: v === 'none' ? '' : v })
                    }
                  >
                    <SelectTrigger id="sub-merge" className="w-full sm:w-56">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">
                        不合并，仅使用本地内容
                      </SelectItem>
                      <SelectItem value="localFirst">
                        合并，本地内容优先
                      </SelectItem>
                      <SelectItem value="remoteFirst">
                        合并，远程订阅优先
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              {(!isLocal || Boolean(form.mergeSources)) && (
                <Field
                  label={isLocal ? '远程订阅链接' : '订阅链接'}
                  htmlFor="sub-url"
                >
                  <CodeTextarea
                    id="sub-url"
                    language="text"
                    aria-invalid={validation.issues.some(
                      (issue) => issue.field === 'url',
                    )}
                    aria-describedby="sub-url-error"
                    className="min-h-24"
                    value={form.url ?? ''}
                    onChange={(value) => patch({ url: value })}
                    placeholder="粘贴订阅链接，每行一个 https://…"
                  />
                  <ValidationHint
                    id="sub-url-error"
                    issues={validation.issues.filter(
                      (issue) => issue.field === 'url',
                    )}
                  />
                </Field>
              )}
            </div>
            <details className="min-w-0 border-t pt-3">
              <summary className="cursor-pointer text-sm font-medium text-muted-foreground">
                高级设置
              </summary>
              <div className="mt-3 grid gap-3">
                <div className="grid items-start gap-3 sm:grid-cols-2">
                  <Field label="User-Agent" htmlFor="sub-ua">
                    <Input
                      id="sub-ua"
                      value={form.ua ?? ''}
                      onChange={(e) => patch({ ua: e.target.value })}
                      placeholder="留空使用默认 User-Agent"
                    />
                  </Field>
                  <Field label="流量信息" htmlFor="sub-userinfo">
                    <Input
                      id="sub-userinfo"
                      value={form.subUserinfo ?? ''}
                      onChange={(e) => patch({ subUserinfo: e.target.value })}
                      placeholder="填写 subscription-userinfo 头内容或获取地址"
                    />
                  </Field>
                  <Field label="age 公钥" htmlFor="sub-age">
                    <div className="flex gap-2">
                      <Input
                        id="sub-age"
                        value={form.agePublicKey ?? ''}
                        onChange={(e) =>
                          patch({ agePublicKey: e.target.value })
                        }
                        placeholder="输入 age 公钥以加密订阅输出"
                      />
                      <Button
                        variant="outline"
                        size="icon"
                        aria-label="生成 age 密钥对"
                        title="生成 age 密钥对"
                        onClick={() => void generateAgeKeys()}
                      >
                        <KeyRound />
                      </Button>
                    </div>
                  </Field>
                  <SubscriptionNotificationField
                    id="sub-telegram"
                    value={form}
                    onChange={patch}
                  />
                </div>

                <SubscriptionBehaviorFields value={form} onChange={patch}>
                  <SwitchField
                    label="跳过流量信息"
                    id="sub-noflow"
                    checked={Boolean(form.noFlow)}
                    onCheckedChange={(v) => patch({ noFlow: v })}
                  />
                  <SwitchField
                    label="忽略拉取失败"
                    id="sub-ignorefailed"
                    checked={Boolean(form.ignoreFailedRemoteSub)}
                    onCheckedChange={(v) => patch({ ignoreFailedRemoteSub: v })}
                  />
                </SubscriptionBehaviorFields>
              </div>
            </details>
          </div>
        </section>

        <section
          id="editor-process"
          data-editor-section="节点操作"
          data-editor-summary={`${process.length} 项操作，按从上到下的顺序执行`}
          tabIndex={-1}
          aria-label="节点操作"
          className="min-w-0"
        >
          <PipelineEditor
            issues={validation.issues.filter(
              (issue) =>
                issue.resourceKind === 'sub' &&
                issue.resourceName === (form.name || '未命名'),
            )}
            onValidation={validation.report}
            onValidate={validation.validate}
            preview={{ kind: 'sub', draft: form }}
            items={process}
            onChange={(next) => patch({ process: next })}
          />
        </section>
      </EditorLayout>

      <AgeKeyDialog open={ageOpen} onOpenChange={setAgeOpen} keys={ageKeys} />
    </div>
  )
}
