import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import ts from 'typescript'

// 使用仓库已有 TypeScript 编译器加载源码，不引入额外测试依赖。
const root = fileURLToPath(new URL('../', import.meta.url))
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('#/'))
      specifier = `${root}src/${specifier.slice(2)}`
    if (
      specifier.startsWith(`${root}src/`) ||
      (specifier.startsWith('.') &&
        context.parentURL?.startsWith(pathToFileURL(root).href))
    ) {
      const url = new URL(specifier, context.parentURL)
      const path = fileURLToPath(url)
      if (!existsSync(path) && existsSync(`${path}.ts`))
        specifier = `${url.href}.ts`
    }
    return nextResolve(specifier, context)
  },
  load(url, context, nextLoad) {
    if (
      url.startsWith(pathToFileURL(`${root}src/`).href) &&
      url.endsWith('.ts')
    )
      return {
        format: 'module',
        source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), {
          compilerOptions: {
            module: ts.ModuleKind.ESNext,
            target: ts.ScriptTarget.ES2022,
          },
        }).outputText,
        shortCircuit: true,
      }
    return nextLoad(url, context)
  },
})

const { selectTelegramNotification: select } =
  await import('../src/server/notifications/policy.ts')
const { telegramMasterMode, telegramCategoryMode, resourceNotificationMode } =
  await import('../src/shared/telegram-notifications.ts')
const { claimNotification } =
  await import('../src/server/notifications/cooldown.ts')
const { notifyServerEvents, formatTelegramEvent, sendTelegramEvents } =
  await import('../src/server/notifications/telegram.ts')
const { withServerLogs, listServerLogs } =
  await import('../src/server/store/logs.ts')

function database() {
  const sqlite = new DatabaseSync(':memory:')
  return {
    sqlite,
    prepare(sql) {
      const statement = sqlite.prepare(sql)
      let values = []
      return {
        bind(...args) {
          values = args
          return this
        },
        async first() {
          return statement.get(...values) ?? null
        },
        async all() {
          return { results: statement.all(...values) }
        },
        async run() {
          return statement.run(...values)
        },
      }
    },
  }
}
const enabled = { telegramEnabled: true }
const resource = { name: '机场甲' }
const request = (path = '/s/example', status = 502, method = 'GET') => ({
  path,
  status,
  method,
})
const entry = (
  action = 'subscription.download',
  level = 'error',
  extra = {},
) => ({
  time: '2026-10-16T00:00:00Z',
  level,
  message: '订阅处理结果',
  details: { action, code: 'UPSTREAM_FAILED', reason: '上游不可达', ...extra },
})

test('首次配置默认关闭，旧总范围转成总开关', () => {
  assert.equal(telegramMasterMode({}), 'off')
  assert.equal(
    telegramMasterMode({ telegramNotificationMode: 'errors' }),
    'all',
  )
  assert.equal(
    telegramMasterMode({
      telegramEnabled: false,
      telegramNotificationMode: 'all',
    }),
    'off',
  )
  assert.equal(telegramCategoryMode({}, 'telegramNotifyDownload'), 'errors')
  for (const key of [
    'telegramNotifyShareOps',
    'telegramNotifyBackupRestore',
    'telegramNotifySessionOps',
  ])
    assert.equal(telegramCategoryMode({}, key), 'off')
})

test('资源默认继承，旧显式关闭和开启仍有效，新模式优先', () => {
  assert.equal(resourceNotificationMode({}), 'inherit')
  assert.equal(resourceNotificationMode({ telegramEnabled: false }), 'off')
  assert.equal(resourceNotificationMode({ telegramEnabled: true }), 'errors')
  assert.equal(
    resourceNotificationMode({
      telegramEnabled: true,
      telegramNotifySuccess: true,
    }),
    'all',
  )
  assert.equal(
    resourceNotificationMode({
      telegramNotificationMode: 'inherit',
      telegramEnabled: false,
    }),
    'inherit',
  )
})

test('总开关关闭时，资源单独开启也不能推送', () => {
  assert.equal(
    select(
      {},
      [entry()],
      { ...resource, telegramNotificationMode: 'all' },
      request(),
    ),
    null,
  )
})

