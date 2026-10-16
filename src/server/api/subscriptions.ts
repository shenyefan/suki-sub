import { contentDisposition } from './download-metadata'
import { setResourceContext } from '../store/resource-context'
import isEqual from 'lodash/isEqual.js'
import { validateForSave } from '../core/preview-process'
/**
 * 订阅 CRUD:重命名级联(组合成员)、raw 导出。
 */
import { Hono } from 'hono'
import { errorResponse } from './http'
import { withApiStore } from '../store/bootstrap'
import { getEngineStore } from '../store/engine-store'
import {
  createSubscription,
  deleteSubscriptionRefs,
  deleteSubscriptionRow,
  getSubscription,
  listSubscriptions,
  replaceSubscriptions,
  updateSubscriptionRow,
} from '../store/d1'
import { RequestInvalidError, ResourceNotFoundError } from '../core/errors'

const app = new Hono<{ Bindings: Env }>()

/** 创建位置:settings.createItemPosition,默认 bottom */
function createPosition(settings: Record<string, unknown>): 'top' | 'bottom' {
  return settings['createItemPosition'] === 'top' ? 'top' : 'bottom'
}

function assertValidName(name: unknown): asserts name is string {
  if (
    typeof name !== 'string' ||
    !name.trim() ||
    name.includes('/') ||
    name === 'UNTITLED'
  )
    throw new RequestInvalidError(
      'INVALID_NAME',
      '名称不能为空、不能包含 /，且不能使用 UNTITLED',
      { field: 'name' },
    )
}

function duplicateName(name: string) {
  return new RequestInvalidError(
    'DUPLICATE_KEY',
    `订阅名称“${name}”已存在，请使用其他名称`,
    { field: 'name' },
  )
}

app.get('/api/subs', async (c) =>
  withApiStore(c.env, async () => {
    try {
      return c.json(await listSubscriptions(c.env.SUKI_SUB_DB))
    } catch (err) {
      return errorResponse(c, err)
    }
  }),
)

app.post('/api/subs', async (c) =>
  withApiStore(c.env, async () => {
    try {
      const sub = await c.req.json()
      setResourceContext(c, 'sub', sub)
      assertValidName(sub.name)
      const existing = await getSubscription(c.env.SUKI_SUB_DB, sub.name)
      if (existing) throw duplicateName(sub.name)
      await validateForSave('sub', sub)
      const position = createPosition(getEngineStore().settings)
      await createSubscription(c.env.SUKI_SUB_DB, sub, position)
      return c.json(sub, 201)
    } catch (err) {
      return errorResponse(c, err)
    }
  }),
)

app.put('/api/subs', async (c) =>
  withApiStore(c.env, async () => {
    try {
      const subs = await c.req.json()
      if (!Array.isArray(subs))
        throw new RequestInvalidError('INVALID_BODY', '订阅导入内容必须是数组')
      for (const sub of subs) await validateForSave('sub', sub)
      await replaceSubscriptions(c.env.SUKI_SUB_DB, subs)
      return c.json({ replaced: subs.length })
    } catch (err) {
      return errorResponse(c, err)
    }
  }),
)

app.get('/api/subs/:name', async (c) =>
  withApiStore(c.env, async () => {
    try {
      const sub = await getSubscription(c.env.SUKI_SUB_DB, c.req.param('name'))
      if (!sub)
        throw new ResourceNotFoundError(
          'SUBSCRIPTION_NOT_FOUND',
          `Subscription ${c.req.param('name')} does not exist`,
        )
      if (c.req.query('raw')) {
        return new Response(JSON.stringify(sub, null, 2), {
          headers: {
            'content-type': 'application/json',
            'content-disposition': contentDisposition(
              `suki-sub_subscription_${sub.name}.json`,
            ),
          },
        })
      }
      return c.json(sub)
    } catch (err) {
      return errorResponse(c, err)
    }
  }),
)

