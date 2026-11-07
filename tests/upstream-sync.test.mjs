import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const root = fileURLToPath(new URL('../', import.meta.url))
const server = await createServer({
  root,
  configFile: false,
  resolve: { alias: { '#': `${root}src` } },
  server: { middlewareMode: true, hmr: false, ws: false },
  appType: 'custom',
})
after(() => server.close())
const load = (path) => server.ssrLoadModule(`/src/${path}.ts`)
const { ProxyUtils } = await load('server/core/proxy-utils/index')
const { produceArtifact } = await load('server/core/produce-artifact')
const { runWithEngineStore } = await load('server/store/engine-store')
const { applyConfigTemplates } = await load('server/core/utils/config-template')
const yaml = ProxyUtils.yaml
const uri = (name) => `ss://YWVzLTEyOC1nY206ZGVtbw@example.com:443#${name}`
const nodes = ['z', 'a', 'm'].map((name) => ({
  name,
  type: 'ss',
  server: 'example.com',
  port: 443,
  cipher: 'aes-128-gcm',
  password: 'demo',
}))
const templateOutput = (groups, platform = 'mihomo', extra = {}) =>
  yaml.safeLoad(
    applyConfigTemplates(
      yaml.safeDump({ proxies: nodes }),
      [{ 'proxy-groups': groups, ...extra }],
      platform,
    ),
  )

test('模板自动包含节点时保留管线顺序、显式入口与 provider，普通组保持原样', () => {
  const config = templateOutput(
    [
      {
        name: '全部',
        type: 'select',
        'include-all': true,
        proxies: ['DIRECT', 'm'],
      },
      { name: '节点', type: 'select', 'include-all-proxies': true },
      { name: '手动', type: 'select', proxies: ['m', 'z'] },
      { name: '远程', type: 'select', 'include-all-providers': true },
    ],
    'ClashMeta',
    { 'proxy-providers': { remote: { type: 'inline', payload: nodes } } },
  )
  assert.deepEqual(config.proxies, nodes)
  const [all, local, manual, remote] = config['proxy-groups']
  assert.deepEqual(all.proxies, ['DIRECT', 'm', 'z', 'a'])
  assert.equal(all['include-all-providers'], true)
  assert.equal(all['include-all'], undefined)
  assert.equal(local['include-all-providers'], undefined)
  assert.deepEqual(local.proxies, ['z', 'a', 'm'])
  assert.deepEqual(manual.proxies, ['m', 'z'])
  assert.equal(remote.proxies, undefined)
  assert.equal(remote['include-all-providers'], true)
  assert.equal(
    templateOutput([{ name: '原样', 'include-all': true }], 'Stash')[
      'proxy-groups'
    ][0]['include-all'],
    true,
  )
})

test('模板过滤保留相对顺序、大小写、排除选项与空组回退', () => {
  const [filtered, empty, provider] = templateOutput([
    {
      name: '过滤',
      type: 'select',
      'include-all': true,
      filter: '(?i)^Z$`^m$',
      'exclude-filter': 'm',
      'exclude-type': 'trojan',
    },
    {
      name: '空组',
      type: 'select',
      'include-all-proxies': true,
      filter: '^none$',
    },
    {
      name: '远程',
      type: 'select',
      'include-all-proxies': true,
      filter: '^none$',
      use: ['remote'],
    },
  ])['proxy-groups']
  assert.deepEqual(filtered.proxies, ['z', 'm'])
  assert.equal(filtered.filter, '(?i)^Z$`^m$')
  assert.equal(filtered['exclude-filter'], 'm')
  assert.equal(filtered['exclude-type'], 'trojan')
  assert.deepEqual(empty.proxies, ['COMPATIBLE'])
  assert.deepEqual(provider.proxies, [])
  assert.throws(
    () => templateOutput([{ 'include-all': true, filter: '[' }]),
    /过滤表达式/,
  )
})

const snapshot = () => ({
  subs: [
    {
      name: '节点',
      source: 'local',
      content: ['z', 'a', 'm'].map(uri).join('\n'),
      process: [],
    },
  ],
  collections: [{ name: '组合', subscriptions: ['节点'], process: [] }],
  modules: [],
  settings: {},
  kv: null,
  scriptLoader: null,
})

