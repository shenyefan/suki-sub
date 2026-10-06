/**
 * 前后端共享的资源类型:已知字段显式声明,演进字段走索引签名。
 */

/** 操作符:管线中的一个处理步骤,如 flag / sort / filter / script / rename 等 */
export interface Operator {
  type: string
  [key: string]: unknown
}

/** 订阅(对应 D1 subscriptions 表) */
export interface Subscription {
  name: string
  /** 远程订阅地址;本地订阅(source=local)可为空 */
  url?: string
  /** 拉取订阅使用的 User-Agent;缺省用引擎默认 */
  ua?: string
  /** 多源合并策略:localFirst / remoteFirst(本地订阅 + 远程 URL 合并) */
  mergeSources?: string
  /** 管线操作符列表 */
  process?: Operator[]
  ignoreIncompatibleOperations?: boolean
  telegramEnabled?: boolean
  telegramNotifySuccess?: boolean
  /** 本地订阅内容 */
  content?: string
  /** source=local 时表示本地订阅 */
  source?: string
  /** 自定义流量信息头(subscription-userinfo)或其获取地址 */
  subUserinfo?: string
  /** 跳过流量信息 */
  noFlow?: boolean
  /** 忽略失败的远程子订阅(多 URL 场景) */
  ignoreFailedRemoteSub?: boolean
  /** age 公钥配置(加密订阅) */
  agePublicKey?: string
  displayName?: string
  icon?: string
  /** 图标是否彩色(缺省为彩色) */
  isIconColor?: boolean
  /** 图标适配方式:contain / cover / fill(原版 iconFit) */
  iconFit?: string
  img?: string
  /** 前端展示用备注 */
  remark?: string
  /** 前端展示用标签 */
  tag?: string[]
  /** 额外元数据,前端自定义展示等 */
  subscribeMetadata?: Record<string, unknown>
  [key: string]: unknown
}

/** 组合(对应 collections + collection_sources 表) */
export interface Collection {
  name: string
  /** 成员列表:已保存订阅的 name,或远程 URL(引擎按是否以 http 开头区分) */
  subscriptions: string[]
  process?: Operator[]
  ignoreIncompatibleOperations?: boolean
  telegramEnabled?: boolean
  telegramNotifySuccess?: boolean
  displayName?: string
  icon?: string
  img?: string
  isIconColor?: boolean
  iconFit?: string
  /** 详情/卡片显示第一个成员的流量信息(原版 firstSubFlow) */
  firstSubFlow?: boolean
  remark?: string
  tag?: string[]
  [key: string]: unknown
}

/** 产出目标平台(下载直链的 target 参数) */
export type TargetPlatform =
  | 'JSON'
  | 'clash'
  | 'clashmeta'
  | 'surge'
  | 'surgemac'
  | 'loon'
  | 'stash'
  | 'qx'
  | 'shadowrocket'
  | 'surfboard'
  | 'sing-box'
  | 'egern'
  | 'v2ray'
  | 'uri'

/** 脚本模块(对应 modules 表) */
export interface ModuleItem {
  name: string
  content: string
  [key: string]: unknown
}

/** 订阅分享凭据(存 KV,用于 /s/:id) */
export interface TokenItem {
  id: string
  /** 绑定的订阅类型 */
  type: 'sub' | 'collection'
  /** 绑定的订阅名称 */
  name: string
  /** 创建时间(毫秒时间戳;历史数据可能缺失) */
  createdAt?: number
  /** 时长过期(毫秒时间戳) */
  endAt?: number
  /** 次数过期 */
  count?: number
  usedCount?: number
  [key: string]: unknown
}

/** 设置(嵌套 JSON,按顶层键存 settings 表) */
export type Settings = Record<string, unknown>
