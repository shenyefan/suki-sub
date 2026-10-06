import { useId } from 'react'
import type { ReactNode } from 'react'
import { SwitchField } from './switch-field'
import { Label } from '#/components/ui/label'
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

export function SubscriptionBehaviorFields({
  value,
  onChange,
  children,
}: {
  value: SubscriptionBehavior
  children?: ReactNode
  onChange: (patch: Partial<SubscriptionBehavior>) => void
}) {
  const id = useId()
  const notification =
    value.telegramEnabled !== true
      ? 'off'
      : value.telegramNotifySuccess === true
        ? 'all'
        : 'errors'
  return (
    <div className="grid gap-3 border-t pt-3">
      <div className="grid">
        {children}
        <SwitchField
          label="忽略格式不匹配"
          checked={value.ignoreIncompatibleOperations === true}
          onCheckedChange={(checked) =>
            onChange({ ignoreIncompatibleOperations: checked })
          }
        />
      </div>
      <div className="grid min-w-0 gap-2 border-t pt-4">
        <Label htmlFor={id}>Telegram 通知</Label>
        <Select
          value={notification}
          onValueChange={(mode) =>
            onChange({
              telegramEnabled: mode !== 'off',
              telegramNotifySuccess: mode === 'all',
            })
          }
        >
          <SelectTrigger id={id} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="off">关闭</SelectItem>
            <SelectItem value="errors">仅异常</SelectItem>
            <SelectItem value="all">全部</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}
