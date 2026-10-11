/**
 * 前后端共享常量。
 */

/** KV 键前缀 */
export const KV_PREFIX = {
  resourceCache: 'cache:resource:',
} as const

/** 缓存 TTL(毫秒;写 KV 时换算为秒) */
export const CACHE_TTL = {
  /** 远程订阅内容缓存:1 小时 */
  resourceMs: 60 * 60 * 1000,
} as const

/** API 错误响应统一形状 */
export interface ApiError {
  error: {
    code: string
    message: string
    details?: unknown
  }
}

/** 目标平台别名(产出时归一化) */
export const TARGET_ALIASES: Record<string, string> = {
  QX: 'qx',
  QuantumultX: 'qx',
  Quantumult_X: 'qx',
  Surge: 'surge',
  SurgeMac: 'surgemac',
  Loon: 'loon',
  Clash: 'clash',
  meta: 'clashmeta',
  'clash.meta': 'clashmeta',
  'Clash.Meta': 'clashmeta',
  ClashMeta: 'clashmeta',
  mihomo: 'clashmeta',
  Mihomo: 'clashmeta',
  Stash: 'stash',
  Shadowrocket: 'shadowrocket',
  ShadowRocket: 'shadowrocket',
  Surfboard: 'surfboard',
  'sing-box': 'sing-box',
  singbox: 'sing-box',
  SingBox: 'sing-box',
  Egern: 'egern',
  URI: 'uri',
  V2Ray: 'v2ray',
  v2: 'v2ray',
  JSON: 'JSON',
  json: 'JSON',
}