test('真实订阅与组合模板输出均展开有序节点', async () => {
  for (const type of ['subscription', 'collection']) {
    const store = snapshot()
    store[type === 'subscription' ? 'subs' : 'collections'][0].process = [
      {
        type: 'Script Operator',
        args: {
          mode: 'script',
          content:
            'proxy-groups:\n  - name: 全部\n    type: select\n    include-all: true\n',
        },
      },
    ]
    await runWithEngineStore(store, async () => {
      const output = yaml.safeLoad(
        await produceArtifact({
          type,
          name: type === 'subscription' ? '节点' : '组合',
          platform: 'Mihomo',
        }),
      )
      assert.deepEqual(
        output.proxies.map((node) => node.name),
        ['z', 'a', 'm'],
      )
      assert.deepEqual(output['proxy-groups'][0].proxies, ['z', 'a', 'm'])
    })
  }
})

test('includeRaw 不改变原返回值，订阅和组合保留原始输入', async () => {
  for (const type of ['subscription', 'sub', 'collection', 'col']) {
    for (const produceType of [undefined, 'internal', 'raw']) {
      const store = snapshot()
      await runWithEngineStore(store, async () => {
        const options = {
          type,
          name: ['subscription', 'sub'].includes(type) ? '节点' : '组合',
          produceType,
        }
        const result = await produceArtifact(options)
        const output = await produceArtifact({ ...options, includeRaw: true })
        assert.deepEqual(output.result, result)
        assert.deepEqual(
          output.raw,
          ['subscription', 'sub'].includes(type)
            ? [store.subs[0].content]
            : { 节点: [store.subs[0].content] },
        )
      })
    }
  }
})

test('Trojan 无查询参数的名称和默认端口正确解析，支持 IPv6', () => {
  for (const [host, port] of [
    ['example.com:8443', 8443],
    ['example.com', 443],
    ['[2001:db8::2]', 443],
  ]) {
    const [node] = ProxyUtils.parse(`trojan://pass@${host}#My%20Node`)
    assert.equal(node.name, 'My Node')
    assert.equal(node.port, port)
  }
})

test('Trojan 和 AnyTLS 的特殊密码、百分号密码往返不丢失', () => {
  for (const type of ['trojan', 'anytls']) {
    for (const password of ['p@ss:w/rd#1?', 'p%40ss', 'p%ss']) {
      const output = ProxyUtils.produce(
        [
          {
            type,
            name: '密码',
            server: 'example.com',
            port: 443,
            password,
            tls: true,
          },
        ],
        'URI',
      )
      const [node] = ProxyUtils.parse(output)
      assert.equal(node.password, password)
      assert.equal(node.server, 'example.com')
    }
  }
})

test('VMess URI 保留所有 h2 host', () => {
  const output = ProxyUtils.produce(
    [
      {
        type: 'vmess',
        name: 'h2',
        server: 'example.com',
        port: 443,
        uuid: '12345678-1234-1234-1234-123456789012',
        cipher: 'auto',
        alterId: 0,
        network: 'h2',
        'h2-opts': { host: ['a.example.com', 'b.example.com'], path: '/h2' },
      },
    ],
    'URI',
  )
  assert.deepEqual(ProxyUtils.parse(output)[0]['h2-opts'].host, [
    'a.example.com',
    'b.example.com',
  ])
})

test('Mihomo Snell v6 的模式及扩展 ShadowTLS 参数可往返', () => {
  for (const mode of ['default', 'unshaped', 'unsafe-raw']) {
    const proxy = {
      type: 'snell',
      name: mode,
      server: 'example.com',
      port: 443,
      version: 6,
      mode,
      psk: '测试密码',
      udp: true,
      'obfs-opts': {
        mode: 'shadow-tls',
        host: 'mask.example.com',
        password: 'pass',
        version: 3,
        'name-cert-verify': 'cert.example.com',
        'skip-cert-verify': false,
        alpn: [],
      },
    }
    const parsed = ProxyUtils.parse(yaml.safeDump({ proxies: [proxy] }))
    assert.deepEqual(
      yaml.safeLoad(ProxyUtils.produce(parsed, 'Mihomo')).proxies,
      [proxy],
    )
  }
  const base = {
    type: 'snell',
    name: 'v6',
    server: 'example.com',
    port: 443,
    version: '6',
    psk: 'snell-test-psk',
  }
  for (const patch of [
    { psk: 'short' },
    { psk: 'x'.repeat(256) },
    { mode: 'wrong' },
    { 'obfs-opts': { mode: 'http' } },
  ]) {
    assert.deepEqual(
      ProxyUtils.produce([{ ...base, ...patch }], 'Mihomo', 'internal'),
      [],
    )
  }
  const [legacy] = ProxyUtils.produce(
    [{ ...base, version: 2, mode: 'unshaped', udp: true }],
    'Mihomo',
    'internal',
  )
  assert.equal(legacy.mode, undefined)
  assert.equal(legacy.udp, undefined)
})

