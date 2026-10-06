import type { Context } from 'hono'
import type { Collection, Subscription } from '#/shared/types'

export interface ResourceContext {
  kind: 'sub' | 'collection'
  resource: Subscription | Collection
}
export function setResourceContext(
  c: Context,
  kind: ResourceContext['kind'],
  resource: ResourceContext['resource'],
) {
  c.set('operationResource' as never, { kind, resource } as never)
}
export function getResourceContext(c: Context): ResourceContext | undefined {
  return c.get('operationResource' as never)
}
