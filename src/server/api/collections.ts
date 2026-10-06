import { setResourceContext } from '../store/resource-context'
import isEqual from 'lodash/isEqual.js'
import { validateForSave } from '../core/preview-process'
/**
 * 组合 CRUD。
 */
import { Hono } from 'hono'
import { errorResponse } from './http'
import { withApiStore } from '../store/bootstrap'
import { getEngineStore } from '../store/engine-store'
import {
  createCollection,
  deleteCollectionRefs,
  deleteCollectionRow,
  getCollection,
  listCollections,
  renameCollectionRefs,
  updateCollectionRow,
} from '../store/d1'
import { RequestInvalidError, ResourceNotFoundError } from '../core/errors'

const app = new Hono<{ Bindings: Env }>()

function createPosition(settings: Record<string, unknown>): 'top' | 'bottom' {
  return settings['createItemPosition'] === 'top' ? 'top' : 'bottom'
}

function assertValidName(name: string) {
  if (!name || /\//.test(name))
    throw new RequestInvalidError(
      'INVALID_NAME',
      `Collection name ${name} is invalid`,
    )
}

app.get('/api/collections', async (c) =>
  withApiStore(c.env, async () => {
    try {
      return c.json(await listCollections(c.env.SUKI_SUB_DB))
    } catch (err) {
      return errorResponse(c, err)
    }
  }),
)

app.post('/api/collections', async (c) =>
  withApiStore(c.env, async () => {
    try {
      const col = await c.req.json()
      setResourceContext(c, 'collection', col)
      assertValidName(col.name)
      if (await getCollection(c.env.SUKI_SUB_DB, col.name)) {
        throw new RequestInvalidError(
          'DUPLICATE_KEY',
          `Collection ${col.name} already exists.`,
        )
      }
      await validateForSave('collection', col)
      await createCollection(
        c.env.SUKI_SUB_DB,
        col,
        createPosition(getEngineStore().settings),
      )
      return c.json(col, 201)
    } catch (err) {
      return errorResponse(c, err)
    }
  }),
)

app.get('/api/collections/:name', async (c) =>
  withApiStore(c.env, async () => {
    try {
      const col = await getCollection(c.env.SUKI_SUB_DB, c.req.param('name'))
      if (!col)
        throw new ResourceNotFoundError(
          'COLLECTION_NOT_FOUND',
          `Collection ${c.req.param('name')} does not exist`,
        )
      return c.json(col)
    } catch (err) {
      return errorResponse(c, err)
    }
  }),
)

app.patch('/api/collections/:name', async (c) =>
  withApiStore(c.env, async () => {
    try {
      const name = c.req.param('name')
      const patch = await c.req.json()
      const old = await getCollection(c.env.SUKI_SUB_DB, name)
      if (!old)
        throw new ResourceNotFoundError(
          'RESOURCE_NOT_FOUND',
          `Collection ${name} does not exist!`,
        )
      const merged = {
        ...old,
        ...patch,
        name: patch.name ?? old.name,
      }
      assertValidName(merged.name)
      setResourceContext(c, 'collection', merged)
      c.set('operationUnchanged' as never, isEqual(old, merged) as never)
      await validateForSave('collection', merged)
      if (name !== merged.name)
        await renameCollectionRefs(c.env.SUKI_SUB_DB, name, merged.name)
      await updateCollectionRow(c.env.SUKI_SUB_DB, name, merged, merged.name)
      return c.json(merged)
    } catch (err) {
      return errorResponse(c, err)
    }
  }),
)

app.delete('/api/collections/:name', async (c) =>
  withApiStore(c.env, async () => {
    try {
      const name = c.req.param('name')
      const col = await getCollection(c.env.SUKI_SUB_DB, name)
      if (!col)
        throw new ResourceNotFoundError(
          'RESOURCE_NOT_FOUND',
          `Collection ${name} does not exist!`,
        )
      await deleteCollectionRefs(c.env.SUKI_SUB_DB, name)
      setResourceContext(c, 'collection', col)
      await deleteCollectionRow(c.env.SUKI_SUB_DB, name)
      return c.json({
        deleted: true,
        name: col.name,
        displayName: col.displayName,
      })
    } catch (err) {
      return errorResponse(c, err)
    }
  }),
)

/** 克隆组合:全量复制(含成员与操作符)为新条目;body 可选 { name },缺省自动去重 */
app.post('/api/collections/:name/clone', async (c) =>
  withApiStore(c.env, async () => {
    try {
      const name = c.req.param('name')
      const src = await getCollection(c.env.SUKI_SUB_DB, name)
      if (!src)
        throw new ResourceNotFoundError(
          'RESOURCE_NOT_FOUND',
          `Collection ${name} does not exist!`,
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
      while (await getCollection(c.env.SUKI_SUB_DB, newName)) {
        newName = `${baseName}-${suffix++}`
        if (suffix > 99)
          throw new RequestInvalidError(
            'CLONE_NAME_EXHAUSTED',
            `Cannot find an unused clone name for ${baseName}`,
          )
      }
      const clone = { ...src, name: newName }
      setResourceContext(c, 'collection', clone)
      await validateForSave('collection', clone)
      await createCollection(
        c.env.SUKI_SUB_DB,
        clone,
        createPosition(getEngineStore().settings),
      )
      return c.json(clone, 201)
    } catch (err) {
      return errorResponse(c, err)
    }
  }),
)

export default app
