import { useId } from 'react'
import type { ReactNode } from 'react'
import { SwitchField } from './switch-field'
import { Label } from '#/components/ui/label'
import { cn } from '#/lib/utils'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'

export interface SubscriptionBehavior {
  ignoreIncompatibleOperations?: boolean
  telegramEnabled?: boolean
  telegramNotifySuccess?: boolean
}

/** Telegram 通知范围选择:独立字段,可与其他表单项并排进网格。 */
export function SubscriptionNotificationField({
  value,
  onChange,
  id,
  className,
}: {
  value: Pick<SubscriptionBehavior, 'telegramEnabled' | 'telegramNotifySuccess'>
  onChange: (patch: Partial<SubscriptionBehavior>) => void
  id?: string
  className?: string
}) {
  const generatedId = useId()
  const controlId = id ?? generatedId
  const notification =
    value.telegramEnabled !== true
      ? 'off'
      : value.telegramNotifySuccess === true
        ? 'all'
        : 'errors'
  return (
    <div className={cn('grid min-w-0 content-start gap-2', className)}>
      <Label htmlFor={controlId}>Telegram 通知</Label>
      <Select
        value={notification}
        onValueChange={(mode) =>
          onChange({
            telegramEnabled: mode !== 'off',
            telegramNotifySuccess: mode === 'all',
          })
        }
      >
        <SelectTrigger id={controlId} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="off">关闭</SelectItem>
          <SelectItem value="errors">仅异常</SelectItem>
          <SelectItem value="all">全部</SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}

export function SubscriptionBehaviorFields({
  value,
  onChange,
  children,
}: {
  value: SubscriptionBehavior
  children?: ReactNode
  onChange: (patch: Partial<SubscriptionBehavior>) => void
}) {
  return (
    <div className="grid border-t pt-3">
      {children}
      <SwitchField
        label="忽略格式不匹配"
        checked={value.ignoreIncompatibleOperations === true}
        onCheckedChange={(checked) =>
          onChange({ ignoreIncompatibleOperations: checked })
        }
      />
    </div>
  )
}
