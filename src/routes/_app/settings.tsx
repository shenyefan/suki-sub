/**
 * 设置：同步、通用、备份与恢复。
 */
import { useEffect, useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Download, Save, Upload, CloudUpload } from 'lucide-react'
import { toast } from 'sonner'

import { ApiRoutes } from '#/shared/api-contract'
import { api } from '#/lib/api'
import { qk, useSettings } from '#/lib/queries'
import { PageHeader } from '#/components/shared/page-header'
import { ConfirmDialog } from '#/components/shared/confirm-dialog'
import {
  TELEGRAM_NOTIFICATIONS,
  telegramMasterMode,
  telegramCategoryMode,
  telegramModePatch,
} from '#/shared/telegram-notifications'
import type { NotificationMode } from '#/shared/telegram-notifications'
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

  const saveAndBackup = useMutation({
    mutationFn: async () => {
      await api.patch(ApiRoutes.settings, {
        gistToken,
        syncPlatform,
        gistBackupName,
      })
      try {
        await api.post(ApiRoutes.backupSync)
      } catch (err) {
        const reason =
          err && typeof err === 'object' && 'reason' in err
            ? String(err.reason)
            : err instanceof Error
              ? err.message
              : String(err)
        throw new Error(`设置已保存，但备份失败：${reason}`)
      }
    },
    onSuccess: () => toast.success('设置已保存，备份完成'),
    onError: (err) => toast.error(err.message),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: qk.settings })
    },
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

  const savingSettings = saveSettings.isPending || saveAndBackup.isPending

  const [exporting, setExporting] = useState(false)

  // 通知:全局总开关(未设置视为开启)与各类操作通知,取值立即保存。
  const telegramConfigHint =
    settings.data?.['telegramConfiguration'] === 'invalid'
      ? '推送服务配置无效,请检查环境变量 SUKI_SUB_PUSH_SERVICE 的格式'
      : settings.data?.['telegramConfiguration'] === 'configured'
        ? undefined
        : '推送服务未配置:需要在 Worker 环境变量 SUKI_SUB_PUSH_SERVICE 中填写 telegram://机器人Token@telegram?chats=会话ID'
  const telegramMaster = telegramMasterMode(settings.data ?? {})
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
            <div className="flex flex-wrap gap-2">
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
                disabled={saveAndBackup.isPending}
              >
                <Save aria-hidden />
                保存
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!gistToken.trim() || saveSettings.isPending}
                loading={saveAndBackup.isPending}
                onClick={() => saveAndBackup.mutate()}
              >
                <CloudUpload aria-hidden />
                保存并备份
              </Button>
            </div>
          }
        >
          <div className="grid items-start gap-4 sm:grid-cols-2">
            <div className="grid min-w-0 content-start gap-2 sm:col-span-2">
              <Label htmlFor="gist-token">访问 Token</Label>
              <Input
                id="gist-token"
                type="password"
                disabled={savingSettings}
                value={gistToken}
                placeholder="ghp_… / glpat-…"
                onChange={(e) => setGistToken(e.target.value)}
              />
            </div>
            <div className="grid min-w-0 content-start gap-2">
              <Label>同步平台</Label>
              <Select
                value={syncPlatform}
                onValueChange={setSyncPlatform}
                disabled={savingSettings}
              >
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
                disabled={savingSettings}
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
                disabled={savingSettings}
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

        <Section title="通知">
          <div className="grid gap-2">
            {telegramConfigHint && (
              <p className="text-sm text-muted-foreground">
                {telegramConfigHint}
              </p>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              {[
                {
                  key: 'telegramNotificationMode',
                  label: '通知总范围',
                  description: '关闭后全部静默；仅异常会过滤所有成功通知',
                },
                ...TELEGRAM_NOTIFICATIONS,
              ].map((item) => (
                <div
                  key={item.key}
                  className="grid min-w-0 content-start gap-1.5"
                >
                  <Label htmlFor={item.key}>{item.label}</Label>
                  <Select
                    value={
                      item.key === 'telegramNotificationMode'
                        ? telegramMaster
                        : telegramCategoryMode(settings.data ?? {}, item.key)
                    }
                    disabled={savingSettings}
                    onValueChange={(value) =>
                      saveSettings.mutate(
                        telegramModePatch(
                          settings.data ?? {},
                          item.key,
                          value as NotificationMode,
                        ),
                      )
                    }
                  >
                    <SelectTrigger id={item.key} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="off">关闭</SelectItem>
                      <SelectItem value="errors">仅异常</SelectItem>
                      <SelectItem value="all">全部</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {item.description}
                  </p>
                </div>
              ))}
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
