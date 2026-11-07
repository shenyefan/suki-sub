# Sub-Store 增量同步：2026-11-07

## 核对范围

上次记录：版本 **2.42.3**，`a3e61061e50b40e5c5938969aab915d05d8d7069`。

本次 GitHub API 实时读取：版本 **2.44.5**，`526e83ed964c34dc157acbdcdade3991eede7084`（2026-11-06）。[上游差异](https://github.com/sub-store-org/Sub-Store/compare/a3e61061e50b40e5c5938969aab915d05d8d7069...526e83ed964c34dc157acbdcdade3991eede7084) 共 26 个提交。本次核对并移植此范围的适用增量，不能据此声称所有模块已与上游全量一致。

## 已应用

| 上游提交 | 能力与本地位置 |
| --- | --- |
| `9cc6b5fac966` | `produce-artifact.ts` 支持内部调用 `includeRaw: true`，返回 `{ result, raw }`；兼容订阅/组合及别名、原始/内部/文本输出和兜底模式。不传时保持原返回值，不改变传入处理器的原始内容。此选项未增加公开下载参数，也未向用户脚本开放新的沙箱接口。 |
| `11baf1280bad` | sing-box WireGuard 支持顶层 `allowed-ips` / `allowed_ips`，字符串拆分为 CIDR 数组，peer 自身配置优先，缺省回退保持一致。 |
| `eda9781cc36d`、`f9cfc754bc7f`、`8c3fc5767db2` | Trojan / AnyTLS URI 密码百分号编码；AnyTLS 只解码一次，保留密码里的字面百分号。 |
| `24faf5e05210` | Trojan 先分离名称再判断默认端口，修复没有查询参数时名称被追加端口和解析失败。 |
| `9404971feb81` | VMess URI 输出保留全部 h2 host。 |
| `e043346d1360` | Mihomo Snell v6 模式、PSK UTF-8 字节长度与混淆校验；清理旧版本的 mode / UDP；Snell ShadowTLS 解析和产出保留扩展参数。 |
| `526e83ed964c` | Egern WireGuard 同时接受 `preshared-key` 与 `pre-shared-key`。 |

## 已有能力与不适用项

- `c532eda4b63d` 的永久分享：本项目已有“永久”选项，D1 记录不设置 `endAt` 即长期有效；沿用当前契约，不引入上游的 `expiresUnit` 结构。
- `ffc0a213c1cb` 的小写 `clash` 别名：本地注册表已经存在，无需重复添加。
- `c1018115a7ee` 的 Gist 改进：Token 保存和定时备份读取时已去空格；没有使用 `githubUser`。本地下载仅接收文件名，不存在上游多余的 `gists` 实参。定时备份使用当前 Workers 实现，不移植上游 Node 路由和 Express 行为。
- Node.js、依赖升级、Express 请求体兼容、发布版本号、README 和演示脚本不覆盖本地实现；Workers 原生 fetch、Dynamic Workers 沙箱、D1 / AsyncLocalStorage 和前端操作符契约保持现有架构。
- 此范围没有操作符注册、Peggy 语法、规则集、预处理器的新增改动，不需要重新生成解析器或修改前端表单。适用的引擎增量已同步，无此范围内已知待移植的引擎功能。

## 本地模板顺序修复

Mihomo v1.19.33 的 [配置解析](https://github.com/MetaCubeX/mihomo/blob/v1.19.33/config/config.go) 会按名称排序自动包含的节点列表。因此 SUKI SUB 的节点数组虽然有序，策略组的 `include-all: true` 仍会让客户端顺序变化。

对 Mihomo / ClashMeta 及其别名的模板，在所有模板合并完成后，将 `include-all` / `include-all-proxies` 对应的本次产出节点按管线顺序展开到 `proxies`。显式入口优先，重复节点去重；`include-all` 同时转为 `include-all-providers: true`，动态 provider 继续由内核加载。纯手动组、仅包含 provider 的组及 Clash / Stash 输出保持原行为。过滤无结果时沿用内核空组回退。

本地节点包含过滤使用 JavaScript 正则，额外支持前置 `(?i)` / `(?m)` / `(?s)` 及反引号分隔；不能编译的表达式明确报错。Mihomo 特有的 .NET 正则语法不保证兼容，可使用显式节点列表。provider 的过滤、排除名称与类型仍交给内核。

## 验证

- `tests/upstream-sync.test.mjs` 使用实际引擎验证 URI 往返、Snell v6、WireGuard、原始内容和模板处理链路。
- 可选真实内核测试：`MIHOMO_BIN=/path/to/mihomo pnpm test`。隔离临时目录，通过本机 Unix socket 读取策略组，覆盖 `z、a、m` 顺序、显式入口、过滤、inline provider、空组回退；不修改运行中的客户端配置，不开启系统代理。
- 本次已使用本机 Mihomo **v1.19.33** 完成上述真实内核验收。
- 运行类型、lint、格式、全套回归测试及生产构建；不启动浏览器，不自动部署。

## 逐项核对的提交

- [`9cc6b5fac966`](https://github.com/sub-store-org/Sub-Store/commit/9cc6b5fac966993364ae33da8797f446bbf7f571) feat: produceArtifact 可通过 includeRaw: true 同时返回处理结果和 context.raw 对应的原始内容
- [`c532eda4b63d`](https://github.com/sub-store-org/Sub-Store/commit/c532eda4b63d5a7f654acba58fe2651ebce0c7dd) feat: add lifetime duration
- [`4b40483cb0c1`](https://github.com/sub-store-org/Sub-Store/commit/4b40483cb0c19e252891b30c71243c2ed2b6e1b2) release: bump backend version to 2.42.5
- [`832d3a0412bf`](https://github.com/sub-store-org/Sub-Store/commit/832d3a0412bf92e79b46d6610217117010c589ec) Merge pull request #657: add lifetime duration
- [`11baf1280bad`](https://github.com/sub-store-org/Sub-Store/commit/11baf1280bad7bc06de84272deaa8b6a9b78d4c1) fix: short-styled input won't cast allowed-ips correctly
- [`7749da345f9a`](https://github.com/sub-store-org/Sub-Store/commit/7749da345f9af79eaa39fdb9223ead57fa6807bf) Merge pull request #658 from imduaky/fix/wireguard_allowd_ip
- [`1f0318bc6feb`](https://github.com/sub-store-org/Sub-Store/commit/1f0318bc6feb46fbe204836f32ca7acab37ea67e) release: bump version
- [`fdcf3243d6ff`](https://github.com/sub-store-org/Sub-Store/commit/fdcf3243d6ff2583c22afa0c2a3e1e97097192e5) feat: 升级 Node.js 和依赖版本
- [`a6d09c7aaae8`](https://github.com/sub-store-org/Sub-Store/commit/a6d09c7aaae8bb59daa76618fb846c51e65c3859) feat: 更新依赖
- [`eda9781cc36d`](https://github.com/sub-store-org/Sub-Store/commit/eda9781cc36dec83d7eb4ba23768a37f85b78f4b) fix(uri): percent-encode the trojan password
- [`24faf5e05210`](https://github.com/sub-store-org/Sub-Store/commit/24faf5e05210f36a2204733abd715ada78d0bd3f) fix(trojan): keep the URI name when there is no query string
- [`f9cfc754bc7f`](https://github.com/sub-store-org/Sub-Store/commit/f9cfc754bc7f0ca13776bcbc1edffe5ee3459fed) fix(uri): percent-encode the anytls password too
- [`9404971feb81`](https://github.com/sub-store-org/Sub-Store/commit/9404971feb8153db33db53175dd93b02e2cc919f) fix(vmess): keep all h2 hosts in the URI
- [`b409a222a8dc`](https://github.com/sub-store-org/Sub-Store/commit/b409a222a8dcbff850025c7acca3cb92c2ad8a2a) Merge pull request #661: encode Trojan and AnyTLS URI passwords
- [`8c3fc5767db2`](https://github.com/sub-store-org/Sub-Store/commit/8c3fc5767db22d303d6f1b89766766af09f9dbbe) fix: AnyTLS 重复解码密码
- [`0c6f8f0e87b5`](https://github.com/sub-store-org/Sub-Store/commit/0c6f8f0e87b546489ac3b6c67c7cb587c8d04a54) Merge pull request #662: fix Trojan URI names without query strings
- [`1613ea5b2c07`](https://github.com/sub-store-org/Sub-Store/commit/1613ea5b2c07ed106efc1d8d190f1e302de6221a) Merge pull request #663: preserve VMess h2 host lists
- [`3bf80da94493`](https://github.com/sub-store-org/Sub-Store/commit/3bf80da94493bb5f5185a6b4afb2729eaa6ea17b) release: bump version
- [`f29733362fef`](https://github.com/sub-store-org/Sub-Store/commit/f29733362fefc6d321a7fd4f3d336068e777eede) feat: 更新依赖
- [`c1018115a7ee`](https://github.com/sub-store-org/Sub-Store/commit/c1018115a7eee4cdcb9042cce5e94afda41e48ba) feat: 优化 Gist 逻辑
- [`ffc0a213c1cb`](https://github.com/sub-store-org/Sub-Store/commit/ffc0a213c1cbb4c870c26247b49c7d18dce3eea4) fix(producers): 补全 clash 目标的小写别名
- [`6e3d4c28dd16`](https://github.com/sub-store-org/Sub-Store/commit/6e3d4c28dd16004ecfadd26eddb5abfdd2912212) Merge pull request #664 from FaintGhost/fix/lowercase-clash-target
- [`352f01b7091c`](https://github.com/sub-store-org/Sub-Store/commit/352f01b7091c99f4e219c44e4ec96f3288059843) docs: README
- [`e043346d1360`](https://github.com/sub-store-org/Sub-Store/commit/e043346d1360f4710d51213757099ddff2ce3f5e) feat: mihomo 支持 Snell v6
- [`ae85aa63b0c1`](https://github.com/sub-store-org/Sub-Store/commit/ae85aa63b0c1699dafde0894a0a1c29d24d5af51) feat: 更新依赖
- [`526e83ed964c`](https://github.com/sub-store-org/Sub-Store/commit/526e83ed964c34dc157acbdcdade3991eede7084) fix: 修复 Egern WireGuard preshared_key

