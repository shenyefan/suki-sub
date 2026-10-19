import { Save } from 'lucide-react'
import { EditorLayout } from '#/components/shared/editor-layout'
import { Button } from '#/components/ui/button'
import { Skeleton } from '#/components/ui/skeleton'
import { FieldSkeleton } from '#/components/shared/field-skeleton'

/** 两种编辑页共用实际工具栏、内容容器和分区样式。 */
export function EditorSkeleton({ kind }: { kind: 'sub' | 'collection' }) {
  const collection = kind === 'collection'
  return (
    <div
      className="editor-page"
      role="status"
      aria-label={collection ? '正在加载组合订阅' : '正在加载订阅'}
      aria-busy="true"
    >
      <EditorLayout
        title="加载中…"
        eyebrow={collection ? 'COLLECTION' : 'SUBSCRIPTION'}
        actions={
          <Button size="sm" disabled>
            <Save aria-hidden />
            保存
          </Button>
        }
      >
        <section className="editor-section">
          <div className="grid min-w-0 gap-3">
            <h2 className="editor-section-title">基本信息</h2>
            <div className="grid items-start gap-3 sm:grid-cols-2">
              <FieldSkeleton label="名称" />
              <FieldSkeleton label="显示名称" />
              {collection && <IconSkeleton />}
              <FieldSkeleton label="标签" />
              <FieldSkeleton label="备注" />
              {!collection && <IconSkeleton className="sm:col-span-2" />}
            </div>
          </div>
          {collection ? (
            <>
              <div className="grid min-w-0 gap-3 border-t pt-4 sm:grid-cols-2">
                <h2 className="text-sm font-semibold sm:col-span-2">
                  组合成员
                </h2>
                <FieldSkeleton label="从已保存订阅添加" />
                <FieldSkeleton label="添加远程 URL" />
                <div className="sm:col-span-2">
                  <p className="mb-2 text-sm font-medium">
                    成员列表(拖动调整合并顺序)
                  </p>
                  <div className="grid gap-2" aria-hidden>
                    <Skeleton className="h-11 w-full" />
                    <Skeleton className="h-11 w-full" />
                  </div>
                </div>
              </div>
              <div className="grid min-w-0 gap-3 border-t pt-4 sm:grid-cols-2">
                <h2 className="text-sm font-semibold sm:col-span-2">
                  流量信息
                </h2>
                <FieldSkeleton label="流量来源" />
              </div>
              <AdvancedSkeleton />
            </>
          ) : (
            <div className="grid min-w-0 items-start gap-4 border-t pt-4">
              <div className="grid min-w-0 gap-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold tracking-tight">
                    订阅来源
                  </h2>
                  <Skeleton className="h-8 w-36" aria-hidden />
                </div>
                <FieldSkeleton label="订阅链接" multiline />
              </div>
              <AdvancedSkeleton />
            </div>
          )}
        </section>
        <section className="grid min-w-0 gap-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold">节点操作</h2>
            <Skeleton className="h-3 w-28" aria-hidden />
          </div>
          <div className="rounded-lg border bg-card p-4" aria-hidden>
            <Skeleton className="h-5 w-40" />
            <Skeleton className="mt-4 h-9 w-full" />
          </div>
        </section>
      </EditorLayout>
    </div>
  )
}

function IconSkeleton({ className }: { className?: string }) {
  return (
    <div className={`grid min-w-0 content-start gap-1.5 ${className ?? ''}`}>
      <span className="text-sm leading-none font-medium">图标</span>
      <div className="flex items-center gap-2" aria-hidden>
        <Skeleton className="size-9 shrink-0" />
        <Skeleton className="h-9 flex-1" />
      </div>
    </div>
  )
}

function AdvancedSkeleton() {
  return (
    <div className="border-t pt-3 text-sm font-medium text-muted-foreground">
      高级设置
    </div>
  )
}