test('拉取分类关闭后不会进入系统故障，早期失败同样遵守分类', () => {
  const settings = {
    ...enabled,
    telegramNotifyDownload: 'off',
    telegramNotifySystemErrors: 'all',
  }
  assert.equal(select(settings, [entry()], resource, request()), null)
  assert.equal(
    select(settings, [entry('processing.failure')], undefined, request()),
    null,
  )
})

test('资源可覆盖分类，组合只按组合自身规则决定', () => {
  assert.ok(
    select(
      { ...enabled, telegramNotifyDownload: 'off' },
      [entry()],
      { ...resource, telegramNotificationMode: 'all' },
      request(),
    ),
  )
  assert.equal(
    select(
      enabled,
      [entry()],
      {
        ...resource,
        subscriptions: ['成员甲'],
        telegramNotificationMode: 'off',
      },
      request(),
    ),
    null,
  )
  const result = select(
    enabled,
    [entry('processing.failure')],
    { ...resource, subscriptions: ['成员甲'] },
    request(),
  )
  assert.equal(result.entry.details.targetResourceName, '机场甲')
  assert.equal(result.entry.details.targetResourceKind, 'collection')
  assert.equal(result.entry.details.action, 'subscription.download')
})

test('仅异常不发送成功，全量允许成功；部分失败明确显示请求仍完成', () => {
  const success = entry('subscription.download', 'info')
  assert.equal(
    select(enabled, [success], resource, request('/s/example', 200)),
    null,
  )
  assert.ok(
    select(
      { ...enabled, telegramNotifyDownload: 'all' },
      [success],
      resource,
      request('/s/example', 200),
    ),
  )
  const result = select(
    enabled,
    [entry('processing.failure'), success],
    resource,
    request('/s/example', 200),
  )
  assert.equal(result.entry.level, 'warn')
  assert.match(formatTelegramEvent(result.entry), /本次请求已完成/)
})

test('预览、流量、编辑、导出与手动备份失败只在页面和日志提示', () => {
  const paths = [
    '/api/preview/sub',
    '/api/parse/nodes',
    '/api/subs/a/flow',
    '/api/collections/a/flow',
    '/api/subs',
    '/api/subs/a',
    '/api/modules/a',
    '/api/settings',
    '/api/backup',
    '/api/backup/sync',
    '/auth/session',
  ]
  for (const path of paths)
    assert.equal(
      select(
        enabled,
        [entry('processing.failure')],
        resource,
        request(path, 500, path === '/api/backup' ? 'GET' : 'POST'),
      ),
      null,
      path,
    )
})

test('分享访问异常与分享创建删除共用一个设置，关闭后不会兜底', () => {
  const events = [entry('share.access', 'warn', { httpStatus: 401 })]
  assert.equal(
    select(enabled, events, undefined, request('/s/expired', 401)),
    null,
  )
  assert.equal(
    select(
      { ...enabled, telegramNotifyShareOps: 'errors' },
      events,
      undefined,
      request('/s/expired', 401),
    ).category,
    'telegramNotifyShareOps',
  )
  for (const [method, action] of [
    ['POST', 'share.create'],
    ['DELETE', 'share.delete'],
  ]) {
    const req = request('/api/shares/id', 500, method)
    assert.equal(
      select(enabled, [entry('processing.failure')], undefined, req),
      null,
    )
    assert.equal(
      select(
        { ...enabled, telegramNotifyShareOps: 'all' },
        [entry('processing.failure')],
        undefined,
        req,
      ).entry.details.action,
      action,
    )
  }
})

test('备份恢复和登录按请求归类，关闭后不走系统故障；定时备份默认仅异常', () => {
  for (const [path, method, key] of [
    ['/api/backup', 'POST', 'telegramNotifyBackupRestore'],
    ['/auth/callback', 'GET', 'telegramNotifySessionOps'],
    ['/auth/logout', 'POST', 'telegramNotifySessionOps'],
  ]) {
    const req = request(path, 500, method)
    assert.equal(
      select(enabled, [entry('processing.failure')], undefined, req),
      null,
    )
    assert.equal(
      select(
        { ...enabled, [key]: 'errors' },
        [entry('processing.failure')],
        undefined,
        req,
      ).category,
      key,
    )
  }
  assert.ok(select(enabled, [entry('backup.scheduled')]))
  assert.equal(select(enabled, [entry('backup.scheduled', 'info')]), null)
})

