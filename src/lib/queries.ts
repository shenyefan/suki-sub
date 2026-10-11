import type { LogEntry } from '#/shared/logs'
/**
 * 常用服务端状态 hooks(react-query 封装,页面直接消费)。
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiRoutes } from '#/shared/api-contract'
import type { FlowInfoResponse } from '#/shared/api-contract'
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
}

export function useSubs() {
  return useQuery({
    queryKey: qk.subs,
    queryFn: () => api.get<Subscription[]>(ApiRoutes.subs),
  })
}

export function useCollections() {
  return useQuery({
    queryKey: qk.collections,
    queryFn: () => api.get<Collection[]>(ApiRoutes.collections),
  })
}

export function useTokens() {
  return useQuery({
    queryKey: qk.tokens,
    queryFn: () => api.get<TokenItem[]>(ApiRoutes.shares),
  })
}

export function useSettings() {
  return useQuery({
    queryKey: qk.settings,
    queryFn: () => api.get<Settings>(ApiRoutes.settings),
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
    queryFn: () => api.get<EnvResponse>(ApiRoutes.env),
  })
}

export type { LogEntry } from '#/shared/logs'

export function useLogs() {
  return useQuery({
    queryKey: qk.logs,
    refetchInterval: 5000,
    queryFn: async () =>
      (await api.get<{ logs: LogEntry[] }>(ApiRoutes.logs)).logs,
  })
}

export type FlowApiResponse = FlowInfoResponse

export function useFlow(name: string, enabled: boolean) {
  return useQuery({
    queryKey: qk.flow(name),
    queryFn: () => api.get<FlowApiResponse>(ApiRoutes.subFlow(name)),
    enabled,
    staleTime: 5 * 60 * 1000,
    retry: false,
  })
}

/** 排序:先乐观重排本地缓存(拖拽落定不闪跳),失败再回滚到服务端数据 */
export function useSortMutation(kind: 'subs' | 'collections' | 'modules') {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (names: string[]) => api.post(ApiRoutes.sort(kind), names),
    onMutate: (names) => {
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
    onError: () => {
      void client.invalidateQueries({ queryKey: qk[kind] })
    },
  })
}
