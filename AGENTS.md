# AGENTS.md

## 项目概览

SUKI Sub:部署在 Cloudflare Workers 上的订阅管理面板,前后端同源一体(React 19 + TanStack Start + Hono)。订阅处理引擎是 TypeScript 移植版,支持多平台节点的解析、操作管线与产出。数据持久化在 D1(规范化表),时效数据在 KV。界面遵循 DESIGN.md 的 Geist 设计规范。代码注释、错误信息、UI 文案一律用中文。

## 常用命令

```bash
pnpm dev                 # vite dev --port 3000(cloudflare vite 插件提供本地 D1/KV)
pnpm build               # 构建
pnpm deploy              # pnpm run build && wrangler deploy
pnpm lint                # eslint
pnpm typecheck           # tsc --noEmit
pnpm format              # prettier --write . && eslint --fix
pnpm check               # prettier --check .(CI 式校验,不改文件)
pnpm generate-routes     # tsr generate(仅在路由文件增删后需要)
```

本地开发需要 `.dev.vars`(从 `.dev.vars.example` 复制):`OIDC_ISSUER`、`OIDC_AUDIENCE`、`OIDC_CLIENT_SECRET`(公共客户端留空)、可选的 `SUKI_SUB_PUSH_SERVICE`。缺 OIDC 配置时 `/api/*` 直接返回 503。本地回调地址固定为 `http://localhost:3000/auth/callback`。

D1 迁移:

```bash
wrangler d1 migrations apply suki-sub --local
```

```bash
wrangler d1 migrations apply suki-sub --remote
```

关于测试:仓库目前**没有测试套件**(没有 `scripts/` 目录,`package.json` 里也没有 `test:*` 脚本)。改代码后靠 `pnpm typecheck` + `pnpm lint` + `pnpm check` + 手动跑 `pnpm dev` 验证。

## 请求分发与运行时结构

单一 Worker 入口 `src/server/worker-entry.ts` 按路径前缀分流,理解这一点是理解全局的关键:

- `/api/`、`/auth/`、`/s/` → Hono 应用 `src/server/app.ts`
- 其余全部 → TanStack Start 的 SSR handler(含页面、静态资源、server functions)
- `scheduled()` → `src/server/jobs/scheduler.ts`(Cron Trigger,每 6 小时;仅在 settings 配了 `gistToken` 时执行 Gist 备份)

`compatibility_flags: ["nodejs_compat"]` 是 TanStack Start 服务端所需;绑定名固定为 `SUKI_SUB_DB`(D1)、`SUKI_SUB_CACHE`(KV)、`SCRIPT_LOADER`(Dynamic Workers,脚本沙箱,需付费计划)。`worker-configuration.d.ts` 是 wrangler 生成的类型文件,不要手改。

## 引擎存储模型(最重要的一处架构)

引擎代码是**同步读写**风格的,而 D1 是异步的。两者靠 `src/server/store/` 的这层机制衔接:

1. `withApiStore(env, handler)`(`store/bootstrap.ts`)在每个 API 请求开始时把 D1 的四类资源全量读成一份内存快照。
2. 快照放进 `AsyncLocalStorage`(`store/engine-store.ts`),handler 在其作用域内运行;引擎通过 `getEngineStore()` 同步取用。并发请求之间靠 AsyncLocalStorage 隔离,不要改成模块级变量。
3. 引擎对 `$`(`src/server/core/app.ts`)的 `$.write/$.delete` 只改快照并记一个「脏键」。
4. handler 返回后,bootstrap 用 `takeDirtyEngineKeys()` 把脏键对应的整份集合回写 D1(`replaceSubscriptions` 等,整表替换)。

推论:`handler 必须在返回前完成全部引擎调用`,flush 用的是作用域内的最终快照;绕过 `$` 直接写 D1 会与快照机制脱节。