test('系统故障只接收其他服务端错误，排除普通4xx和通知自身错误', () => {
  assert.ok(
    select(
      enabled,
      [entry('processing.failure')],
      undefined,
      request('/api/unknown', 500),
    ),
  )
  assert.equal(
    select(
      enabled,
      [entry('processing.failure')],
      undefined,
      request('/api/unknown', 400),
    ),
    null,
  )
  assert.equal(
    select(
      enabled,
      [entry('notification.telegram')],
      undefined,
      request('/api/unknown', 500),
    ),
    null,
  )
  assert.equal(
    select(
      { ...enabled, telegramNotifySystemErrors: 'off' },
      [entry('processing.failure')],
      undefined,
      request('/api/unknown', 500),
    ),
    null,
  )
})

test('同一资源的分享链接共用去重键，成功与不同故障类型分别限频', () => {
  const a = select(enabled, [entry()], resource, request('/s/one'))
  const b = select(enabled, [entry()], resource, request('/s/two'))
  assert.equal(a.cooldownKey, b.cooldownKey)
  assert.notEqual(
    a.cooldownKey,
    select(
      enabled,
      [entry(undefined, 'error', { code: 'PARSE_FAILED' })],
      resource,
      request(),
    ).cooldownKey,
  )
  assert.notEqual(
    a.cooldownKey,
    select(enabled, [entry()], { name: '机场乙' }, request()).cooldownKey,
  )
})

test('实际SQLite原子限频：并发只有一个名额，30分钟边界允许再次发送', async () => {
  const db = database()
  const results = await Promise.all(
    Array.from({ length: 12 }, () => claimNotification(db, '同类事件', 1000)),
  )
  assert.equal(results.filter(Boolean).length, 1)
  assert.equal(
    await claimNotification(db, '同类事件', 1000 + 30 * 60 * 1000 - 1),
    false,
  )
  assert.equal(
    await claimNotification(db, '同类事件', 1000 + 30 * 60 * 1000),
    true,
  )
  assert.equal(
    await claimNotification(db, '另一资源', 1000 + 30 * 60 * 1000),
    true,
  )
  db.sqlite.close()
})

test('配置读取失败时不读取限频表、不调用Telegram', async () => {
  let reads = 0
  await notifyServerEvents(
    {
      SUKI_SUB_PUSH_SERVICE: 'configured',
      SUKI_SUB_DB: {
        prepare() {
          reads++
          throw new Error('设置不可用')
        },
      },
    },
    [entry()],
    resource,
    request(),
  )
  assert.equal(reads, 1)
})

test('通知格式精简且转义HTML，不包含凭据、请求路径与操作详情', () => {
  const text = formatTelegramEvent(
    entry(undefined, 'error', {
      reason: '<上游错误>',
      operatorName: '脚本操作',
      path: '/s/SECRET',
      clientUserAgent: 'UA',
      failures: [{ message: 'STACK' }],
    }),
  )
  assert.match(text, /&lt;上游错误&gt;/)
  assert.doesNotMatch(text, /SECRET|脚本操作|STACK|UA/)
})

test('发送器只发送一条摘要，Telegram请求使用转义后的HTML', async () => {
  let calls = 0
  const sent = await sendTelegramEvents(
    {
      SUKI_SUB_PUSH_SERVICE: 'telegram://123456:FAKE_TOKEN@telegram?chats=123',
    },
    [entry(), entry('processing.warning', 'warn')],
    { telegramEnabled: true },
    async (_url, init) => {
      calls++
      const body = JSON.parse(init.body)
      assert.equal(body.parse_mode, 'HTML')
      assert.equal(body.chat_id, '123')
      return new Response(JSON.stringify({ ok: true }))
    },
  )
  assert.equal(sent, 1)
  assert.equal(calls, 1)
})

