import { createFileRoute, Outlet } from '@tanstack/react-router'

import { AuthGate } from '#/components/app-shell'

/** 需要登录的应用布局:登录门 + 侧栏/底栏骨架 */
export const Route = createFileRoute('/_app')({
  component: () => (
    <AuthGate>
      <Outlet />
    </AuthGate>
  ),
})
