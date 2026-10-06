import { setResourceContext } from '../store/resource-context'
/**
 * 预览与调试接口:preview(产出对比)、parse(解析)。
 */
import { previewProcess } from '../core/preview-process'
import { Hono } from 'hono'
import { errorResponse } from './http'
import { withApiStore } from '../store/bootstrap'
import { produceArtifact } from '../core/produce-artifact'
import { ProxyUtils } from '../core/proxy-utils/index'
import { RuleUtils } from '../core/rule-utils/index'
import { RequestInvalidError } from '../core/errors'

const app = new Hono<{ Bindings: Env }>()

interface PreviewSource {
  name?: string
  url?: string
  content?: string
}

/** 两个来源的节点增删改对比 */
app.post('/api/preview/:kind', async (c) =>
  withApiStore(c.env, async () => {
    try {
      const kind = c.req.param('kind')
      if (kind !== 'sub' && kind !== 'collection') {
        throw new RequestInvalidError(
          'INVALID_KIND',
          `Unsupported preview kind: ${kind}`,
        )
      }
      const body = await c.req.json()
      if (body.draft) {
        if (
          typeof body.draft !== 'object' ||
          Array.isArray(body.draft) ||
          (body.draft.process != null && !Array.isArray(body.draft.process))
        ) {
          throw new RequestInvalidError(
            'INVALID_BODY',
            'draft must contain valid resource data',
          )
        }
        setResourceContext(c, kind, body.draft)
        return c.json(await previewProcess(kind, body.draft))
      }
      if (!body.before || !body.after)
        throw new RequestInvalidError(
          'INVALID_BODY',
          'before and after are required',
        )
      const type = kind === 'sub' ? 'subscription' : 'collection'
      const produce = async (src: PreviewSource) => {
        const result = await produceArtifact({
          type,
          name: src.name,
          url: src.url,
          content: src.content,
          platform: 'JSON',
          produceType: 'internal',
        })
        return new Map(
          (Array.isArray(result) ? result : []).map((p) => [
            String((p as Record<string, unknown>)['name']),
            p,
          ]),
        )
      }
      const [before, after] = await Promise.all([
        produce(body.before),
        produce(body.after),
      ])
      const added: string[] = []
      const removed: string[] = []
      const changed: string[] = []
      const unchanged: string[] = []
      for (const [name, proxy] of after) {
        if (!before.has(name)) added.push(name)
        else if (JSON.stringify(before.get(name)) !== JSON.stringify(proxy))
          changed.push(name)
        else unchanged.push(name)
      }
      for (const name of before.keys()) {
        if (!after.has(name)) removed.push(name)
      }
      return c.json({ added, removed, changed, unchanged: unchanged.length })
    } catch (err) {
      return errorResponse(c, err)
    }
  }),
)

/** POST /api/parse/nodes {raw} → 解析为节点数组(内部表示) */
app.post('/api/parse/nodes', async (c) =>
  withApiStore(c.env, async () => {
    try {
      const { raw } = await c.req.json()
      if (raw == null)
        throw new RequestInvalidError('INVALID_BODY', 'raw is required')
      return c.json(ProxyUtils.parse(raw))
    } catch (err) {
      return errorResponse(c, err)
    }
  }),
)

/** POST /api/parse/rules {raw} → 规则解析 */
app.post('/api/parse/rules', async (c) =>
  withApiStore(c.env, async () => {
    try {
      const { raw } = await c.req.json()
      if (raw == null)
        throw new RequestInvalidError('INVALID_BODY', 'raw is required')
      return c.json(RuleUtils.parse(raw))
    } catch (err) {
      return errorResponse(c, err)
    }
  }),
)

export default app
