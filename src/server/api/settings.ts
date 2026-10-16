import { lastTelegramFailure } from '../store/logs'
import isEqual from 'lodash/isEqual.js'
/**
 * 设置读写与资源排序。
 */
import { Hono } from 'hono'
import { telegramConfigurationState } from '../notifications/telegram'
import { errorResponse, failureResponse } from './http'
import { withApiStore } from '../store/bootstrap'
import { getAllSettings, reorderTable, saveSettings } from '../store/d1'
import { getEngineStore } from '../store/engine-store'
import { resourceLabel } from '#/lib/resource-display'
import { RequestInvalidError } from '../core/errors'
import {
  TELEGRAM_NOTIFICATIONS,
  telegramCategoryMode,
  telegramMasterMode,
} from '#/shared/telegram-notifications'

const app = new Hono<{ Bindings: Env }>()

app.get('/api/settings', async (c) =>
  withApiStore(c.env, async () => {
    try {
      return c.json({
        ...(await getAllSettings(c.env.SUKI_SUB_DB)),
        telegramConfiguration: telegramConfigurationState(c.env),
        telegramLastFailure: await lastTelegramFailure(c.env.SUKI_SUB_DB).catch(
          () => null,
        ),
      })
    } catch (err) {
      return errorResponse(c, err)
    }
  }),
)

app.patch('/api/settings', async (c) =>
  withApiStore(c.env, async () => {
    try {
      const patch = await c.req.json()
      delete patch.telegramConfiguration
      delete patch.telegramLastFailure
      if (
        patch.telegramEnabled != null &&
        typeof patch.telegramEnabled !== 'boolean'
      )
        throw new RequestInvalidError(
          'INVALID_NOTIFICATION_MODE',
          '通知总开关必须是开启或关闭',
          { field: 'telegramEnabled' },
        )
      for (const key of [
        'telegramNotificationMode',
        ...TELEGRAM_NOTIFICATIONS.map((item) => item.key),
      ]) {
        const value = patch[key]
        if (
          value != null &&
          !['off', 'errors', 'all'].includes(value) &&
          !(key !== 'telegramNotificationMode' && typeof value === 'boolean')
        )
          throw new RequestInvalidError(
            'INVALID_NOTIFICATION_MODE',
            '通知范围必须是关闭、仅异常或全部',
            { field: key },
          )
      }
      const current = await getAllSettings(c.env.SUKI_SUB_DB)
      const next = { ...current, ...patch }
      const categories = [
        { key: 'telegramNotificationMode', label: '通知总开关' },
        ...TELEGRAM_NOTIFICATIONS,
      ]
      const notificationChanges = categories.flatMap((item) => {
        const before =
          item.key === 'telegramNotificationMode'
            ? telegramMasterMode(current)
            : telegramCategoryMode(current, item.key)
        const after =
          item.key === 'telegramNotificationMode'
            ? telegramMasterMode(next)
            : telegramCategoryMode(next, item.key)
        return before === after ? [] : [{ label: item.label, before, after }]
      })
      const changedFields = Object.keys(patch).filter((key) => {
        if (
          key === 'telegramEnabled' ||
          categories.some((item) => item.key === key)
        )
          return false
        return !isEqual(current[key], patch[key])
      })
      c.set(
        'operationDetails' as never,
        {
          changedFields,
          notificationChanges,
        } as never,
      )
      c.set(
        'operationUnchanged' as never,
        (changedFields.length === 0 &&
          notificationChanges.length === 0) as never,
      )
      await saveSettings(c.env.SUKI_SUB_DB, { ...current, ...patch })
      return c.json({
        ...(await getAllSettings(c.env.SUKI_SUB_DB)),
        telegramConfiguration: telegramConfigurationState(c.env),
        telegramLastFailure: await lastTelegramFailure(c.env.SUKI_SUB_DB).catch(
          () => null,
        ),
      })
    } catch (err) {
      return errorResponse(c, err)
    }
  }),
)

app.post('/api/:kind/order', async (c) =>
  withApiStore(c.env, async () => {
    try {
      const kind = c.req.param('kind')
      const table =
        kind === 'subs'
          ? 'subscriptions'
          : kind === 'collections'
            ? 'collections'
            : kind === 'modules'
              ? 'modules'
              : null
      if (!table) {
        return failureResponse(c, 'INVALID_KIND', '不支持的排序类型', 400)
      }
      const names = await c.req.json()
      if (
        !Array.isArray(names) ||
        names.some((name) => typeof name !== 'string' || !name.trim()) ||
        new Set(names).size !== names.length
      )
        throw new RequestInvalidError(
          'INVALID_ORDER',
          '排序列表必须包含不重复的资源名称',
        )
      const store = getEngineStore()
      const resources =
        kind === 'subs'
          ? store.subs
          : kind === 'collections'
            ? store.collections
            : store.modules
      if (names.some((name) => !resources.some((item) => item.name === name)))
        throw new RequestInvalidError(
          'INVALID_ORDER',
          '排序列表包含不存在的资源',
        )
      const selected = new Set(names)
      let index = 0
      const orderedNames = resources.map((item) =>
        selected.has(item.name) ? names[index++] : item.name,
      )
      await reorderTable(c.env.SUKI_SUB_DB, table, orderedNames)
      return c.json({
        sorted: true,
        order: orderedNames.map((name: string) =>
          resourceLabel(
            resources.find((item) => item.name === name),
            name,
          ),
        ),
      })
    } catch (err) {
      return errorResponse(c, err)
    }
  }),
)

export default app