test('sing-box WireGuard 保留顶层与 peer 的 allowed-ips 并规范化字符串', () => {
  for (const [patch, expected] of [
    [{ 'allowed-ips': ['10.0.0.0/24'] }, ['10.0.0.0/24']],
    [
      { 'allowed-ips': '10.0.0.0/24, 192.168.0.0/16' },
      ['10.0.0.0/24', '192.168.0.0/16'],
    ],
    [
      {
        'allowed-ips': ['10.0.0.0/24'],
        peers: [{ 'public-key': 'public', 'allowed-ips': '172.16.0.0/16' }],
      },
      ['172.16.0.0/16'],
    ],
    [{ 'allowed-ips': '' }, ['0.0.0.0/0']],
  ]) {
    const output = JSON.parse(
      ProxyUtils.produce(
        [
          {
            type: 'wireguard',
            name: 'wg',
            server: 'example.com',
            port: 51820,
            ip: '10.0.0.2',
            'private-key': 'private',
            'public-key': 'public',
            ...patch,
          },
        ],
        'sing-box',
      ),
    )
    assert.deepEqual(output.endpoints[0].peers[0].allowed_ips, expected)
  }
})

test('Egern WireGuard 接受 pre-shared-key 别名', () => {
  const output = yaml.safeLoad(
    ProxyUtils.produce(
      [
        {
          type: 'wireguard',
          name: 'wg',
          server: 'example.com',
          port: 51820,
          ip: '10.0.0.2',
          'private-key': 'private',
          'public-key': 'public',
          'pre-shared-key': 'shared',
        },
      ],
      'Egern',
    ),
  )
  assert.equal(output.proxies[0].wireguard.preshared_key, 'shared')
})

// 可选真实内核验收：MIHOMO_BIN=/path/to/mihomo pnpm test。
test(
  '真实 Mihomo 内核保留模板节点顺序和 provider 过滤',
  { skip: !process.env.MIHOMO_BIN },
  async () => {
    const { mkdtemp, writeFile, rm } = await import('node:fs/promises')
    const { spawn } = await import('node:child_process')
    const { request } = await import('node:http')
    const { tmpdir } = await import('node:os')
    const directory = await mkdtemp(`${tmpdir()}/sub-order-`)
    const socketPath = `${directory}/api.sock`
    const config = templateOutput(
      [
        { name: '全部', type: 'select', 'include-all': true },
        {
          name: '过滤',
          type: 'select',
          'include-all': true,
          filter: '(?i)z|m',
          'exclude-filter': '^m$',
        },
        {
          name: '显式',
          type: 'select',
          'include-all-proxies': true,
          proxies: ['DIRECT', 'm'],
        },
        {
          name: '空组',
          type: 'select',
          'include-all-proxies': true,
          filter: '^none$',
        },
      ],
      'Mihomo',
      {
        'proxy-providers': {
          remote: {
            type: 'inline',
            payload: [{ ...nodes[0], name: 'remote-z' }],
          },
        },
      },
    )
    Object.assign(config, {
      'external-controller-unix': socketPath,
      'mixed-port': 0,
      'log-level': 'info',
      rules: ['MATCH,DIRECT'],
    })
    await writeFile(`${directory}/config.yaml`, yaml.safeDump(config))
    const child = spawn(
      process.env.MIHOMO_BIN,
      ['-d', directory, '-f', `${directory}/config.yaml`],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    )
    let logs = ''
    child.stdout.on('data', (data) => {
      logs += data
    })
    child.stderr.on('data', (data) => {
      logs += data
    })
    const read = () =>
      new Promise((resolve, reject) => {
        const req = request({ socketPath, path: '/proxies' }, (res) => {
          let content = ''
          res.on('data', (data) => {
            content += data
          })
          res.on('end', () => {
            try {
              resolve(JSON.parse(content))
            } catch (error) {
              reject(error)
            }
          })
        })
        req.on('error', reject)
        req.end()
      })
    try {
      let response
      let lastError
      for (let i = 0; i < 100; i++) {
        try {
          response = await read()
          break
        } catch (error) {
          lastError = error
          await new Promise((resolve) => setTimeout(resolve, 50))
        }
      }
      assert.ok(response, `内核未就绪：${lastError} ${logs}`)
      assert.deepEqual(response.proxies['全部'].all, [
        'z',
        'a',
        'm',
        'remote-z',
      ])
      assert.deepEqual(response.proxies['过滤'].all, ['z', 'remote-z'])
      assert.deepEqual(response.proxies['显式'].all, ['DIRECT', 'm', 'z', 'a'])
      assert.deepEqual(response.proxies['空组'].all, ['COMPATIBLE'])
    } finally {
      child.kill('SIGTERM')
      await new Promise((resolve) =>
        child.exitCode !== null || child.signalCode !== null
          ? resolve()
          : child.once('exit', resolve),
      )
      await rm(directory, { recursive: true, force: true })
    }
  },
)

