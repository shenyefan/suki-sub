import { getResourceContext } from './resource-context'
import { resourceLabel } from '#/lib/resource-display'
import type { Context } from 'hono'

export function setAuditActor(c: Context, identity: Record<string, unknown>) {
  c.set(
    'auditActor' as never,
    {
      userId: identity.sub,
      userName:
        identity.name ||
        identity.preferred_username ||
        identity.email ||
        identity.sub,
      userEmail: identity.email,
    } as never,
  )
}

/** 身份只来自验证后的 OIDC 信息；IP 和位置由 Cloudflare 提供。 */
export function requestAuditDetails(
  c: Context,
  startedAt: number,
): Record<string, unknown> {
  const target = getResourceContext(c)
  const actor = c.get('auditActor' as never) as
    Record<string, unknown> | undefined
  const cf = c.req.raw.cf
  const userAgent = c.req.header('user-agent')?.slice(0, 1024)
  return {
    ...actor,
    ...(target
      ? {
          targetResourceName: target.resource.name,
          targetResourceKind: target.kind,
          targetDisplayName: resourceLabel(target.resource),
        }
      : {}),
    ip: c.req.header('cf-connecting-ip') || 'unknown',
    clientUserAgent: userAgent,
    deviceType: userAgent
      ? /bot|crawler|spider/i.test(userAgent)
        ? 'bot'
        : /tablet|ipad/i.test(userAgent)
          ? 'tablet'
          : /mobile|android|iphone/i.test(userAgent)
            ? 'mobile'
            : 'desktop'
      : undefined,
    requestHost: new URL(c.req.url).host,
    method: c.req.method,
    path: c.req.path,
    auditRequestId: c.get('auditRequestId' as never),
    durationMs: Date.now() - startedAt,
    country: cf?.country,
    region: cf?.region,
    city: cf?.city,
    colo: cf?.colo,
    asn: cf?.asn,
    asOrganization: cf?.asOrganization,
    cfRay: c.req.header('cf-ray'),
  }
}