app.patch('/api/subs/:name', async (c) =>
  withApiStore(c.env, async () => {
    try {
      const name = c.req.param('name')
      const patch = await c.req.json()
      delete (patch as Record<string, unknown>)['subscriptions']
      const old = await getSubscription(c.env.SUKI_SUB_DB, name)
      if (!old)
        throw new ResourceNotFoundError(
          'RESOURCE_NOT_FOUND',
          `Subscription ${name} does not exist!`,
        )
      const merged = { ...old, ...patch }
      assertValidName(merged.name)
      if (
        merged.name !== name &&
        (await getSubscription(c.env.SUKI_SUB_DB, merged.name))
      )
        throw duplicateName(merged.name)
      if (merged.name !== name)
        c.set(
          'operationDetails' as never,
          {
            previousName: name,
            resourceName: merged.name,
            resourceDisplayName: merged.displayName,
            renamed: true,
          } as never,
        )
      setResourceContext(c, 'sub', merged)
      c.set('operationUnchanged' as never, isEqual(old, merged) as never)
      await validateForSave('sub', merged, old)
      try {
        await updateSubscriptionRow(
          c.env.SUKI_SUB_DB,
          name,
          merged,
          merged.name,
        )
      } catch (err) {
        if (
          /UNIQUE constraint failed/.test(
            err instanceof Error ? err.message : String(err),
          )
        )
          throw duplicateName(merged.name)
        throw err
      }
      return c.json(merged)
    } catch (err) {
      return errorResponse(c, err)
    }
  }),
)

app.delete('/api/subs/:name', async (c) =>
  withApiStore(c.env, async () => {
    try {
      const name = c.req.param('name')
      const sub = await getSubscription(c.env.SUKI_SUB_DB, name)
      if (!sub)
        throw new ResourceNotFoundError(
          'RESOURCE_NOT_FOUND',
          `Subscription ${name} does not exist!`,
        )
      setResourceContext(c, 'sub', sub)
      await deleteSubscriptionRefs(c.env.SUKI_SUB_DB, name)
      await deleteSubscriptionRow(c.env.SUKI_SUB_DB, name)
      return c.json({
        deleted: true,
        name: sub.name,
        displayName: sub.displayName,
      })
    } catch (err) {
      return errorResponse(c, err)
    }
  }),
)

/** 克隆订阅:全量复制配置为新条目;body 可选 { name },缺省 `${name}-copy` 并自动去重 */
app.post('/api/subs/:name/clone', async (c) =>
  withApiStore(c.env, async () => {
    try {
      const name = c.req.param('name')
      const src = await getSubscription(c.env.SUKI_SUB_DB, name)
      if (!src)
        throw new ResourceNotFoundError(
          'RESOURCE_NOT_FOUND',
          `Subscription ${name} does not exist!`,
        )
      const body = (await c.req.json().catch(() => ({}))) as {
        name?: unknown
      }
      const baseName =
        typeof body.name === 'string' && body.name.trim()
          ? body.name.trim()
          : `${name}-copy`
      if (baseName.includes('/'))
        throw new RequestInvalidError(
          'INVALID_NAME',
          `name ${baseName} is invalid`,
        )
      let newName = baseName
      let suffix = 2
      while (await getSubscription(c.env.SUKI_SUB_DB, newName)) {
        newName = `${baseName}-${suffix++}`
        if (suffix > 99)
          throw new RequestInvalidError(
            'CLONE_NAME_EXHAUSTED',
            `Cannot find an unused clone name for ${baseName}`,
          )
      }
      const clone = { ...src, name: newName }
      setResourceContext(c, 'sub', clone)
      await validateForSave('sub', clone)
      const position = createPosition(getEngineStore().settings)
      await createSubscription(c.env.SUKI_SUB_DB, clone, position)
      return c.json(clone, 201)
    } catch (err) {
      return errorResponse(c, err)
    }
  }),
)

export default app
