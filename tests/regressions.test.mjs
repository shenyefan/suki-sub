import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const root = fileURLToPath(new URL('../', import.meta.url))
// 复用 Vite 的 TS、路径别名与 ?raw 转换，不启动浏览器或监听端口。
const server = await createServer({
  root,
  configFile: false,
  resolve: { alias: { '#': `${root}src` } },
  server: { middlewareMode: true, hmr: false, ws: false },
  appType: 'custom',
})
after(() => server.close())
const load = (path) => server.ssrLoadModule(`/src/${path}.ts`)
const { runWithEngineStore } = await load('server/store/engine-store')
const { default: $, takeDirtyEngineKeys } = await load('server/core/app')
const { produceArtifact } = await load('server/core/produce-artifact')
const { ProxyUtils } = await load('server/core/proxy-utils/index')
const { withApiStore } = await load('server/store/bootstrap')
const d1 = await load('server/store/d1')
const { default: moduleApi } = await load('server/api/modules')
const { default: flowApi } = await load('server/api/flow')
const { subscriptionFlow } = await load('server/api/download-flow')

const uri = (name) => `ss://YWVzLTEyOC1nY206ZGVtbw@example.com:443#${name}`
const subscription = (name) => ({ name, source: 'local', content: uri(name) })
const snapshot = () => ({
  subs: ['A', 'B'].map(subscription),
  collections: [{ name: '组合', subscriptions: ['B', 'A'], process: [] }],
  modules: [],
  settings: {},
  kv: null,
  scriptLoader: null,
})
const produce = () =>
  produceArtifact({ type: 'collection', name: '组合', produceType: 'internal' })

// SQLite 执行真实存储层 SQL；batch 模拟 D1 的事务回滚语义。
function database() {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec('PRAGMA foreign_keys = ON')
  after(() => sqlite.close())
  const prepare = (sql, values = []) => {
    const execute = (method) => {
      const statement = sqlite.prepare(sql)
      const bindings = Object.fromEntries(
        values.map((value, i) => [`?${i + 1}`, value]),
      )
      return values.length ? statement[method](bindings) : statement[method]()
    }
    return {
      bind: (...args) => prepare(sql, args),
      async run() {
        const result = execute('run')
        return {
          meta: {
            last_row_id: Number(result.lastInsertRowid),
            changes: Number(result.changes),
          },
        }
      },
      async all() {
        return { results: execute('all') }
      },
      async first() {
        return execute('get') ?? null
      },
    }
  }
  return {
    prepare,
    async batch(statements) {
      sqlite.exec('BEGIN')
      try {
        const results = []
        for (const statement of statements) results.push(await statement.run())
        sqlite.exec('COMMIT')
        return results
      } catch (error) {
        sqlite.exec('ROLLBACK')
        throw error
      }
    },
  }
}
const environment = () => ({
  SUKI_SUB_DB: database(),
  SUKI_SUB_CACHE: null,
  SCRIPT_LOADER: null,
})

test('组合输出遵循保存后的成员顺序，正则分组保留组内顺序', async () => {
  const env = environment()
  await d1.ensureSchema(env.SUKI_SUB_DB)
  await d1.replaceSubscriptions(env.SUKI_SUB_DB, snapshot().subs)
  await d1.replaceCollections(env.SUKI_SUB_DB, snapshot().collections)
  await withApiStore(env, async () => {
    const nodes = await produce()
    assert.deepEqual(
      nodes.map((node) => node.name),
      ['B', 'A'],
    )
    const sorted = await ProxyUtils.process(
      nodes,
      [
        {
          type: 'Regex Sort Operator',
          args: { expressions: ['.'], order: 'original' },
        },
      ],
      'JSON',
    )
    assert.deepEqual(
      sorted.map((node) => node.name),
      ['B', 'A'],
    )
  })
})

