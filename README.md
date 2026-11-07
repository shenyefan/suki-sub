# SUKI SUB

部署在 Cloudflare Workers 上的 Suki Sub 订阅管理面板(前后端一体)。

- 订阅引擎使用 TypeScript，支持节点解析、操作管线和多平台输出；客户端通过 `/s/:id` 分享链接订阅。
- 前端:React 19 + TanStack Start + shadcn/ui(Geist 设计规范,见 DESIGN.md),桌面侧栏 / 手机底栏自适应
- 持久化:D1(3NF 规范化表);时效数据:KV(订阅缓存);分享记录:D1
- 定时任务:Workers Cron Triggers(Gist 自动备份)
- 脚本操作符:官方 [Dynamic Workers](https://developers.cloudflare.com/dynamic-workers/)(`worker_loaders`)沙箱执行用户脚本 —— **需要 Workers 付费计划**

## Sub-Store 参考版本

订阅处理引擎参考 [Sub-Store](https://github.com/sub-store-org/Sub-Store)，并以 TypeScript 移植、适配 Cloudflare Workers。当前参照版本为 **Sub-Store 2.44.5**，对应提交 [`526e83ed964c34dc157acbdcdade3991eede7084`](https://github.com/sub-store-org/Sub-Store/commit/526e83ed964c34dc157acbdcdade3991eede7084)，核对日期为 **2026-11-07**。

该版本是按功能核对和同步的参考基准，不代表与上游全量一致；运行时使用本仓库引擎，不会自动拉取上游脚本。新增功能、适配范围和验证结果见 [Sub-Store 同步记录](docs/upstream-sync-2026-11-07.md)。

## 架构

```
src/
├── shared/            # 前后端共享:资源类型、常量、API 契约(前端直接消费 api-contract.ts)
├── routes/            # TanStack Start 前端路由(页面,_app 布局含登录门)
├── components/        # shadcn/ui 基础组件(ui/)+ 应用组件(shared/、subs/)
├── features/          # 领域模块:操作符注册表与管线编辑器(operators/)
├── lib/               # API 客户端、react-query hooks、格式化工具
└── server/            # 后端全部代码
    ├── worker-entry.ts   # 自定义 Worker 入口:/api|/auth|/s → Hono;其余 → TanStack SSR;scheduled → 定时任务
    ├── app.ts            # Hono 组装 + 鉴权中间件 + 统一错误处理
    ├── api/              # REST 模块(subs/collections/modules/settings/shares/download/preview/flow/miscs/logs)
    ├── auth/             # OIDC 管理接口(oidc.ts)+ 浏览器登录流(login.ts)+ 只读 token(/download)
    ├── store/            # D1(3NF 映射)+ KV + 每请求资源快照(EngineStore)
    ├── core/             # 订阅处理引擎:proxy-utils(parsers/processors/producers)、produceArtifact、utils
    │   └── sandbox/      # 脚本操作符沙箱(Dynamic Workers;lodash/yaml 单文件 ESM 随沙箱分发)
    └── jobs/             # 定时任务(Gist 备份)
migrations/               # 完整 D1 初始化结构(0001_init.sql)
```

## 登录

单用户 OIDC(Authorization Code + PKCE S256,无独立登录页),IdP 使用 [suki-auth](https://auth.syf.sh):

- 未登录访问任意页面 → 前端直接整页跳 `/auth/login` → IdP 授权 → `/auth/callback` 兑换并写入 HttpOnly 会话 cookie(`su_at` / `su_rt` / `su_id` / `su_user`)
- `/api/*` 接受 `Authorization: Bearer`(脚本调用)或会话 cookie(浏览器)
- access token 过期时 `/auth/session` 自动用 refresh token 续期(要求授权 scope 含 `offline_access`)
- token 兑换优先 HTTP Basic 客户端认证,被拒后回退 client_secret_post;无 secret 时按公共客户端纯 PKCE
- access token 校验兼容 `aud = client_id` 与 `aud = <issuer>/userinfo`(suki-auth 约定)两种签发方式
- 错误响应根据 Accept 返回 HTML 错误页面或平面 JSON，保留原 HTTP 状态码
- IdP 侧客户端注册:client_id = `OIDC_AUDIENCE`,回调地址 `<origin>/auth/callback`,allowed_scopes 需含 `openid profile email offline_access`,启用 PKCE

## API 概览

完整契约见 `src/shared/api-contract.ts`。

- 管理接口 `/api/*`:OIDC Bearer JWT(`OIDC_ISSUER` / `OIDC_AUDIENCE` 环境变量校验 iss/aud/exp)
- 分享链接 `/s/:id`（可选 `/s/:id/:target`）：每个分享只访问绑定的单条订阅或组合订阅，支持有效期和次数限制；未指定平台时自动识别客户端。分享记录存于 D1，过期后仍保留；旧 KV 分享通过一次性迁移导入，原 ID 和链接不变；运行时只读取 D1。
- 管理接口：`/api/subs/:name`、`/api/collections/:name`、`/api/shares`、`/api/settings`、`/api/backup`、`/api/logs`。
- 日志支持按事件类型、操作者 ID、请求 ID、操作结果组合筛选，范围为最近保留的 2000 条记录。
- 页面：`/subs`、`/shares`、`/settings`、`/logs`；编辑页为 `/subs/:name` 与 `/collections/:name`。
- 响应约定:成功直接返回数据 + 恰当状态码;失败 `{code,message,...context}`

## 本地开发

```bash
pnpm install
cp .dev.vars.example .dev.vars      # 填 OIDC 配置(issuer / client id / secret)
pnpm dev                            # http://localhost:3000(vite 插件提供本地 D1/KV)
```

本地回调地址为 `http://localhost:3000/auth/callback`,需加入 IdP 客户端的 redirect URIs。

操作符使用统一类型名(如 `Script Operator`、`Flag Operator`),脚本内容放在 `item.args.content`。

## 自动依赖更新与校验

`.github/dependabot.yml` 配置 GitHub Dependabot，每周一北京时间 09:00 检查 pnpm 依赖和 GitHub Actions，自动创建更新 PR。TanStack、React 相关包分别成组，其余 minor/patch 更新合并成组，其他 major 更新独立提交；npm 依赖最多同时打开 5 个版本更新 PR。

配置推送到 GitHub 默认分支后生效，无需额外机器人 Token。PR 由人工审核合并；安全告警及安全更新需在仓库 Settings → Advanced Security 中单独开启。

`.github/workflows/ci.yml` 在 push、PR 和手动触发时使用 Node.js 24 与 `package.json` 声明的 pnpm 版本，按锁文件安装，运行类型、lint、格式、回归测试和生产构建，无需 OIDC 或 Cloudflare 凭据。`pnpm test` 使用内存 SQLite 和实际引擎，不访问真实订阅服务。

### Cloudflare 分支构建

依赖更新 PR 使用 GitHub Actions 校验，合并到生产分支后再由 Cloudflare 部署。若不需要为每个 PR 创建在线预览，可在 Worker 的 **Settings → Build → Branch control** 关闭 **Enable Preview Builds**；生产分支保留构建命令 `pnpm run build`、部署命令 `pnpm exec wrangler deploy`。

若日志显示构建成功，随后 `wrangler preview` 报 `missing a previews block`，原因是分支预览缺少独立配置，并非依赖安装或应用构建失败。本仓库已添加 `previews.placement.mode = "smart"`；预览 D1、KV、脚本沙箱绑定和 OIDC secrets 仍需按 [Worker Previews 文档](https://developers.cloudflare.com/workers/previews/get-started/) 配置。此配置块解决缺少 `previews` 的问题，不代表预览应用的资源已齐备。`preview_urls: false` 不等同于关闭 Workers Builds 的分支构建。预览命令与生产部署命令应分别配置，不能把依赖 PR 的预览命令改成生产部署。

## 部署

D1 与 KV 绑定统一使用 `SUKI_SUB_DB`、`SUKI_SUB_CACHE`，部署环境需使用相同名称。已有资源可继续绑定原来的资源 ID。脚本运行环境注入 `$sukiSub`；自定义脚本应使用这个名称。缓存键与分享加密请求头统一使用 `suki-sub` 前缀。

```bash
wrangler d1 create suki-sub                        # 把返回的 database_id 填入 wrangler.jsonc
wrangler kv namespace create SUKI_SUB_CACHE       # 把返回的 id 填入 wrangler.jsonc
wrangler secret put OIDC_ISSUER                    # 或用 vars
wrangler secret put OIDC_AUDIENCE
wrangler secret put OIDC_CLIENT_SECRET             # 机密客户端必填
wrangler d1 migrations apply suki-sub --remote
pnpm deploy
```

数据库只保留一份完整初始化脚本 `migrations/0001_init.sql`，用于新实例；旧的独立建表脚本已合并。已有实例的分享表保持原状，通知限频表会在首次发送通知时自动创建，无需重新执行初始化或清空数据。

## Workers 运行时能力

| 运行需求                            | 本项目实现                                                                                                            |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `new Function` 脚本操作符           | Dynamic Workers 沙箱(RPC 传参与回传,注入 lodash/yaml/Buffer/flowUtils)                                                |
| `peggy.generate()` 运行时生成解析器 | 构建期预生成(`src/server/core/proxy-utils/parsers/peggy/*.gen.ts`;语法在 `grammars/*.peggy`,重新生成命令见文件头注释) |
| undici/自定义代理拉取订阅           | 原生 fetch(代理参数告警忽略)                                                                                          |
| MMDB(geoip2-node)国旗库             | 名称回退识别(非 Node 环境适配)                                                                                        |
| DNS udp/tcp 查询                    | 仅 DoH                                                                                                                |
| 进程内 cron 库调度 artifact         | Cron Triggers(现仅 Gist 备份)                                                                                         |
| 本地文件(file: 脚本、fs)            | 不支持,抛明确错误                                                                                                     |

## Styling

前端使用 [Tailwind CSS](https://tailwindcss.com/)。

KV 缓存的内容、有效期和更新规则见 [缓存说明](docs/kv-cache.md)。

Telegram 通知的分类、开关优先级和限频规则见 [通知说明](docs/notifications.md)。
