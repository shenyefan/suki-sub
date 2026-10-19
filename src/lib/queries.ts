import type { QueryClient } from '@tanstack/react-query'
import type { LogFilters } from '#/shared/logs'
/**
 * 常用服务端状态 hooks(react-query 封装,页面直接消费)。
 */
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { ApiRoutes } from '#/shared/api-contract'
import type { FlowInfoResponse, LogsResponse } from '#/shared/api-contract'
import { api } from '#/lib/api'
import type {
  Collection,
  Settings,
  Subscription,
  TokenItem,
} from '#/shared/types'

export const qk = {
  subs: ['subs'] as const,
  collections: ['collections'] as const,
  modules: ['modules'] as const,
  tokens: ['tokens'] as const,
  settings: ['settings'] as const,
  logs: ['logs'] as const,
  env: ['env'] as const,
  flow: (name: string) => ['flow', name] as const,
  collectionFlow: (name: string) => ['collectionFlow', name] as const,
}

export function useSubs() {
  return useQuery({
    queryKey: qk.subs,
    queryFn: ({ signal }) => api.get<Subscription[]>(ApiRoutes.subs, signal),
  })
}

export function useCollections() {
  return useQuery({
    queryKey: qk.collections,
    queryFn: ({ signal }) =>
      api.get<Collection[]>(ApiRoutes.collections, signal),
  })
}

export function useTokens() {
  return useQuery({
    queryKey: qk.tokens,
    queryFn: ({ signal }) => api.get<TokenItem[]>(ApiRoutes.shares, signal),
  })
}

export function useSettings() {
  return useQuery({
    queryKey: qk.settings,
    queryFn: ({ signal }) => api.get<Settings>(ApiRoutes.settings, signal),
  })
}

export interface EnvResponse {
  backend: string
  version: string
  feature: Record<string, boolean>
}

export function useEnv() {
  return useQuery({
    queryKey: qk.env,
    queryFn: ({ signal }) => api.get<EnvResponse>(ApiRoutes.env, signal),
  })
}

export type { LogEntry } from '#/shared/logs'

export function useLogs(filters: LogFilters) {
  return useInfiniteQuery({
    queryKey: [...qk.logs, filters],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ signal, pageParam }) => {
      const params = new URLSearchParams({ ...filters })
      if (pageParam) params.set('cursor', pageParam)
      return api.get<LogsResponse>(`${ApiRoutes.logs}?${params}`, signal)
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    // 仅首屏自动刷新，翻阅历史时避免反复重查所有已加载页面。
    refetchInterval: (query) =>
      (query.state.data?.pages.length ?? 0) <= 1 ? 5000 : false,
  })
}

export type FlowApiResponse = FlowInfoResponse

export function useFlow(name: string, enabled: boolean) {
  return useQuery({
    queryKey: qk.flow(name),
    queryFn: ({ signal }) =>
      api.get<FlowApiResponse>(ApiRoutes.subFlow(name), signal),
    enabled,
    staleTime: 5 * 60 * 1000,
    retry: false,
  })
}

export function useCollectionFlow(name: string, enabled: boolean) {
  return useQuery({
    queryKey: qk.collectionFlow(name),
    queryFn: ({ signal }) =>
      api.get<FlowApiResponse>(ApiRoutes.collectionFlow(name), signal),
    enabled,
    staleTime: 5 * 60 * 1000,
    retry: false,
  })
}

export async function refreshCollectionFlow(client: QueryClient, name: string) {
  await client.cancelQueries({ queryKey: qk.collectionFlow(name) })
  return client.fetchQuery({
    queryKey: qk.collectionFlow(name),
    queryFn: ({ signal }) =>
      api.get<FlowApiResponse>(ApiRoutes.collectionFlow(name, true), signal),
    staleTime: 0,
    retry: false,
  })
}

/** 手动刷新同时绕过前端缓存和服务端流量头缓存。 */
export async function refreshFlow(client: QueryClient, name: string) {
  await client.cancelQueries({ queryKey: qk.flow(name) })
  return client.fetchQuery({
    queryKey: qk.flow(name),
    queryFn: ({ signal }) =>
      api.get<FlowApiResponse>(ApiRoutes.subFlow(name, true), signal),
    staleTime: 0,
    retry: false,
  })
}

/** 排序:先乐观重排本地缓存(拖拽落定不闪跳),失败再回滚到服务端数据 */
export function useSortMutation(kind: 'subs' | 'collections' | 'modules') {
  const client = useQueryClient()
  return useMutation({
    mutationKey: ['order', kind],
    scope: { id: `order-${kind}` },
    mutationFn: (names: string[]) => api.post(ApiRoutes.sort(kind), names),
    onMutate: async (names) => {
      await client.cancelQueries({ queryKey: qk[kind] })
      client.setQueryData<unknown[]>(qk[kind], (old) => {
        if (!Array.isArray(old) || !names.length) return old
        // 被排序项按新顺序填回其原本占据的槽位;未列出的条目位置不动
        const name = (item: unknown) => String((item as { name: string }).name)
        const nameSet = new Set(names)
        const byName = new Map(old.map((item) => [name(item), item]))
        let idx = 0
        return old.map((item) =>
          nameSet.has(name(item)) ? (byName.get(names[idx++]) ?? item) : item,
        )
      })
    },
    onSettled: () => {
      // 连续拖动按顺序写入，等最后一次完成后再核对，避免旧结果覆盖新排序。
      if (client.isMutating({ mutationKey: ['order', kind] }) === 1)
        void client.invalidateQueries({ queryKey: qk[kind] })
    },
  })
}
