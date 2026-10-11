/** 写入成功后先取消旧请求，再用服务端结果更新缓存，最后后台核对。 */
import type { QueryClient, QueryKey } from '@tanstack/react-query'
import { qk } from './queries'
import type {
  Collection,
  Settings,
  Subscription,
  TokenItem,
} from '#/shared/types'

type Resource = Subscription | Collection
type ResourceKind = 'sub' | 'collection'

export async function cacheToken(client: QueryClient, token: TokenItem) {
  await client.cancelQueries({ queryKey: qk.tokens })
  client.setQueryData<TokenItem[]>(qk.tokens, (old = []) => [
    token,
    ...old.filter((item) => item.id !== token.id),
  ])
  void client.invalidateQueries({ queryKey: qk.tokens })
}

export async function removeCachedToken(client: QueryClient, id: string) {
  await client.cancelQueries({ queryKey: qk.tokens })
  client.setQueryData<TokenItem[]>(qk.tokens, (old) =>
    old?.filter((token) => token.id !== id),
  )
  void client.invalidateQueries({ queryKey: qk.tokens })
}

export async function cacheSettings(client: QueryClient, settings: Settings) {
  await client.cancelQueries({ queryKey: qk.settings })
  client.setQueryData(qk.settings, settings)
  void client.invalidateQueries({ queryKey: qk.settings })
}

async function cancelResourceQueries(client: QueryClient, kind: ResourceKind) {
  const keys: QueryKey[] = [
    kind === 'sub' ? qk.subs : qk.collections,
    [kind],
    qk.tokens,
  ]
  if (kind === 'sub') keys.push(qk.collections, ['collection'])
  await Promise.all(keys.map((queryKey) => client.cancelQueries({ queryKey })))
}

function updateMembers(
  client: QueryClient,
  previousName: string,
  newName?: string,
) {
  const update = (collection: Collection): Collection => ({
    ...collection,
    subscriptions: collection.subscriptions.flatMap((name) =>
      name === previousName ? (newName ? [newName] : []) : [name],
    ),
  })
  client.setQueryData<Collection[]>(qk.collections, (old) => old?.map(update))
  client.setQueriesData<Collection>({ queryKey: ['collection'] }, (old) =>
    old ? update(old) : old,
  )
}

export async function cacheResource(
  client: QueryClient,
  kind: ResourceKind,
  resource: Resource,
  previousName?: string,
) {
  await cancelResourceQueries(client, kind)
  const queryKey = kind === 'sub' ? qk.subs : qk.collections
  client.setQueryData<Resource[]>(queryKey, (old = []) => {
    const index = old.findIndex(
      (item) => item.name === (previousName ?? resource.name),
    )
    if (index >= 0) return old.map((item, i) => (i === index ? resource : item))
    const atTop =
      client.getQueryData<Settings>(qk.settings)?.['createItemPosition'] ===
      'top'
    return atTop ? [resource, ...old] : [...old, resource]
  })
  client.setQueryData([kind, resource.name], resource)
  if (previousName && previousName !== resource.name) {
    client.removeQueries({ queryKey: [kind, previousName], exact: true })
    client.setQueryData<TokenItem[]>(qk.tokens, (old) =>
      old?.map((token) =>
        token.type === kind && token.name === previousName
          ? { ...token, name: resource.name }
          : token,
      ),
    )
    if (kind === 'sub') updateMembers(client, previousName, resource.name)
  }
  if (kind === 'sub') {
    void client.invalidateQueries({ queryKey: qk.flow(resource.name) })
    if (previousName && previousName !== resource.name)
      client.removeQueries({ queryKey: qk.flow(previousName), exact: true })
    void client.invalidateQueries({ queryKey: qk.collections })
    void client.invalidateQueries({ queryKey: ['collection'] })
  }
  void client.invalidateQueries({ queryKey })
  void client.invalidateQueries({ queryKey: qk.tokens })
}

export async function removeCachedResource(
  client: QueryClient,
  kind: ResourceKind,
  name: string,
) {
  await cancelResourceQueries(client, kind)
  const queryKey = kind === 'sub' ? qk.subs : qk.collections
  client.setQueryData<Resource[]>(queryKey, (old) =>
    old?.filter((item) => item.name !== name),
  )
  client.removeQueries({ queryKey: [kind, name], exact: true })
  if (kind === 'sub') {
    client.removeQueries({ queryKey: qk.flow(name), exact: true })
    updateMembers(client, name)
    void client.invalidateQueries({ queryKey: qk.collections })
    void client.invalidateQueries({ queryKey: ['collection'] })
  }
  void client.invalidateQueries({ queryKey })
}
