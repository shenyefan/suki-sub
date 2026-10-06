/**
 * 统一错误面板:404 / 未配置 / 登录失败 / 内部错误等共用。
 */
import { AlertTriangle, RotateCcw } from 'lucide-react'

import { Button } from '#/components/ui/button'

export function ErrorPanel({
  code,
  title,
  description,
  detail,
  showHome = true,
}: {
  code: string
  title: string
  description?: string
  detail?: string
  showHome?: boolean
}) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-md rounded-lg border bg-card p-6 shadow-xs">
        <p className="eyebrow mb-2 flex items-center gap-1.5">
          <AlertTriangle className="size-3.5" aria-hidden />
          ERROR · {code}
        </p>
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
        {description && (
          <p className="mt-2 text-sm text-muted-foreground">{description}</p>
        )}
        {detail && (
          <p className="mt-3 rounded-md bg-muted p-2 font-mono text-xs break-all">
            {detail}
          </p>
        )}
        <div className="mt-6 flex flex-wrap gap-2">
          {showHome && (
            <Button variant="outline" size="sm" asChild>
              <a href="/">返回首页</a>
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => location.reload()}>
            <RotateCcw aria-hidden />
            重试
          </Button>
        </div>
      </div>
    </main>
  )
}