`src/server/store/d1.ts` 的映射约定:每类资源只有少数字段提升为独立列(`SPLIT` 常量:`name/url/ua/mergeSources/process` 等),**其余字段整体塞进 `extra` JSON 列**,读出时展开。这样官方(Sub-Store)字段演进不会丢数据。新增资源字段通常只需改 `src/shared/types.ts`,不必加迁移列。

KV(`store/kv.ts`)只放时效数据:分享 token(`token:<id>`)与远程订阅缓存(`cache:resource:*`,TTL 1 小时)。KV 最终一致,持久数据一律走 D1。

## 订阅处理引擎(`src/server/core/`)

数据流:`produceArtifact()`(`core/produce-artifact.ts`)是唯一编排入口 —— 载入订阅/组合 → `utils/download.ts` 拉取(带 UA/proxy/缓存)→ `ProxyUtils.parse()` 解析为节点数组 → 逐个操作符处理 → `ProxyUtils.produce()` 按平台产出 → 再由 `response-transformer.ts`、`age-output.ts` 做响应后处理。

`core/proxy-utils/` 内部按四段组织,每段都是一个「数组 + `.test()` 试错」的链:

- `preprocessors/` — 输入预处理
- `parsers/` — 输入格式识别(Clash/surge/loon/qx/uri…)`parsers/peggy/` 下是 Peggy 语法
- `processors/` — 节点操作符(与前端注册表一一对应,见下)
- `producers/` — 输出平台(clashmeta/clash/sing-box/surge/loon/qx/shadowrocket/egern/stash/v2ray/uri…)

`core/rule-utils/` 是同一套结构,但面向规则集(而非节点)。

错误统一走 `core/errors.ts` 的 `BaseError(code, message, fields)`,HTTP 层再由 `api/http.ts` 做内容协商:`Accept` 偏 HTML(浏览器)返回错误页面,否则返回平面 JSON `{code, message, ...context}`,并保留 HTTP 状态码。前端 `lib/api.ts` 的 `ApiError` 把同一个形状还原成对象。

## 操作符两端必须同步改

前端有一个操作符注册表,后端引擎有对应的处理器,两边是**两套代码一个契约**:

- 前端:`src/features/operators/registry.ts`(`OPERATORS`,含 `type`/`label`/`category`/`defaultArgs`)、`operator-forms.tsx`(表单)、`model.ts`(导入旧数据时的归一化)、`pipeline-editor.tsx`
- 后端:`src/server/core/proxy-utils/processors/index.ts` 里的 `PROXY_PROCESSORS`

新增或改操作符时两边都要动。注意 `args` 的**序列化形状不统一**:`Sort Operator` 是裸字符串,`Regex Rename/Delete` 是数组,其余是对象 —— 前端 `model.ts` 已经有一堆向后兼容的归一化逻辑,改动时别破坏它。

## 脚本沙箱(Dynamic Workers)

用户脚本(`Script Operator`、`Response Transformer` 等)不经过 `new Function`(Workers 禁用),而是走 `core/sandbox/loader.ts` + `worker_loaders`:

- 用户脚本被拼进沙箱模块的 `makeOperator` 函数体,按脚本内容哈希复用热实例;`stub` 每次执行重新取(Workers 禁止跨请求复用 I/O 对象)。
- 沙箱内注入:`lodash`、`yaml`、`flowUtils`(单文件 ESM,来自 `sandbox/vendor/*.esm.js` 与 `flow-utils.js`,以 `?raw` 文本嵌入)、`Buffer`、`b64d/b64e`、`$sukiSub`。
- 运行环境变量名是 `$sukiSub`(不是 `$`);`ProxyUtils` 只暴露 `yaml`/`Buffer`/`Base64`,其余调用会抛明确错误;`$.write`/`$.delete`/`scriptResourceCache`/`produceArtifact` 在沙箱内不可用。
- `sandbox/vendor/**` 与 `flow-utils.js` 是**资源文件而非工程文件**,eslint 已忽略、tsconfig 不含 `.js`;不要按 TS 规范去改它们的风格。

