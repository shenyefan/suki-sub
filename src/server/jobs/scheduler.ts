/**
 * 定时任务入口(cron worker)。
 * 每次 cron 触发:Gist 自动备份(配置了 gistToken 才执行)。
 */
import { gistBackup } from './jobs'
import { writeServerEvent } from '../store/logs'

export async function runScheduledJobs(
  controller: ScheduledController,
  env: Env,
): Promise<void> {
  try {
    const settings = await (
      await import('../store/d1')
    ).getAllSettings(env.SUKI_SUB_DB)
    if (!settings['gistToken']) return
    const result = await gistBackup(env)
    writeServerEvent(
      result.ok ? 'info' : 'error',
      result.ok ? '自动备份完成' : '自动备份失败',
      {
        action: 'backup.scheduled',
        schedule: controller.cron,
        ...(result.detail ? { reason: result.detail } : {}),
      },
    )
  } catch (err) {
    writeServerEvent('error', '自动备份失败', {
      action: 'backup.scheduled',
      reason: err instanceof Error ? err.message : String(err),
    })
  }
}
