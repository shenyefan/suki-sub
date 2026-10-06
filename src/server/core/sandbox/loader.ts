/**
 * 用户脚本沙箱(Dynamic Workers / worker_loaders):用户脚本拼进沙箱模块的
 * makeOperator 函数体,注入 lodash / yaml / Buffer / b64d / b64e / flowUtils /
 * $sukiSub / ProxyUtils(子集),每次 exec 经 RPC 传入运行时参数。
 * 同一脚本按 id 复用热实例;stub 每次执行重新获取(Workers 禁止跨请求复用 I/O 对象)。
 */
import lodashSrc from './vendor/lodash.esm.js?raw'
import yamlSrc from './vendor/yaml.esm.js?raw'
import flowUtilsSrc from './flow-utils.js?raw'
import { BaseError, RequestInvalidError } from '../errors'

/** 轻量字符串哈希(生成沙箱 worker id 用,非安全用途) */
function hashString(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

/** 沙箱主模块模板:注入依赖 + 用户脚本 + exec RPC 入口 */
export function buildSandboxMainModule(script: string, fnName: string): string {
  if (!['operator', 'filter', 'transformFunction'].includes(fnName)) {
    throw new Error(`Unsupported script function: ${fnName}`)
  }
  return `
import lodash from './deps/lodash.js'
import * as yaml from './deps/yaml.js'
import * as flowUtils from './deps/flow-utils.js'
import { Buffer } from 'node:buffer'
import { WorkerEntrypoint } from 'cloudflare:workers'

const YAML = { ...yaml, safeLoad: yaml.parse, safeDump: yaml.stringify, load: yaml.parse, dump: yaml.stringify }
const b64d = (s) => Buffer.from(s, 'base64').toString('utf8')
const b64e = (s) => Buffer.from(s, 'utf8').toString('base64')
const unavailable = (name) => () => {
  throw new Error(name + ' is not available inside the sandbox')
}
const DOMAIN_RESOLVERS = {}
const scriptResourceCache = { get: unavailable('scriptResourceCache.get'), set: unavailable('scriptResourceCache.set') }
const produceArtifact = unavailable('produceArtifact')
// ProxyUtils:yaml / Buffer / Base64 可用,其余(parse/produce 等)调用时报明确错误
const ProxyUtils = new Proxy({ yaml: YAML, Buffer, Base64: { decode: b64d, encode: b64e } }, {
  get(target, prop) {
    if (prop in target) return target[prop]
    return unavailable('ProxyUtils.' + String(prop))
  },
})

// 用户脚本在此执行;需声明 operator 函数,main 作为备选
function makeOperator($arguments, $options, $sukiSub) {
  const $substore = $sukiSub
  ${script}
  return typeof ${fnName} === 'function' ? ${fnName} : (${JSON.stringify(fnName)} === 'operator' && typeof main === 'function' ? main : undefined)
}

export default class extends WorkerEntrypoint {
  async exec(payload) {
    const { proxies, targetPlatform, context, $arguments, $options, settings } = payload ?? {}
    const $sukiSub = {
      name: 'suki-sub-sandbox',
      info: (...args) => console.log('[script]', ...args),
      error: (...args) => console.error('[script]', ...args),
      log: (...args) => console.log('[script]', ...args),
      notify: (t, s, b) => console.log('[script:notify]', t, s, b ?? ''),
      read: (key) => (key === 'settings' ? settings : undefined),
      write: () => { throw new Error('$.write is not available inside the sandbox') },
      delete: () => { throw new Error('$.delete is not available inside the sandbox') },
    }
    let fn
    try {
      fn = makeOperator($arguments, $options, $sukiSub)
    } catch (error) {
      if (error instanceof ReferenceError && ['$server is not defined', '$res is not defined'].includes(error.message))
        throw new Error('script shortcut: ' + error.message)
      throw error
    }
    if (typeof fn !== 'function') throw new Error('user script must declare function ${fnName}()')
    const output = await fn(proxies, targetPlatform, context)
    return output === undefined ? proxies : output
  }
}
`
}

export interface ScriptExecPayload {
  proxies?: unknown
  targetPlatform?: string
  context?: Record<string, unknown>
  $arguments?: Record<string, unknown>
  $options?: unknown
  settings?: Record<string, unknown>
}

interface SandboxEntrypoint {
  exec: (payload: ScriptExecPayload) => Promise<unknown>
}

/**
 * 每次执行取新 stub:Workers 禁止跨请求复用 I/O 对象(如 RPC stub);
 * worker 本身按 id 保持热实例(loader.get 的语义),不增加冷启动与计费。
 */
function getSandboxEntrypoint(
  loader: WorkerLoader,
  script: string,
  fnName: string,
): SandboxEntrypoint {
  if (typeof script !== 'string' || !script.trim()) {
    throw new Error(
      'script operator: empty script (official convention stores it at item.args.content)',
    )
  }
  const id = `suki-script-${fnName}-${hashString(script)}`
  const code: WorkerLoaderWorkerCode = {
    compatibilityDate: '2025-09-02',
    compatibilityFlags: ['nodejs_compat'],
    mainModule: 'index.js',
    modules: {
      'index.js': buildSandboxMainModule(script, fnName),
      'deps/lodash.js': lodashSrc,
      'deps/yaml.js': yamlSrc,
      'deps/flow-utils.js': flowUtilsSrc,
    },
    limits: { cpuMs: 10_000 },
  }
  const stub = loader.get(id, () => code)
  return stub.getEntrypoint() as unknown as SandboxEntrypoint
}

const SCRIPT_TIMEOUT_MS = 30_000

/** 在沙箱中执行用户脚本定义的函数;无 worker_loaders 绑定时给出明确错误 */
export async function execUserScript(
  loader: WorkerLoader | null,
  script: string,
  fnName: string,
  payload: ScriptExecPayload,
): Promise<unknown> {
  if (!loader) {
    throw new Error(
      'Script operators require the "worker_loaders" binding (Dynamic Workers, Workers Paid plan); SCRIPT_LOADER binding is missing.',
    )
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const entrypoint = getSandboxEntrypoint(loader, script, fnName)
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new Error(
              `script execution timed out after ${SCRIPT_TIMEOUT_MS}ms`,
            ),
          ),
        SCRIPT_TIMEOUT_MS,
      )
    })
    return await Promise.race([entrypoint.exec(payload), timeout])
  } catch (error) {
    if (error instanceof BaseError) throw error
    const message = String(
      (error as { message?: unknown } | null | undefined)?.message ?? error,
    )
    const syntax =
      /(?:Uncaught )?SyntaxError:\s*(.*?)(?: at index\.js:(\d+):(\d+))?$/.exec(
        message,
      )
    if (
      syntax ||
      (error as { name?: string } | null | undefined)?.name === 'SyntaxError'
    ) {
      const reason = syntax?.[1] || message
      const position: Record<string, unknown> = {}
      if (syntax?.[2]) {
        const prefix = buildSandboxMainModule('__SUKI_SCRIPT_START__', fnName)
          .split('\n')
          .findIndex((line) => line.includes('__SUKI_SCRIPT_START__'))
        position.scriptLine = Math.max(1, Number(syntax[2]) - prefix)
        position.scriptColumn = Number(syntax[3])
      }
      const shortcutAwait =
        /\bawait\b/.test(script) &&
        !new RegExp(
          `(?:function\\s+|(?:const|let|var)\\s+)(?:${fnName}|main)\\b`,
        ).test(script) &&
        /await is only valid in async functions|Unexpected reserved word/i.test(
          reason,
        )
      if (shortcutAwait) position.shortcutSyntax = true
      throw new RequestInvalidError(
        'SCRIPT_SYNTAX_ERROR',
        `脚本语法错误：${reason}`,
        position,
      )
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}
