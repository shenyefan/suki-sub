import isEqual from 'lodash/isEqual.js'
import { RequestInvalidError } from '../core/errors'
import type { Collection, Subscription } from '#/shared/types'

/** 上游故障时也能关闭通知；仅改通知选项不需要重新下载、解析订阅。 */
export function isNotificationOnlyChange(
  previous: Subscription | Collection,
  next: Subscription | Collection,
): boolean {
  const content = (resource: Subscription | Collection) => ({
    ...Object.fromEntries(
      Object.entries(resource).filter(
        ([key, value]) =>
          value !== undefined &&
          ![
            'telegramNotificationMode',
            'telegramEnabled',
            'telegramNotifySuccess',
          ].includes(key),
      ),
    ),
    process: resource.process ?? [],
  })
  return isEqual(content(previous), content(next))
}

export function assertNotificationMode(value: unknown): void {
  if (
    value != null &&
    !['inherit', 'off', 'errors', 'all'].includes(String(value))
  )
    throw new RequestInvalidError(
      'INVALID_NOTIFICATION_MODE',
      '拉取通知必须是跟随全局、关闭、仅异常或全部',
      { field: 'telegramNotificationMode' },
    )
}