## Workers 运行时的硬约束(改引擎时必须记住)

| 需求 | 本项目做法 |
| --- | --- |
| `new Function` | 禁用,走上面的 Dynamic Workers 沙箱 |
| `peggy.generate()` 运行时生成解析器 | 构建期预生成 `parsers/peggy/*.gen.ts`;语法在 `grammars/*.peggy`,重新生成命令写在同目录同名 `.ts` 文件头部注释 |
| undici / 自定义代理 | 用原生 `fetch`,代理参数只告警 |
| MMDB / geoip2 | 改为名称回退识别(`core/utils/geo.ts`) |
| DNS udp/tcp | 只支持 DoH(`core/utils/dns.ts`) |
| 进程内 cron 调度 | 改为 Cron Triggers |
| 本地文件(文件型脚本、`fs`) | 不支持,抛明确错误 |

## 鉴权

单用户 OIDC(Authorization Code + PKCE S256),没有独立登录页:

- `/api/*`:`auth/oidc.ts` 的中间件校验 Bearer JWT(iss/aud/exp,JWKS 由 jose 缓存),**同时**接受浏览器会话 cookie;`/s/:id` 分享链接是公开端点,不鉴权。
- 浏览器登录流在 `auth/login.ts`:任意页面未登录 → `/auth/login` → IdP → `/auth/callback` 写 HttpOnly cookie(`su_at`/`su_rt`/`su_id`/`su_user`);`/auth/session` 用 refresh token 自动续期(要求 `offline_access` scope)。
- 校验 `aud` 时同时兼容 `aud = client_id` 与 `aud = <issuer>/userinfo`(suki-auth 约定)。
- 前端登录门是 `src/routes/_app.tsx` 里的 `AuthGate`(`components/app-shell.tsx`)。

## 前端结构

- 路由是 TanStack Start 的 file-router:`src/routes/`。`routeTree.gen.ts` 由 `pnpm generate-routes` 生成,VSCode 里设为只读,不要手改。页面路由都在 `_app` 布局下(含登录门):`/subs`、`/shares`、`/logs`、`/settings`,编辑页是 `subs_.$name.tsx` 与 `collections_.$name.tsx`(下划线转义表示非嵌套子路由)。
- `src/shared/api-contract.ts` 是**唯一的接口契约来源**,前端直接 import 它拼路径(`ApiRoutes`/`AuthRoutes`),不要手写 URL 字符串。后端加接口时同步更新该文件。
- 服务端状态一律走 react-query hooks(`src/lib/queries.ts`,query key 集中在 `qk`),请求经 `src/lib/api.ts`(401 时先试 `/auth/session` 再重试一次)。
- UI:基础组件在 `components/ui/`(shadcn 风格),应用组件在 `components/shared/` 与 `components/subs/`;`features/operators/` 是管线编辑器领域模块。
- 样式:Tailwind v4,设计令牌定义在 `src/styles.css` 的 `@theme`/CSS 变量里,来源是 `DESIGN.md`(Geist:近白画布 + 近黑墨色,层级靠 1px 发丝线和灰阶文字阶梯,不靠阴影;链接蓝 `#0070f3` 只用于链接/聚焦)。改视觉前先读 DESIGN.md 的 Do's and Don'ts。

## 代码风格

Prettier:`semi: false`、`singleQuote: true`、`trailingComma: 'all'`,行宽默认 80。TypeScript 开 `strict` + `noUnusedLocals` + `noUnusedParameters` + `verbatimModuleSyntax`(类型导入要写 `import type`)。导入别名 `#/*` 指向 `src/*`(tsconfig 里 `@/*` 也指向同一目录,但代码中已经统一用 `#/`,不要引入 `@/`)。

eslint 用 `@tanstack/eslint-config`,但关掉了 `import/order`、`sort-imports`、`import/no-cycle`、`require-await` 等规则 —— 不必纠结导入顺序。
