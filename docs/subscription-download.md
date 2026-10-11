# 订阅下载参数与响应头

分享下载使用 `/s/:id` 或 `/s/:id/:target`，只读取分享绑定的订阅或组合。参数参考 [Sub-Store 下载实现](https://github.com/sub-store-org/Sub-Store/blob/master/backend/src/restful/download.js)；本项目仍使用 Workers 的原生请求与脚本沙箱。

## 平台与输出

平台优先级为路径 `target`、查询 `platform`、查询 `target`、客户端识别。识别参考 [Sub-Store UA 规则](https://github.com/sub-store-org/Sub-Store/blob/master/backend/src/utils/user-agent.js)，补充 mihomo；普通 Clash 与 Clash Meta 分开识别。无法识别时，`Accept` 以 `application/json` 开头则输出 JSON，否则输出 V2Ray，与 Sub-Store 一致。

| 参数 | 行为 |
| --- | --- |
| `target` / `platform` | 引擎支持的平台和别名，例如 `Clash`、`ClashMeta`、`mihomo`、`SurgeMac`、`sing-box`、`QX` |
| `ua` | 传给引擎的请求 UA；资源配置的 `ua` / `passThroughUA` 决定最终使用值 |
| `noCache` | 绕过订阅文本和流量缓存，成功后仍更新缓存；资源自身 `noCache` 同样生效 |
| `noFlow` | 跳过流量获取与流量头；资源自身开启时不能用查询参数关闭 |
| `produceType` | `text`（默认）、`raw`（原始数据）、`internal`（平台内部结构，以 JSON 返回） |
| `includeUnsupportedProxy` | 将包含不受支持节点的选项传给平台产出器 |
| `prettyYaml` / `pretty-yaml` | YAML 格式化；两个参数同时存在时优先 `prettyYaml` |
| `ignoreFailedRemoteSub` | `true` / `1` / 空值启用静默忽略，`false` / `0` 关闭；也接受引擎模式 `enabled`、`quiet`、`disabled`、`fallbackNotify`、`fallbackQuiet` |
| `mihomoExternal` | SurgeMac 下强制使用 mihomo 外部代理配置 |
| `mihomoMerge` / `mihomoMergeName` | SurgeMac 下合并外部代理配置及指定合并名称 |
| `mihomoLocalPort` | SurgeMac 下指定本机端口，必须为 1–65535 整数 |
| `$options` | JSON 对象或编码后的 `key=value&flag`，传给节点脚本及响应转换器 |

布尔开关支持空参数、`true`、`1`、`enabled`、`on`；`false`、`0`、`off` 不会因为字符串非空而启用。`ignoreFailedRemoteSub=enabled` 保留引擎通知语义。

`$options._req` 包含实际 method、url、path、query、params、headers，调用者不能覆盖这份请求上下文。`$options._res.headers` 可设置响应头，值为 `null` 时删除；`$options._res.status` 可设置 200–599 状态码。随后资源的 Response Transformer 可以再次修改响应头、正文和状态码。204、205、304 按 HTTP 规则不返回正文。

分享不支持 `url`、`content`、`mergeSources`、`fakeSub`、`fakeNode`、`_fakeNode` 替换输入，也不支持 Workers 无法实现的 `proxy`、`insecure`，传入会明确报错。

## 文件名与响应头

- 默认名称为资源显示名称，未配置则使用内部名称；组合遵循同一规则。
- `Content-Disposition` 同时提供 ASCII `filename` 与 UTF-8 `filename*`，按 [RFC 6266](https://www.rfc-editor.org/rfc/rfc6266) 编码中文并过滤控制字符及文件路径字符。[Clash Verge Rev](https://github.com/clash-verge-rev/clash-verge-rev/blob/main/src-tauri/src/config/prfitem.rs) 导入时优先从 `filename*` 读取名称。
- 默认扩展名：Clash/Meta/Stash/Egern 为 `.yaml`；JSON/sing-box 为 `.json`；Surge/SurgeMac/Loon/QX/Surfboard 为 `.conf`；URI/V2Ray/Shadowrocket 为 `.txt`。`raw` 为 `.txt`，`internal` 为 `.json`，age 加密为 `.age`。
- `Profile-Title` 提供 `base64:` 编码的名称，供支持该头的客户端使用；不依赖客户端支持此头来提供文件名。
- JSON 输出设置 `application/json; charset=utf-8`，其余输出为 UTF-8 文本。原始资源 JSON 导出也使用相同的文件名编码规则。
- 默认头在响应转换器之前设置，自定义响应头和脚本可以覆盖或删除默认名称。

Sub-Store 当前下载实现没有默认文件名头；本项目在参数对齐之外补充文件名，解决客户端回落到分享 ID 或路径末段作为名称的问题。

## 流量与加密

单订阅使用首个非空远程 URL，不把多行地址作为一个 URL 请求。本地订阅仅在 `localFirst` / `remoteFirst` 合并远程来源时获取远程流量。自定义 `subUserinfo` 可以是流量文本或返回流量正文的 HTTP 地址，其字段优先于上游。

组合的基础信息新增“流量信息”设置：

- 第一个成员：默认跟随组合排序，也支持远程 URL 成员。
- 指定一个成员：仅使用选中的组合成员作为流量来源。
- 汇总多个成员：所选成员去重后累加上传与下载；只有每个来源都有正数总额度时才返回总额度，否则保留已用量而不虚构额度。到期时间取最早的有效日期。任何来源缺失时不返回部分汇总。
- 自定义流量信息：接受流量头文本或 HTTP / HTTPS 地址，通过 GET 读取正文或响应头。
- 不显示流量信息：关闭卡片展示及下载默认流量头。

新设置保存在组合 `extra.flowSource` 中，无需数据库结构迁移。没有新设置的组合保留原有 `firstSubFlow`、`subUserinfo` 行为。显式选择新模式后按该模式获取，旧自定义字段不再覆盖选中来源。保存时校验所选来源属于当前组合；成员重命名或删除时同步更新流量引用。

组合卡片通过 `/api/collections/:name/flow` 获取流量，与分享下载共用同一个解析和汇总入口；“刷新流量”使用 `noCache=true`。修改组合或成员会取消旧流量请求并使组合流量缓存失效。

`noFlow` 同时约束响应转换器中的远程流量请求。链接片段支持 `flowUserAgent`、`flowUrl`、`flowHeaders` 与缓存配置；GET 正文流量缓存与 HEAD 响应头缓存分开，默认一小时，见 [缓存规则](./kv-cache.md)。

age 公钥优先级为分享配置、`x-suki-sub-share-age-public-key` 请求头、资源配置。编辑页保存的 `agePublicKey` 与引擎字段 `age-public-key` 均能被读取；非法公钥由加密器返回错误。

## 校验边界

已通过不启动浏览器的接口断言，覆盖中文文件名解码、平台识别、参数传递、脚本响应覆盖、组合流量、自定义正文流量、缓存绕过与隔离、age 公钥选择。断言中使用实际 Hono 下载路由、流量获取和响应后处理代码，存储、上游请求及引擎产出使用替身；另执行类型、lint、格式及生产构建检查。没有在真实 Clash 客户端内导入，也没有部署线上。
