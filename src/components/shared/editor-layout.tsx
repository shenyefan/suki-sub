import { createContext, useContext, useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { ChevronRight, Layers } from 'lucide-react'
import { Separator } from '#/components/ui/separator'
import { Button } from '#/components/ui/button'
import { EditorActions } from '#/components/shared/editor-actions'
import type { EditorAction } from '#/components/shared/editor-actions'

const EditorToolbarContext = createContext<
  ((actions: EditorAction[]) => void) | null
>(null)
export function useEditorActions() {
  return useContext(EditorToolbarContext)
}

export function EditorLayout({
  title,
  eyebrow,
  actions,
  children,
}: {
  title: string
  eyebrow: string
  actions: ReactNode
  children: ReactNode
}) {
  const [toolbarActions, setToolbarActions] = useState<EditorAction[]>([])
  return (
    <EditorToolbarContext.Provider value={setToolbarActions}>
      <div className="min-w-0">
        <header className="editor-topbar">
          <Button
            variant="ghost"
            size="icon-sm"
            asChild
            className="hidden shrink-0 md:inline-flex"
          >
            <Link to="/subs" aria-label="返回订阅列表" title="返回订阅列表">
              <Layers aria-hidden />
            </Link>
          </Button>
          <Separator
            orientation="vertical"
            className="hidden data-[orientation=vertical]:h-6 md:block"
          />
          <nav
            aria-label="面包屑"
            className="min-w-24 flex-1 sm:min-w-40 lg:min-w-56"
          >
            <ol className="flex min-w-0 items-center gap-1.5 text-sm sm:gap-2">
              <li className="shrink-0">
                <Link
                  to="/subs"
                  className="text-muted-foreground transition-colors hover:text-foreground"
                >
                  订阅
                </Link>
              </li>
              <li aria-hidden className="shrink-0">
                <ChevronRight className="size-3.5 text-muted-foreground" />
              </li>
              <li className="hidden shrink-0 text-muted-foreground md:block">
                <Link
                  to="/subs"
                  hash={
                    eyebrow === 'COLLECTION' ? 'collections' : 'subscriptions'
                  }
                  className="transition-colors hover:text-foreground"
                >
                  {eyebrow === 'COLLECTION' ? '组合订阅' : '单条订阅'}
                </Link>
              </li>
              <li aria-hidden className="hidden shrink-0 md:block">
                <ChevronRight className="size-3.5 text-muted-foreground" />
              </li>
              <li className="min-w-0">
                <h1
                  aria-current="page"
                  className="truncate text-sm font-medium"
                  title={title}
                >
                  {title.replace(/^编辑[:：]/, '')}
                </h1>
              </li>
            </ol>
          </nav>
          <EditorActions items={toolbarActions} save={actions} />
        </header>
        <div className="page-container editor-body px-5 sm:px-6">
          {children}
        </div>
      </div>
    </EditorToolbarContext.Provider>
  )
}
