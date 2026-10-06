/**
 * 脚本模块 CRUD。
 */
import { Hono } from 'hono'
import { errorResponse } from './http'
import { withApiStore } from '../store/bootstrap'
import {
  createModule,
  deleteModuleRow,
  getModule,
  listModules,
  updateModuleRow,
} from '../store/d1'
import { RequestInvalidError, ResourceNotFoundError } from '../core/errors'

const app = new Hono<{ Bindings: Env }>()

function assertValidName(name: string) {
  if (!name || /\//.test(name))
    throw new RequestInvalidError('INVALID_NAME', `name ${name} is invalid`)
}

// --- modules ---

app.get('/api/modules', async (c) =>
  withApiStore(c.env, async () => {
    try {
      return c.json(await listModules(c.env.SUKI_SUB_DB))
    } catch (err) {
      return errorResponse(c, err)
    }
  }),
)

app.post('/api/modules', async (c) =>
  withApiStore(c.env, async () => {
    try {
      const m = await c.req.json()
      assertValidName(m.name)
      if (await getModule(c.env.SUKI_SUB_DB, m.name)) {
        throw new RequestInvalidError(
          'DUPLICATE_KEY',
          `Module ${m.name} already exists.`,
        )
      }
      await createModule(c.env.SUKI_SUB_DB, m)
      return c.json(m, 201)
    } catch (err) {
      return errorResponse(c, err)
    }
  }),
)

app.get('/api/modules/:name', async (c) =>
  withApiStore(c.env, async () => {
    try {
      const m = await getModule(c.env.SUKI_SUB_DB, c.req.param('name'))
      if (!m)
        throw new ResourceNotFoundError(
          'MODULE_NOT_FOUND',
          `Module ${c.req.param('name')} does not exist`,
        )
      return c.json(m)
    } catch (err) {
      return errorResponse(c, err)
    }
  }),
)

app.patch('/api/modules/:name', async (c) =>
  withApiStore(c.env, async () => {
    try {
      const name = c.req.param('name')
      const patch = await c.req.json()
      const old = await getModule(c.env.SUKI_SUB_DB, name)
      if (!old)
        throw new ResourceNotFoundError(
          'RESOURCE_NOT_FOUND',
          `Module ${name} does not exist!`,
        )
      const merged = {
        ...old,
        ...patch,
        name: patch.name ?? old.name,
      }
      await updateModuleRow(c.env.SUKI_SUB_DB, name, merged, merged.name)
      return c.json(merged)
    } catch (err) {
      return errorResponse(c, err)
    }
  }),
)

app.delete('/api/modules/:name', async (c) =>
  withApiStore(c.env, async () => {
    try {
      const name = c.req.param('name')
      if (!(await getModule(c.env.SUKI_SUB_DB, name))) {
        throw new ResourceNotFoundError(
          'RESOURCE_NOT_FOUND',
          `Module ${name} does not exist!`,
        )
      }
      await deleteModuleRow(c.env.SUKI_SUB_DB, name)
      return c.json({ deleted: true })
    } catch (err) {
      return errorResponse(c, err)
    }
  }),
)

export default app
