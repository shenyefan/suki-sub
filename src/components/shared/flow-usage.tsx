/** 流量信息:卡片内容行用的单行紧凑文本(完整信息放 title 悬浮) */
import {
  flowPercent,
  flowRemainingDays,
  flowText,
  formatBytes,
  formatDateTime,
} from '#/lib/format'
import { Progress } from '#/components/ui/progress'
import type { FlowInfo } from '#/lib/format'

export function FlowUsageLine({ flow }: { flow: FlowInfo }) {
  const percent = flowPercent(flow)
  const days = flowRemainingDays(flow)
  const parts: string[] = []
  if (percent != null) parts.push(`已用 ${percent}%`)
  parts.push(flowText(flow))
  if (days != null) parts.push(days > 0 ? `剩 ${days} 天` : '已到期')
  const text = parts.join(' · ')
  return (
    <span className="w-full truncate" title={text}>
      {text}
    </span>
  )
}

/** The usage bar keeps details in a tooltip, alongside optional card remarks. */
export function FlowUsageProgress({ flow }: { flow: FlowInfo }) {
  const percent = flowPercent(flow)
  if (
    percent == null ||
    !Number.isFinite(percent) ||
    percent < 0 ||
    !Number.isFinite(flow.total) ||
    !(flow.total! > 0)
  )
    return null
  const used = (flow.upload ?? 0) + (flow.download ?? 0)
  const expire = flow.expires ?? flow.expire
  const days = flowRemainingDays(flow)
  return (
    <Progress
      value={percent}
      className="h-1.5 w-full [&_[data-slot=progress-indicator]]:motion-reduce:transition-none"
      aria-label="流量使用情况"
      getValueLabel={() => `已用 ${percent}%：${flowText(flow)}`}
      tooltip={
        <div className="min-w-44 space-y-2">
          <p className="font-medium">流量使用 · {percent}%</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 [&_dd]:text-right">
            <dt>已用</dt>
            <dd>{formatBytes(used)}</dd>
            <dt>总额度</dt>
            <dd>{formatBytes(flow.total)}</dd>
            <dt>剩余</dt>
            <dd>{formatBytes(Math.max(0, flow.total! - used))}</dd>
            <dt>上传</dt>
            <dd>{formatBytes(flow.upload ?? 0)}</dd>
            <dt>下载</dt>
            <dd>{formatBytes(flow.download ?? 0)}</dd>
            {expire != null && Number.isFinite(expire) && expire > 0 && (
              <>
                <dt>到期时间</dt>
                <dd>{formatDateTime(expire * 1000)}</dd>
              </>
            )}
            {days != null && (
              <>
                <dt>有效期</dt>
                <dd>{days > 0 ? `剩余 ${days} 天` : '已到期'}</dd>
              </>
            )}
          </dl>
        </div>
      }
    />
  )
}
