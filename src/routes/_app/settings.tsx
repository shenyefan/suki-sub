/**
 * 设置：同步、通用、备份与恢复。
 */
import { useEffect, useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Download, Save, Upload } from 'lucide-react'
import { toast } from 'sonner'

import { ApiRoutes } from '#/shared/api-contract'
import { api } from '#/lib/api'
import { qk, useSettings } from '#/lib/queries'
import { PageHeader } from '#/components/shared/page-header'
import { ConfirmDialog } from '#/components/shared/confirm-dialog'
import { useThemeMode } from '#/components/theme-toggle'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { Skeleton } from '#/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'

export const Route = createFileRoute('/_app/settings')({
  component: SettingsPage,
})

function Section({
  title,
  description,
  children,
  actions,
}: {
  title: string
  description?: string
  children: React.ReactNode
  actions?: React.ReactNode
}) {
  return (
    <section className="rounded-lg border bg-card p-4">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">{title}</h2>
          {description && (
            <p className="mt-0.5 text-sm text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        {actions}
      </div>
      {children}
    </section>
  )
}

function SettingsPage() {
  const client = useQueryClient()
  const settings = useSettings()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [restoreFile, setRestoreFile] = useState<File | null>(null)

  // Gist / 通用表单(独立草稿,保存时合并提交)
  const [gistToken, setGistToken] = useState('')
  const [syncPlatform, setSyncPlatform] = useState('gist')
  const [gistBackupName, setGistBackupName] = useState('suki-sub-backup')
  const [createPosition, setCreatePosition] = useState('bottom')
  const [themeMode, setThemeMode] = useThemeMode()

  useEffect(() => {
    if (!settings.data) return
    setGistToken(String(settings.data['gistToken'] ?? ''))
    setSyncPlatform(String(settings.data['syncPlatform'] ?? 'gist'))
    setGistBackupName(
      String(settings.data['gistBackupName'] ?? 'suki-sub-backup'),
    )
    setCreatePosition(
      settings.data['createItemPosition'] === 'top' ? 'top' : 'bottom',
    )
  }, [settings.data])

  const saveSettings = useMutation({
    mutationFn: (patch: Record<string, unknown>) =>
      api.patch(ApiRoutes.settings, patch),
    onSuccess: () => {
      toast.success('设置已保存')
      void client.invalidateQueries({ queryKey: qk.settings })
    },
    onError: (err) => toast.error(`保存失败:${err.message}`),
  })

  const restore = useMutation({
    mutationFn: async (file: File) => {
      const payload = JSON.parse(await file.text())
      return api.post(ApiRoutes.storage, payload)
    },
    onSuccess: () => {
      toast.success('恢复完成')
      setRestoreFile(null)
      void client.invalidateQueries()
    },
    onError: (err) =>
      toast.error(`恢复失败:${err instanceof Error ? err.message : err}`),
  })

  const [exporting, setExporting] = useState(false)
  const exportAll = async () => {
    setExporting(true)
    try {
      const data = await api.get(ApiRoutes.storage)
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: 'application/json',
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `suki-sub-backup-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      toast.error(`导出失败:${err instanceof Error ? err.message : err}`)
    } finally {
      setExporting(false)
    }
  }

  if (settings.isLoading) {
    return (
      <div className="page-container grid gap-3">
        <Skeleton className="h-10 w-40" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  return (
    <div className="page-container">
      <PageHeader eyebrow="SETTINGS" title="设置" />
      <div className="grid gap-4">
        <Section
          title="Gist 同步"
          description="同步备份到 GitHub Gist 或 GitLab Snippet。"
          actions={
            <Button
              size="sm"
              onClick={() =>
                saveSettings.mutate({
                  gistToken,
                  syncPlatform,
                  gistBackupName,
                })
              }
              loading={saveSettings.isPending}
            >
              <Save aria-hidden />
              保存
            </Button>
          }
        >
          <div className="grid items-start gap-4 sm:grid-cols-2">
            <div className="grid min-w-0 content-start gap-2 sm:col-span-2">
              <Label htmlFor="gist-token">访问 Token</Label>
              <Input
                id="gist-token"
                type="password"
                value={gistToken}
                placeholder="ghp_… / glpat-…"
                onChange={(e) => setGistToken(e.target.value)}
              />
            </div>
            <div className="grid min-w-0 content-start gap-2">
              <Label>同步平台</Label>
              <Select value={syncPlatform} onValueChange={setSyncPlatform}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="gist">GitHub Gist</SelectItem>
                  <SelectItem value="gitlab">GitLab Snippet</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid min-w-0 content-start gap-2">
              <Label htmlFor="gist-backup-name">备份 Gist 名称</Label>
              <Input
                id="gist-backup-name"
                value={gistBackupName}
                onChange={(e) => setGistBackupName(e.target.value)}
                placeholder="输入备份名称"
              />
            </div>
          </div>
        </Section>

        <Section title="通用">
          <div className="grid items-start gap-4 sm:grid-cols-2">
            <div className="grid min-w-0 content-start gap-2">
              <Label>新建条目位置</Label>
              <Select
                value={createPosition}
                onValueChange={(v) => {
                  setCreatePosition(v)
                  saveSettings.mutate({ createItemPosition: v })
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="bottom">添加到列表末尾</SelectItem>
                  <SelectItem value="top">添加到列表开头</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid min-w-0 content-start gap-2">
              <Label>界面主题</Label>
              <Select
                value={themeMode}
                onValueChange={(v) => {
                  setThemeMode(
                    v === 'light' || v === 'dark' || v === 'auto' ? v : 'auto',
                  )
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="light">浅色</SelectItem>
                  <SelectItem value="dark">深色</SelectItem>
                  <SelectItem value="auto">跟随系统</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </Section>

        <Section
          title="备份与恢复"
          description="全量导出 / 恢复订阅、组合与设置。"
        >
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => void exportAll()}
              loading={exporting}
            >
              <Download aria-hidden />
              导出全部数据
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) setRestoreFile(file)
                e.target.value = ''
              }}
            />
            <Button
              variant="outline"
              className="text-destructive hover:text-destructive"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload aria-hidden />
              从文件恢复
            </Button>
          </div>
        </Section>
      </div>
      <ConfirmDialog
        open={restoreFile != null}
        onOpenChange={(open) => {
          if (!open) setRestoreFile(null)
        }}
        title="恢复全部数据"
        description={`将用「${restoreFile?.name ?? ''}」替换服务器上的全部数据,此操作不可撤销。`}
        confirmText="恢复"
        loading={restore.isPending}
        onConfirm={() => {
          if (restoreFile) restore.mutate(restoreFile)
        }}
      />
    </div>
  )
}