test('includeRaw 保留远程预处理前内容及本地合并顺序', async () => {
  const originalFetch = globalThis.fetch
  const remote = yaml.safeDump({ proxies: [nodes[0]] })
  globalThis.fetch = async () => new Response(remote)
  try {
    for (const mergeSources of ['localFirst', 'remoteFirst']) {
      for (const type of ['subscription', 'collection']) {
        const store = snapshot()
        Object.assign(store.subs[0], {
          source: 'remote',
          url: 'https://example.com/sub',
          content: uri('local'),
          mergeSources,
        })
        await runWithEngineStore(store, async () => {
          const output = await produceArtifact({
            type,
            name: type === 'subscription' ? '节点' : '组合',
            includeRaw: true,
            produceType: 'internal',
            noFlow: true,
            noCache: true,
          })
          const expected =
            mergeSources === 'localFirst'
              ? [uri('local'), remote]
              : [remote, uri('local')]
          assert.deepEqual(
            output.raw,
            type === 'subscription' ? expected : { 节点: expected },
          )
          assert.deepEqual(
            output.result.map((node) => node.name),
            mergeSources === 'localFirst' ? ['local', 'z'] : ['z', 'local'],
          )
        })
      }
    }
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('includeRaw 保留兜底输出的原始内容和失败成员标记', async () => {
  const failing = [
    {
      type: 'Script Operator',
      args: { mode: 'script', content: 'throw new Error("失败")' },
    },
  ]
  for (const type of ['subscription', 'collection']) {
    const store = snapshot()
    store[type === 'subscription' ? 'subs' : 'collections'][0].process = failing
    await runWithEngineStore(store, async () => {
      const output = await produceArtifact({
        type,
        name: type === 'subscription' ? '节点' : '组合',
        includeRaw: true,
        produceType: 'internal',
        ignoreFailedRemoteSub: 'fallbackQuiet',
      })
      assert.deepEqual(output.result, [])
      assert.deepEqual(
        output.raw,
        type === 'subscription'
          ? [store.subs[0].content]
          : { 节点: [store.subs[0].content] },
      )
    })
  }
  for (const mode of ['quiet', 'fallbackQuiet']) {
    const store = snapshot()
    store.subs.push({
      name: '失败',
      source: 'local',
      content: uri('broken'),
      process: failing,
    })
    store.collections[0].subscriptions.push('失败')
    await runWithEngineStore(store, async () => {
      const output = await produceArtifact({
        type: 'collection',
        name: '组合',
        includeRaw: true,
        produceType: 'internal',
        ignoreFailedRemoteSub: mode,
      })
      assert.equal(output.result.length, 3)
      assert.ok(Object.hasOwn(output.raw, '失败'))
      assert.deepEqual(output.raw['失败'], mode === 'quiet' ? undefined : [])
    })
  }
})
