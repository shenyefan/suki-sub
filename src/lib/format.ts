import type { FlowInfoResponse } from '#/shared/api-contract'

/** 展示层格式化工具 */

export function formatBytes(bytes?: number): string {
  if (bytes == null || Number.isNaN(bytes)) return '-'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = -1
  do {
    value /= 1024
    unit++
  } while (value >= 1024 && unit < units.length - 1)
  return `${value.toFixed(2)} ${units[unit]}`
}

export function formatDateTime(input?: string | number): string {
  if (input == null) return '-'
  const date = typeof input === 'number' ? new Date(input) : new Date(input)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString('zh-CN', { hour12: false })
}

/** 流量信息(su-sub flow API 返回)解析为进度条数据 */
export type FlowInfo = FlowInfoResponse

export function flowPercent(flow: FlowInfo): number | null {
  const used = (flow.usage?.upload ?? 0) + (flow.usage?.download ?? 0)
  const total = flow.total ?? 0
  if (!total) return null
  return Math.min(100, Math.round((used / total) * 100))
}

export function flowRemainingDays(flow: FlowInfo): number | null {
  const expire = flow.expires
  if (!expire) return null
  const days = Math.ceil((expire * 1000 - Date.now()) / 86400000)
  return days
}

export function flowText(flow: FlowInfo): string {
  const used = (flow.usage?.upload ?? 0) + (flow.usage?.download ?? 0)
  return `${formatBytes(used)} / ${formatBytes(flow.total)}`
}

/** 秒级剩余时长转 "x 天 x 小时" */
export function formatCountdown(seconds?: number): string {
  if (seconds == null || seconds <= 0) return '-'
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  if (days > 0) return `${days} 天${hours ? ` ${hours} 小时` : ''}`
  const minutes = Math.floor((seconds % 3600) / 60)
  if (hours > 0) return `${hours} 小时 ${minutes} 分`
  return `${minutes} 分 ${Math.floor(seconds % 60)} 秒`
}
