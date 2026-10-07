/**
 * 前后端 API 契约(前端重写时直接 import 本文件)。
 *
 * 约定:
 * - 管理接口 /api/*:Authorization: Bearer <OIDC access token>
 * - 分享接口 /s/:id：仅访问绑定的订阅
 * - 成功:直接返回数据 + 恰当 HTTP 状态码;失败:{code,message,...context}
 */

import type {
  Collection,
  ModuleItem,
  Settings,
  Subscription,
  TokenItem,
} from './types'

export interface ApiErrorShape {
  code: string
  message: string
  [key: string]: unknown
}

// --- 登录(浏览器 OIDC 授权码流,HttpOnly cookie 会话) ---
export const AuthRoutes = {
  login: '/auth/login',
  logout: '/auth/logout',
  session: '/auth/session',
} as const

// --- 资源 CRUD ---

export const ApiRoutes = {
  // 订阅
  subs: '/api/subs',
  sub: (name: string) => `/api/subs/${encodeURIComponent(name)}`,
  subFlow: (name: string) => `/api/subs/${encodeURIComponent(name)}/flow`,
  subClone: (name: string) => `/api/subs/${encodeURIComponent(name)}/clone`,
  // 组合
  collections: '/api/collections',
  collection: (name: string) => `/api/collections/${encodeURIComponent(name)}`,
  collectionClone: (name: string) =>
    `/api/collections/${encodeURIComponent(name)}/clone`,
  // 脚本模块
  modules: '/api/modules',
  module: (name: string) => `/api/modules/${encodeURIComponent(name)}`,
  // 设置 / 排序
  settings: '/api/settings',
  sort: (kind: 'subs' | 'collections' | 'modules') => `/api/${kind}/order`,
  // 分享：列表与创建共用一个资源路径
  shares: '/api/shares',
  share: (id: string) => `/api/shares/${encodeURIComponent(id)}`,
  // 工具
  env: '/api/env',
  storage: '/api/backup',
  backupSync: '/api/backup/sync',
  preview: (kind: 'sub' | 'collection') => `/api/preview/${kind}`,
  proxyParse: '/api/parse/nodes',
  ruleParse: '/api/parse/rules',
  ageKeyPair: '/api/age/keys',
  agePublicKey: '/api/age/public-key',
  logs: '/api/logs',
  // 订阅客户端访问一个具体分享。
  shareDownload: (id: string, target?: string) =>
    `/s/${encodeURIComponent(id)}${target ? `/${encodeURIComponent(target)}` : ''}`,
} as const

// --- 请求/响应类型 ---

export type SubsResponse = Subscription[]
export type CollectionsResponse = Collection[]
export type ModulesResponse = ModuleItem[]
export type SettingsResponse = Settings
export type TokensResponse = TokenItem[]

export interface StorageExport {
  version: '1'
  exportedAt: string
  data: {
    subs: Subscription[]
    collections: Collection[]
    modules: ModuleItem[]
    settings: Settings
  }
}

export interface EnvResponse {
  backend: 'Workers'
  version: string
  feature: Record<string, boolean>
}

export interface PreviewResponse {
  added: string[]
  removed: string[]
  changed: string[]
  unchanged: number
}

export interface FlowInfoResponse {
  expires?: number
  total?: number
  usage?: { upload: number; download: number }
  remainingDays?: number
  appUrl?: string
  planName?: string
}

export interface CreateTokenRequest {
  type: 'sub' | 'collection'
  name?: string
  endAt?: number
  count?: number
}

export interface CreateTokenResponse extends TokenItem {}
