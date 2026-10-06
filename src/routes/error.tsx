import { createFileRoute } from '@tanstack/react-router'

import { ErrorPanel } from '#/components/shared/error-panel'

/** 统一错误页:后端 / 登录流通过 redirect 携带 code / message */
export const Route = createFileRoute('/error')({
  component: ErrorPage,
  validateSearch: (search: Record<string, unknown>) => ({
    code: typeof search.code === 'string' ? search.code : 'ERROR',
    message: typeof search.message === 'string' ? search.message : undefined,
  }),
})

const CODE_TITLES: Record<
  string,
  { title: string; description?: string } | undefined
> = {
  OIDC_NOT_CONFIGURED: {
    title: 'OIDC 未配置',
    description: '请在服务端设置 OIDC_ISSUER 与 OIDC_AUDIENCE 后重试。',
  },
  OIDC_DISCOVERY_FAILED: {
    title: '无法获取 OIDC 端点',
    description: '登录服务发现失败,请检查 OIDC_ISSUER 是否可访问。',
  },
  UNAUTHORIZED: { title: '未登录或会话已过期' },
}

function ErrorPage() {
  const { code, message } = Route.useSearch()
  const preset = CODE_TITLES[code]
  return (
    <ErrorPanel
      code={code}
      title={preset?.title ?? '出错了'}
      description={preset?.description ?? message}
      detail={preset ? message : undefined}
    />
  )
}
