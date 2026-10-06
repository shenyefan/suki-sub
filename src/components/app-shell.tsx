/**
 * 应用骨架:
 * - 桌面(≥md):固定左侧栏(品牌、导航、主题、用户/退出)
 * - 手机:顶部紧凑标题栏 + 底部标签栏(订阅/分享/日志/设置)
 * - 手机顶栏:主题、退出
 */
import { Link, useRouterState } from '@tanstack/react-router'
import { useState } from 'react'
import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area'
import { useQuery } from '@tanstack/react-query'
import { Layers, LogOut, ScrollText, Settings, Share2 } from 'lucide-react'

import { fetchSession } from '#/lib/api'
import type { SessionStatus } from '#/lib/api'
import { AuthRoutes } from '#/shared/api-contract'
import { ErrorPanel } from '#/components/shared/error-panel'
import { cn } from '#/lib/utils'
import { Button } from '#/components/ui/button'
import { ScrollBar } from '#/components/ui/scroll-area'
import { ThemeToggle } from '#/components/theme-toggle'

const NAV_ITEMS = [
  { to: '/subs', label: '订阅', icon: Layers },
  { to: '/shares', label: '分享', icon: Share2 },
  { to: '/logs', label: '日志', icon: ScrollText },
  { to: '/settings', label: '设置', icon: Settings },
] as const

function useIsActive(to: string) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  return (
    pathname === to ||
    pathname.startsWith(`${to}/`) ||
    (to === '/subs' && pathname.startsWith('/collections/'))
  )
}

function NavLink({
  to,
  label,
  icon: Icon,
  layout,
}: {
  to: string
  label: string
  icon: typeof Layers
  layout: 'sidebar' | 'bottom'
}) {
  const active = useIsActive(to)
  if (layout === 'bottom') {
    return (
      <Link
        to={to}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'flex min-w-14 flex-col items-center gap-0.5 rounded-md py-1.5 text-xs font-medium transition-colors',
          active ? 'text-foreground' : 'text-muted-foreground',
        )}
      >
        <Icon className="size-5" aria-hidden />
        {label}
      </Link>
    )
  }
  return (
    <Link
      to={to}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
        active
          ? 'bg-accent text-accent-foreground'
          : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
      )}
    >
      <Icon className="size-4" aria-hidden />
      {label}
    </Link>
  )
}

function BrandMark() {
  return (
    <div className="flex items-center gap-2 px-2">
      <img src="/favicon.svg" alt="" className="size-7 shrink-0" aria-hidden />
      <span className="text-sm font-semibold tracking-tight">SUKI SUB</span>
    </div>
  )
}

function UserBadge({
  session,
  compact,
}: {
  session: SessionStatus | undefined
  compact?: boolean
}) {
  const name = session?.user?.name?.trim() || session?.user?.email || '已登录'
  const picture = session?.user?.picture
  const [failedPicture, setFailedPicture] = useState<string>()
  return (
    <div
      className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground"
      title={session?.user?.email || name}
    >
      <span className="flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-full border bg-card text-[10px] font-medium text-foreground">
        {picture && failedPicture !== picture ? (
          <img
            src={picture}
            alt={`${name}的头像`}
            className="size-full object-cover"
            referrerPolicy="no-referrer"
            onError={() => setFailedPicture(picture)}
          />
        ) : (
          <span aria-hidden>{name.slice(0, 1).toUpperCase()}</span>
        )}
      </span>
      <span className={compact ? 'sr-only' : 'truncate'}>{name}</span>
    </div>
  )
}

function LogoutButton({ compact }: { compact?: boolean }) {
  return (
    <Button
      variant={compact ? 'ghost' : 'outline'}
      size={compact ? 'icon-sm' : 'sm'}
      asChild
    >
      <a href={AuthRoutes.logout} aria-label="退出登录" title="退出登录">
        <LogOut aria-hidden />
        {!compact && '退出登录'}
      </a>
    </Button>
  )
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { data: session } = useQuery({
    queryKey: ['session'],
    queryFn: fetchSession,
    staleTime: 5 * 60 * 1000,
  })

  return (
    <div className="h-dvh min-w-0 overflow-hidden">
      {/* 桌面侧栏 */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-56 flex-col border-r bg-card md:flex">
        <div className="flex h-16 shrink-0 items-center border-b px-2">
          <BrandMark />
        </div>
        <nav className="flex flex-1 flex-col gap-1 p-2" aria-label="主导航">
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.to} {...item} layout="sidebar" />
          ))}
        </nav>
        <div className="flex items-center justify-between gap-2 border-t p-3">
          <UserBadge session={session} />
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <LogoutButton compact />
          </div>
        </div>
      </aside>

      {/* 手机顶栏 */}
      <header className="sticky top-0 z-30 flex h-12 items-center border-b bg-card/95 backdrop-blur md:hidden">
        <div className="min-w-0 flex-1 px-4">
          <BrandMark />
        </div>
        <div className="flex items-center gap-1 pr-4">
          <UserBadge session={session} compact />
          <ThemeToggle />
          <LogoutButton compact />
        </div>
      </header>

      <ScrollAreaPrimitive.Root
        asChild
        type="scroll"
        className="relative h-[calc(100dvh-3rem)] min-w-0 overflow-hidden md:ml-56 md:h-dvh"
      >
        <main>
          {/* 把 sr-only 等绝对定位子元素约束在视口内，避免撑出外层滚动条。 */}
          <ScrollAreaPrimitive.Viewport
            id="content"
            tabIndex={-1}
            className="relative size-full min-w-0 overscroll-contain [&>div]:!block"
          >
            {children}
          </ScrollAreaPrimitive.Viewport>
          <ScrollBar />
        </main>
      </ScrollAreaPrimitive.Root>

      {/* 手机底栏 */}
      <nav
        className="fixed inset-x-0 bottom-0 z-30 flex items-stretch justify-around border-t bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
        aria-label="底部导航"
      >
        {NAV_ITEMS.map((item) => (
          <NavLink key={item.to} {...item} layout="bottom" />
        ))}
      </nav>
    </div>
  )
}

/**
 * 登录门:未登录直接整页跳转 OIDC 授权(无登录界面);
 * 会话探测失败(网络/服务端异常)时给出错误面板。
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['session'],
    queryFn: fetchSession,
    retry: 1,
  })

  if (isLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <div className="animate-pulse">
          <BrandMark />
        </div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <ErrorPanel
        code="SESSION_ERROR"
        title="无法确认登录状态"
        description="会话接口不可用,请确认服务是否正常。"
        detail={error instanceof Error ? error.message : undefined}
      />
    )
  }

  if (!data.authenticated) {
    // 全页跳转后端 /auth/login → IdP 授权 → 回调建立会话
    if (typeof window !== 'undefined') {
      window.location.replace(AuthRoutes.login)
    }
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <p className="eyebrow animate-pulse">正在跳转登录…</p>
      </div>
    )
  }

  return <AppShell>{children}</AppShell>
}