test('远程成员下载完成顺序不影响组合顺序', async () => {
  const store = snapshot()
  store.collections[0].subscriptions = [
    'https://example.com/slow',
    'https://example.com/fast',
    'B',
  ]
  const originalFetch = globalThis.fetch
  let finishSlow
  const slow = new Promise((resolve) => {
    finishSlow = resolve
  })
  globalThis.fetch = async (url) => {
    if (url.endsWith('/slow')) return slow
    finishSlow(new Response(uri('慢')))
    return new Response(uri('快'))
  }
  try {
    await runWithEngineStore(store, async () => {
      const nodes = await produce()
      assert.deepEqual(
        nodes.map((node) => node.name),
        ['慢', '快', 'B'],
      )
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('组合成员脚本收到与独立订阅相同的下载选项', async () => {
  const store = snapshot()
  const payloads = []
  store.scriptLoader = {
    get: () => ({
      getEntrypoint: () => ({
        exec: async (payload) => {
          payloads.push(payload)
          return payload.proxies
        },
      }),
    }),
  }
  store.subs[0].process = [
    {
      type: 'Script Operator',
      args: {
        mode: 'script',
        content: 'function operator(proxies) { return proxies }',
      },
    },
  ]
  await runWithEngineStore(store, async () => {
    const options = { marker: '请求选项' }
    await produceArtifact({
      type: 'sub',
      name: 'A',
      produceType: 'internal',
      $options: options,
    })
    await produceArtifact({
      type: 'collection',
      name: '组合',
      produceType: 'internal',
      $options: options,
    })
    assert.equal(payloads.length, 2)
    assert.deepEqual(
      payloads.map((payload) => payload.$options),
      [options, options],
    )
  })
})

test('并发请求的脏键隔离，嵌套预览不会污染外层', async () => {
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  await Promise.all([
    runWithEngineStore(snapshot(), async () => {
      $.write([], 'subs')
      await gate
      assert.deepEqual([...takeDirtyEngineKeys()], ['subs'])
    }),
    runWithEngineStore(snapshot(), async () => {
      try {
        $.delete('modules')
        await runWithEngineStore(snapshot(), () => $.write({}, 'settings'))
        assert.deepEqual([...takeDirtyEngineKeys()], ['modules'])
      } finally {
        release()
      }
    }),
  ])
})

test('删除操作回写 D1，新数据库各自初始化', async () => {
  for (let i = 0; i < 2; i++) {
    const env = environment()
    await withApiStore(env, async () => {
      $.write([subscription('待删除')], 'subs')
    })
    assert.equal((await d1.listSubscriptions(env.SUKI_SUB_DB)).length, 1)
    await withApiStore(env, async () => {
      $.delete('subs')
    })
    assert.deepEqual(await d1.listSubscriptions(env.SUKI_SUB_DB), [])
  }
})

test('备份后半部分失败时，订阅、组合和设置均保持原数据', async () => {
  const db = database()
  await d1.ensureSchema(db)
  await d1.restoreResources(db, {
    ...snapshot(),
    settings: { marker: '原设置' },
  })
  const before = await d1.listCollections(db)
  await assert.rejects(
    d1.restoreResources(db, {
      subs: [subscription('新订阅')],
      collections: [],
      modules: [
        { name: '重复', content: '' },
        { name: '重复', content: '' },
      ],
      settings: { marker: '新设置' },
    }),
  )
  assert.deepEqual(
    (await d1.listSubscriptions(db)).map((sub) => sub.name),
    ['A', 'B'],
  )
  assert.deepEqual(await d1.listCollections(db), before)
  assert.deepEqual(await d1.getAllSettings(db), { marker: '原设置' })
})

test('模块更新拒绝非法名称、非法内容和重名', async () => {
  const env = environment()
  await withApiStore(env, async () => {})
  await d1.createModule(env.SUKI_SUB_DB, { name: 'A', content: '原脚本' })
  await d1.createModule(env.SUKI_SUB_DB, { name: 'B', content: '' })
  for (const patch of [
    { name: '含/斜杠' },
    { name: '   ' },
    { content: 123 },
    { name: 'B' },
  ]) {
    const response = await moduleApi.request(
      '/api/modules/A',
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      },
      env,
    )
    assert.equal(response.status, 400)
  }
  assert.equal((await d1.getModule(env.SUKI_SUB_DB, 'A')).content, '原脚本')
})

test('无有效远程 URL 时卡片与下载仍使用自定义流量', async () => {
  const env = environment()
  await withApiStore(env, async () => {})
  const sub = {
    name: '流量',
    source: 'remote',
    subUserinfo: 'upload=1; download=2; total=100',
  }
  await d1.createSubscription(env.SUKI_SUB_DB, sub)
  const response = await flowApi.request('/api/subs/流量/flow', undefined, env)
  assert.equal(response.status, 200)
  assert.equal((await response.json()).total, 100)
  assert.equal(
    await runWithEngineStore(snapshot(), () => subscriptionFlow(sub, true)),
    sub.subUserinfo,
  )
})
