/**
 * 节点操作符注册表:与后端引擎(PROXY_PROCESSORS)一一对应。
 * args 序列化形状:
 * - Sort Operator 为裸字符串;Regex Rename/Delete 为数组;其余为对象
 */

export type OperatorCategory = '操作' | '过滤' | '响应'

export interface OperatorDef {
  type: string
  label: string
  category: OperatorCategory
  description: string
  defaultArgs: () => unknown
}

export const OPERATORS: OperatorDef[] = [
  {
    type: 'Quick Setting Operator',
    label: '快捷设置',
    category: '操作',
    description: '批量设置节点常用开关(UDP、TFO、跳过证书验证等)',
    defaultArgs: () => ({}),
  },
  {
    type: 'Flag Operator',
    label: '旗帜操作',
    category: '操作',
    description: '为节点名添加或移除地区旗帜 Emoji',
    defaultArgs: () => ({ mode: 'add', tw: 'cn' }),
  },
  {
    type: 'Sort Operator',
    label: '节点排序',
    category: '操作',
    description: '按节点名排序(正序 / 逆序 / 随机)',
    defaultArgs: () => 'asc',
  },
  {
    type: 'Regex Sort Operator',
    label: '正则排序',
    category: '操作',
    description: '按正则匹配顺序排序,匹配第一个的排最前',
    defaultArgs: () => ({ expressions: [], order: 'asc' }),
  },
  {
    type: 'Regex Rename Operator',
    label: '正则命名',
    category: '操作',
    description: '按正则表达式替换节点名中的字段',
    defaultArgs: () => [],
  },
  {
    type: 'Regex Delete Operator',
    label: '正则删除',
    category: '操作',
    description: '按正则表达式删除节点名中的字段',
    defaultArgs: () => [],
  },
  {
    type: 'Handle Duplicate Operator',
    label: '节点去重',
    category: '操作',
    description: '对重名节点重命名(加序号)或删除',
    defaultArgs: () => ({
      action: 'rename',
      template: '0 1 2 3 4 5 6 7 8 9',
      link: '-',
      position: 'back',
      field: ['name'],
    }),
  },
  {
    type: 'Script Operator',
    label: '脚本操作',
    category: '操作',
    description: '用 JavaScript 脚本修改节点信息',
    defaultArgs: () => ({ mode: 'link', content: '' }),
  },
  {
    type: 'Resolve Domain Operator',
    label: '域名解析',
    category: '操作',
    description: '把节点域名解析为 IP,减少客户端 DNS 请求',
    defaultArgs: () => ({
      provider: 'Custom',
      type: 'IPv4',
      filter: 'disabled',
      cache: 'enabled',
      tlsSkipCertVerify: 'disabled',
    }),
  },
  {
    type: 'Region Filter',
    label: '区域过滤',
    category: '过滤',
    description: '按国家 / 地区旗帜过滤节点',
    defaultArgs: () => ({ value: [], keep: true }),
  },
  {
    type: 'Type Filter',
    label: '协议过滤',
    category: '过滤',
    description: '按代理协议类型过滤节点',
    defaultArgs: () => ({ value: [], keep: true }),
  },
  {
    type: 'Regex Filter',
    label: '正则过滤',
    category: '过滤',
    description: '按正则表达式过滤节点',
    defaultArgs: () => ({ regex: [], keep: true }),
  },
  {
    type: 'Script Filter',
    label: '脚本过滤',
    category: '过滤',
    description: '用 JavaScript 脚本决定保留哪些节点',
    defaultArgs: () => ({ mode: 'link', content: '' }),
  },
  {
    type: 'Response Transformer',
    label: '修改响应',
    category: '响应',
    description: '下载响应前修改状态码、响应头或响应体',
    defaultArgs: () => ({ mode: 'link', content: '' }),
  },
]

export const OPERATOR_LABELS: Record<string, string> = Object.fromEntries(
  OPERATORS.map((o) => [o.type, o.label]),
)

/** process 项(引擎保留未知字段,因此 id/customName/disabled 可随项存储) */
export interface ProcessItem {
  type: string
  args?: unknown
  id?: string
  customName?: string
  disabled?: boolean
  [key: string]: unknown
}

export const REGIONS = ['HK', 'TW', 'SG', 'JP', 'UK', 'US', 'DE', 'KR'] as const
export const REGION_FLAGS: Record<string, string> = {
  HK: '🇭🇰',
  TW: '🇹🇼',
  SG: '🇸🇬',
  JP: '🇯🇵',
  UK: '🇬🇧',
  US: '🇺🇸',
  DE: '🇩🇪',
  KR: '🇰🇷',
}

export const PROXY_TYPES = [
  'ss',
  'ssr',
  'vmess',
  'vless',
  'trojan',
  'http',
  'h2-connect',
  'socks5',
  'snell',
  'tuic',
  'hysteria',
  'hysteria2',
  'juicity',
  'mieru',
  'sudoku',
  'masque',
  'masque-surge',
  'shadowquic',
  'naive',
  'anytls',
  'trusttunnel',
  'openvpn',
  'gost-relay',
  'zerotier',
  'tailscale',
  'easytier',
  'wireguard',
  'ssh',
  'external',
  'direct',
] as const