test('完整分发使用数据库开关与限频，关闭后无新增请求', async () => {
  const db = database()
  db.sqlite.exec(
    'CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
  )
  db.sqlite.exec(`INSERT INTO settings VALUES ('telegramEnabled', 'true')`)
  const env = {
    SUKI_SUB_PUSH_SERVICE: 'telegram://123456:FAKE_TOKEN@telegram?chats=123',
    SUKI_SUB_DB: db,
  }
  const original = globalThis.fetch
  let calls = 0
  globalThis.fetch = async () => {
    calls++
    return new Response(JSON.stringify({ ok: true }))
  }
  try {
    await notifyServerEvents(env, [entry()], resource, request())
    await notifyServerEvents(env, [entry()], resource, request())
    assert.equal(calls, 1)
    db.sqlite.exec(
      "UPDATE settings SET value='false' WHERE key='telegramEnabled'",
    )
    await notifyServerEvents(
      env,
      [entry()],
      { name: '另一个订阅', telegramNotificationMode: 'all' },
      request(),
    )
    assert.equal(calls, 1)
  } finally {
    globalThis.fetch = original
    db.sqlite.close()
  }
})

test('发送失败落日志并显示摘要，不通过通知再次转发', async () => {
  const db = database()
  db.sqlite.exec(
    'CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
  )
  db.sqlite.exec(`INSERT INTO settings VALUES ('telegramEnabled', 'true')`)
  const original = globalThis.fetch
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        ok: false,
        description: '机器人被禁止',
        error_code: 403,
      }),
      { status: 403 },
    )
  try {
    await withServerLogs(db, () =>
      notifyServerEvents(
        {
          SUKI_SUB_PUSH_SERVICE:
            'telegram://123456:FAKE_TOKEN@telegram?chats=123',
          SUKI_SUB_DB: db,
        },
        [entry()],
        resource,
        request(),
      ),
    )
    const logs = await listServerLogs(db)
    assert.equal(logs[0].details.action, 'notification.telegram')
    assert.doesNotMatch(JSON.stringify(logs), /FAKE_TOKEN/)
  } finally {
    globalThis.fetch = original
    db.sqlite.close()
  }
})

test('仅修改通知不需要拉取上游，来源或管线改变仍须完整校验', async () => {
  const { isNotificationOnlyChange, assertNotificationMode } =
    await import('../src/server/notifications/resource-settings.ts')
  const old = { name: '故障订阅', url: 'https://unreachable.invalid/sub' }
  assert.equal(
    isNotificationOnlyChange(old, {
      ...old,
      process: [],
      telegramNotificationMode: 'off',
    }),
    true,
  )
  assert.equal(
    isNotificationOnlyChange(old, {
      ...old,
      url: 'https://another.invalid/sub',
      telegramNotificationMode: 'off',
    }),
    false,
  )
  assert.equal(
    isNotificationOnlyChange(old, {
      ...old,
      process: [{ type: 'Script Operator' }],
    }),
    false,
  )
  assert.equal(
    isNotificationOnlyChange(
      { name: '组合', subscriptions: ['甲'] },
      { name: '组合', subscriptions: ['乙'], telegramNotificationMode: 'off' },
    ),
    false,
  )
  assert.throws(() => assertNotificationMode('unsupported'), /拉取通知必须/)
})

test('唯一初始化脚本包含当前全部表，重复执行不清空数据且外键有效', () => {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys=ON')
  const sql = readFileSync(
    new URL('../migrations/0001_init.sql', import.meta.url),
    'utf8',
  )
  db.exec(sql)
  const tables = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all()
    .map((row) => row.name)
  assert.deepEqual(tables, [
    'collection_sources',
    'collections',
    'modules',
    'notification_cooldowns',
    'runtime_logs',
    'settings',
    'share_tokens',
    'subscriptions',
  ])
  db.exec("INSERT INTO settings VALUES ('telegramEnabled', 'false')")
  db.exec(
    "INSERT INTO share_tokens (id, type, name) VALUES ('example', 'sub', '机场甲')",
  )
  db.exec(sql)
  assert.equal(
    db.prepare("SELECT value FROM settings WHERE key='telegramEnabled'").get()
      .value,
    'false',
  )
  assert.equal(
    db.prepare('SELECT COUNT(*) AS count FROM share_tokens').get().count,
    1,
  )
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok')
  assert.throws(
    () =>
      db.exec(
        "INSERT INTO collection_sources (collection_id, kind, value) VALUES (999, 'subscription', '机场甲')",
      ),
    /FOREIGN KEY/,
  )
  db.close()
})
