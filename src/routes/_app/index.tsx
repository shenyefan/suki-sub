import { createFileRoute, redirect } from '@tanstack/react-router'

/** 根路径直接进订阅管理 */
export const Route = createFileRoute('/_app/')({
  beforeLoad: () => {
    throw redirect({ to: '/subs' })
  },
})
