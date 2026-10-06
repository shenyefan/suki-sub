import { resourceLabel } from '#/lib/resource-display'
import { BaseError, RequestInvalidError, ResourceNotFoundError } from './errors'
import { resourceFailure } from '#/server/core/utils/diagnostics'
/**
 * 产出编排:订阅/组合 → 拉取 → 解析 → 操作符 → 产出。
 */
import $ from '#/server/core/app'
import { COLLECTIONS_KEY, RULES_KEY, SUBS_KEY } from '#/server/core/constants'
import { findByName } from '#/server/core/utils/database'
import download from '#/server/core/utils/download'
import { ProxyUtils } from '#/server/core/proxy-utils/index'
import { RuleUtils } from '#/server/core/rule-utils/index'
import { applyConfigTemplates } from './utils/config-template'

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
const IGNORE_FAILED_REMOTE_SUB_NOTIFY_MODES = new Set([
  'enabled',
  'fallbackNotify',
])
const IGNORE_FAILED_REMOTE_SUB_FALLBACK_MODES = new Set([
  'fallbackNotify',
  'fallbackQuiet',
])

function normalizeIgnoreFailedRemoteSub(mode: any) {
  if (mode === true) return 'quiet'
  if (mode === false || mode == null || mode === '') return 'disabled'
  return mode
}

function resolveIgnoreFailedRemoteSubMode(...values: any[]) {
  for (const value of values) {
    if (value != null && value !== '') {
      return normalizeIgnoreFailedRemoteSub(value)
    }
  }

  return 'disabled'
}

function shouldNotifyIgnoreFailedRemoteSub(mode: any) {
  return IGNORE_FAILED_REMOTE_SUB_NOTIFY_MODES.has(
    normalizeIgnoreFailedRemoteSub(mode),
  )
}

function shouldFallbackIgnoreFailedRemoteSub(mode: any) {
  return IGNORE_FAILED_REMOTE_SUB_FALLBACK_MODES.has(
    normalizeIgnoreFailedRemoteSub(mode),
  )
}

function handleIgnoreFailedRemoteSubError({
  mode,
  message,
  notify,
  error,
}: any) {
  const resolvedMode = normalizeIgnoreFailedRemoteSub(mode)

  if (
    resolvedMode === 'disabled' ||
    shouldFallbackIgnoreFailedRemoteSub(resolvedMode)
  ) {
    throw error ?? new Error(message)
  }

  if (shouldNotifyIgnoreFailedRemoteSub(resolvedMode)) {
    notify?.(message)
  }
}

function notifyIgnoreFailedRemoteSubFallback({ mode, notify, error }: any) {
  if (!shouldNotifyIgnoreFailedRemoteSub(mode)) return
  notify?.(error)
}

function buildEmptySubscriptionOutput({
  platform = 'JSON',
  produceType,
  produceOpts = {},
}: any) {
  if (produceType === 'raw') {
    return JSON.stringify([])
  }

  return ProxyUtils.produce([], platform, produceType, produceOpts)
}

async function produceArtifact({
  type,
  name,
  platform,
  url,
  ua,
  content,
  mergeSources,
  ignoreFailedRemoteSub,
  produceType,
  produceOpts = {},
  subscription,
  awaitCustomCache,
  $options,
  proxy,
  noCache,
  noFlow,
  validation = false,
}: any) {
  platform = platform || 'JSON'

  if (['subscription', 'sub'].includes(type)) {
    let sub
    if (name) {
      const allSubs: any = $.read(SUBS_KEY)
      sub = findByName(allSubs, name)
      if (!sub)
        throw new ResourceNotFoundError(
          'SUBSCRIPTION_NOT_FOUND',
          '订阅不存在',
          { subscription: name },
        )
    } else if (subscription) {
      sub = subscription
    } else {
      throw new RequestInvalidError(
        'INVALID_SUBSCRIPTION',
        '未提供订阅名称或订阅数据',
      )
    }
    const subIgnoreFailedRemoteSub = resolveIgnoreFailedRemoteSubMode(
      ignoreFailedRemoteSub,
      sub.ignoreFailedRemoteSub,
    )
    const requestUA = sub.passThroughUA ? ua : sub.ua || ua
    const skipFlow = noFlow || sub.noFlow

    try {
      let raw
      let sourceRaw
      if (content && !['localFirst', 'remoteFirst'].includes(mergeSources)) {
        raw = content
        sourceRaw = content
      } else if (url) {
        const errors: any = {}
        const downloaded = await Promise.all(
          url
            .split(/[\r\n]+/)
            .map((i: string) => i.trim())
            .filter(
              (i: string, index: number, lines: string[]) =>
                i.length && lines.indexOf(i) === index,
            )
            .map(async (remoteUrl: string) => {
              try {
                return await download(
                  remoteUrl,
                  requestUA,
                  undefined,
                  proxy || sub.proxy,
                  undefined,
                  awaitCustomCache,
                  noCache || sub.noCache,
                  true,
                  { returnRaw: true, noFlow: skipFlow },
                )
              } catch (err) {
                errors[remoteUrl] = err
                return ''
              }
            }),
        )
        raw = downloaded.map((i: any) => i.result ?? i)
        sourceRaw = downloaded.map((i: any) => i.raw ?? i)

        if (Object.keys(errors).length > 0) {
          const error = resourceFailure(`订阅「${resourceLabel(sub)}」`, errors)
          const message = error.message
          handleIgnoreFailedRemoteSubError({
            mode: subIgnoreFailedRemoteSub,
            error,
            message,
            notify: () => {
              $.notify(`🌍 Suki Sub 处理订阅失败`, `❌ ${sub.name}`, message)
            },
          })
        }
        if (mergeSources === 'localFirst') {
          raw.unshift(content)
          sourceRaw.unshift(content)
        } else if (mergeSources === 'remoteFirst') {
          raw.push(content)
          sourceRaw.push(content)
        }
      } else if (
        sub.source === 'local' &&
        !['localFirst', 'remoteFirst'].includes(sub.mergeSources)
      ) {
        raw = sub.content
        sourceRaw = sub.content
      } else {
        const errors: any = {}
        const downloaded = await Promise.all(
          sub.url
            .split(/[\r\n]+/)
            .map((i: string) => i.trim())
            .filter(
              (i: string, index: number, lines: string[]) =>
                i.length && lines.indexOf(i) === index,
            )
            .map(async (remoteUrl: string) => {
              try {
                return await download(
                  remoteUrl,
                  requestUA,
                  undefined,
                  proxy || sub.proxy,
                  undefined,
                  awaitCustomCache,
                  noCache || sub.noCache,
                  true,
                  { returnRaw: true, noFlow: skipFlow },
                )
              } catch (err) {
                errors[remoteUrl] = err
                return ''
              }
            }),
        )
        raw = downloaded.map((i: any) => i.result ?? i)
        sourceRaw = downloaded.map((i: any) => i.raw ?? i)

        if (Object.keys(errors).length > 0) {
          const error = resourceFailure(`订阅「${resourceLabel(sub)}」`, errors)
          const message = error.message
          handleIgnoreFailedRemoteSubError({
            mode: subIgnoreFailedRemoteSub,
            error,
            message,
            notify: () => {
              $.notify(`🌍 Suki Sub 处理订阅失败`, `❌ ${sub.name}`, message)
            },
          })
        }
        if (sub.mergeSources === 'localFirst') {
          raw.unshift(sub.content)
          sourceRaw.unshift(sub.content)
        } else if (sub.mergeSources === 'remoteFirst') {
          raw.push(sub.content)
          sourceRaw.push(sub.content)
        }
      }
      if (produceType === 'raw') {
        return JSON.stringify((Array.isArray(raw) ? raw : [raw]).flat())
      }
      // parse proxies
      let proxies = (Array.isArray(raw) ? raw : [raw])
        .map((i: any) => ProxyUtils.parse(i))
        .flat()

      proxies.forEach((node: any) => {
        node._subName = sub.name
        node._subDisplayName = sub.displayName
      })
      // apply processors
      const executionContext = {
        noFlow: skipFlow,
        validation,
        ignoreIncompatibleOperations: sub.ignoreIncompatibleOperations === true,
        produceType,
        configTemplates: [],
      }
      proxies = await ProxyUtils.process(
        proxies,
        sub.process || [],
        platform,
        { [sub.name]: sub },
        $options,
        sourceRaw,
        executionContext,
      )
      if (proxies.length === 0) {
        throw new RequestInvalidError(
          'NO_USABLE_NODES',
          '来源内容中没有可用节点',
          { subscription: sub.name },
        )
      }
      // check duplicate
      const exist: any = {}
      for (const node of proxies) {
        if (exist[node.name]) {
          ;($.notify as any)(
            '🌍 Suki Sub',
            `⚠️ 订阅 ${name} 包含重复节点 ${node.name}！`,
            '请仔细检测配置！',
            {
              'media-url':
                'https://cdn3.iconfinder.com/data/icons/seo-outline-1/512/25_code_program_programming_develop_bug_search_developer-512.png',
            },
          )
          break
        }
        exist[node.name] = true
      }
      // produce
      const output = ProxyUtils.produce(
        proxies,
        platform,
        produceType,
        produceOpts,
      )
      return executionContext.configTemplates.length &&
        produceType !== 'internal'
        ? applyConfigTemplates(output, executionContext.configTemplates)
        : output
    } catch (err: any) {
      if (!shouldFallbackIgnoreFailedRemoteSub(subIgnoreFailedRemoteSub)) {
        if (err instanceof BaseError)
          err.subscription = `订阅「${resourceLabel(sub)}」`
        throw err
      }

      notifyIgnoreFailedRemoteSubFallback({
        mode: subIgnoreFailedRemoteSub,
        error: err,
        notify: (error: any) => {
          $.notify(
            `🌍 Suki Sub 处理订阅失败`,
            `❌ ${sub.name}`,
            `🤔 原因：${error.message ?? error}`,
          )
        },
      })
      $.warn(`订阅 ${sub.name} 启用兜底后返回空结果: ${err.message ?? err}`)

      return buildEmptySubscriptionOutput({
        platform,
        produceType,
        produceOpts,
      })
    }
  } else if (['collection', 'col'].includes(type)) {
    const allSubs: any = $.read(SUBS_KEY)
    const allCols: any = $.read(COLLECTIONS_KEY)
    const collection = findByName(allCols, name)
    if (!collection)
      throw new ResourceNotFoundError(
        'COLLECTION_NOT_FOUND',
        '组合订阅不存在',
        { collection: name },
      )
    const subnames = [...new Set<string>(collection.subscriptions)]
    const subscriptionTags = collection.subscriptionTags
    if (Array.isArray(subscriptionTags) && subscriptionTags.length > 0) {
      allSubs.forEach((sub: any) => {
        if (
          Array.isArray(sub.tag) &&
          sub.tag.length > 0 &&
          !subnames.includes(sub.name) &&
          sub.tag.some((tag: any) => subscriptionTags.includes(tag))
        ) {
          subnames.push(sub.name)
        }
      })
    }
    const collectionIgnoreFailedRemoteSub = resolveIgnoreFailedRemoteSubMode(
      ignoreFailedRemoteSub,
      collection.ignoreFailedRemoteSub,
    )
    const skipFlow = noFlow || collection.noFlow

    try {
      const results: any = {}
      const errors: any = {}
      const rawResults: any = {}
      const memberTemplates: Partial<
        Record<string, Record<string, unknown>[]>
      > = {}
      let processed = 0

      await Promise.all(
        subnames.map(async (subname: string) => {
          const sub = findByName(allSubs, subname)
          if (!sub) {
            errors[subname] = new ResourceNotFoundError(
              'SUBSCRIPTION_NOT_FOUND',
              '成员订阅不存在',
              { subscription: subname },
            )
            return
          }
          const subMode = resolveIgnoreFailedRemoteSubMode(
            sub.ignoreFailedRemoteSub,
          )
          const passThroughUA = sub.passThroughUA
          let reqUA = sub.ua
          if (passThroughUA) {
            $.info(`订阅开启了透传 User-Agent, 使用请求的 User-Agent: ${ua}`)
            reqUA = ua
          }
          try {
            $.info(`正在处理子订阅：${sub.name}...`)
            let raw
            let sourceRaw
            if (
              sub.source === 'local' &&
              !['localFirst', 'remoteFirst'].includes(sub.mergeSources)
            ) {
              raw = sub.content
              sourceRaw = sub.content
            } else {
              const subErrors: any = {}
              const downloaded = await Promise.all(
                sub.url
                  .split(/[\r\n]+/)
                  .map((i: string) => i.trim())
                  .filter(
                    (i: string, index: number, lines: string[]) =>
                      i.length && lines.indexOf(i) === index,
                  )
                  .map(async (remoteUrl: string) => {
                    try {
                      return await download(
                        remoteUrl,
                        reqUA,
                        undefined,
                        proxy || sub.proxy || collection.proxy,
                        undefined,
                        undefined,
                        noCache || sub.noCache,
                        true,
                        {
                          returnRaw: true,
                          noFlow: skipFlow || sub.noFlow,
                        },
                      )
                    } catch (err) {
                      subErrors[remoteUrl] = err
                      return ''
                    }
                  }),
              )
              raw = downloaded.map((i: any) => i.result ?? i)
              sourceRaw = downloaded.map((i: any) => i.raw ?? i)

              if (Object.keys(subErrors).length > 0) {
                const error = resourceFailure(
                  `订阅「${resourceLabel(sub)}」`,
                  subErrors,
                )
                const message = error.message
                handleIgnoreFailedRemoteSubError({
                  mode: subMode,
                  error,
                  message,
                  notify: () => {
                    $.notify(
                      `🌍 Suki Sub 处理订阅失败`,
                      `❌ ${sub.name}`,
                      message,
                    )
                  },
                })
              }
              if (sub.mergeSources === 'localFirst') {
                raw.unshift(sub.content)
                sourceRaw.unshift(sub.content)
              } else if (sub.mergeSources === 'remoteFirst') {
                raw.push(sub.content)
                sourceRaw.push(sub.content)
              }
            }
            // parse proxies
            let currentProxies = (Array.isArray(raw) ? raw : [raw])
              .map((i: any) => ProxyUtils.parse(i))
              .flat()

            currentProxies.forEach((node: any) => {
              node._subName = sub.name
              node._subDisplayName = sub.displayName
              node._collectionName = collection.name
              node._collectionDisplayName = collection.displayName
            })

            // apply processors
            const currentRaw = Array.isArray(sourceRaw)
              ? sourceRaw
              : [sourceRaw]
            const memberContext = {
              noFlow: skipFlow || sub.noFlow,
              validation,
              ignoreIncompatibleOperations:
                collection.ignoreIncompatibleOperations === true ||
                sub.ignoreIncompatibleOperations === true,
              produceType,
              configTemplates: [],
            }
            currentProxies = await ProxyUtils.process(
              currentProxies,
              sub.process || [],
              platform,
              {
                [sub.name]: sub,
                _collection: collection,
                $options,
              },
              undefined,
              currentRaw,
              memberContext,
            )
            memberTemplates[subname] = memberContext.configTemplates
            results[subname] = currentProxies
            rawResults[subname] = currentRaw
            processed++
            $.info(
              `✅ 子订阅：${sub.name}加载成功，进度--${
                100 * ((processed / subnames.length) as any).toFixed(1)
              }% `,
            )
          } catch (err: any) {
            processed++

            if (shouldFallbackIgnoreFailedRemoteSub(subMode)) {
              notifyIgnoreFailedRemoteSubFallback({
                mode: subMode,
                error: err,
                notify: (error: any) => {
                  $.notify(
                    `🌍 Suki Sub 处理订阅失败`,
                    `❌ ${sub.name}`,
                    `🤔 原因：${error.message ?? error}`,
                  )
                },
              })
              $.warn(
                `订阅 ${sub.name} 在组合订阅处理中启用兜底后返回空结果: ${
                  err.message ?? err
                }`,
              )
              results[subname] = []
              rawResults[subname] = []
              return
            }

            if (err instanceof BaseError) {
              err.subscription = `订阅「${resourceLabel(sub)}」`
              err.resourceDisplayName ??= resourceLabel(sub)
            }
            errors[subname] = err
            rawResults[subname] = undefined
          }
        }),
      )

      if (Object.keys(errors).length > 0) {
        const error = resourceFailure(
          `组合订阅「${resourceLabel(collection)}」`,
          errors,
        )
        const message = error.message
        const notify = () => {
          $.notify(
            `🌍 Suki Sub 处理组合订阅失败`,
            `❌ ${collection.name}`,
            message,
          )
        }
        const hasProcessedSubscriptions = Object.keys(results).length > 0
        if (
          hasProcessedSubscriptions &&
          shouldFallbackIgnoreFailedRemoteSub(collectionIgnoreFailedRemoteSub)
        ) {
          Object.keys(errors).forEach((failedName: string) => {
            rawResults[failedName] = []
          })
          if (
            shouldNotifyIgnoreFailedRemoteSub(collectionIgnoreFailedRemoteSub)
          ) {
            notify()
          }
        } else {
          handleIgnoreFailedRemoteSubError({
            mode: collectionIgnoreFailedRemoteSub,
            error,
            message,
            notify,
          })
        }
      }

      // merge proxies with the original order
      let proxies = Array.prototype.concat.apply(
        [],
        subnames.map((subname: string) => results[subname] || []),
      )

      proxies.forEach((node: any) => {
        node._collectionName = collection.name
        node._collectionDisplayName = collection.displayName
      })

      // apply own processors
      const executionContext = {
        noFlow: skipFlow,
        validation,
        ignoreIncompatibleOperations:
          collection.ignoreIncompatibleOperations === true,
        produceType,
        configTemplates: subnames.flatMap(
          (member: string) => memberTemplates[member] || [],
        ),
      }
      proxies = await ProxyUtils.process(
        proxies,
        collection.process || [],
        platform,
        { _collection: collection },
        $options,
        rawResults,
        executionContext,
      )
      if (proxies.length === 0) {
        throw new RequestInvalidError(
          'NO_USABLE_NODES',
          '组合订阅中没有可用节点',
          { collection: name },
        )
      }
      // check duplicate
      const exist: any = {}
      for (const node of proxies) {
        if (exist[node.name]) {
          ;($.notify as any)(
            '🌍 Suki Sub',
            `⚠️ 组合订阅 ${name} 包含重复节点 ${node.name}！`,
            '请仔细检测配置！',
            {
              'media-url':
                'https://cdn3.iconfinder.com/data/icons/seo-outline-1/512/25_code_program_programming_develop_bug_search_developer-512.png',
            },
          )
          break
        }
        exist[node.name] = true
      }
      const output = ProxyUtils.produce(
        proxies,
        platform,
        produceType,
        produceOpts,
      )
      return executionContext.configTemplates.length &&
        produceType !== 'internal'
        ? applyConfigTemplates(output, executionContext.configTemplates)
        : output
    } catch (err: any) {
      if (
        !shouldFallbackIgnoreFailedRemoteSub(collectionIgnoreFailedRemoteSub)
      ) {
        if (err instanceof BaseError)
          err.collection = `组合订阅「${resourceLabel(collection)}」`
        throw err
      }

      notifyIgnoreFailedRemoteSubFallback({
        mode: collectionIgnoreFailedRemoteSub,
        error: err,
        notify: (error: any) => {
          $.notify(
            `🌍 Suki Sub 处理组合订阅失败`,
            `❌ ${collection.name}`,
            `🤔 原因：${error.message ?? error}`,
          )
        },
      })
      $.warn(
        `组合订阅 ${collection.name} 启用兜底后返回空结果: ${
          err.message ?? err
        }`,
      )

      return buildEmptySubscriptionOutput({
        platform,
        produceType,
        produceOpts,
      })
    }
  } else if (type === 'rule') {
    const allRules: any = $.read(RULES_KEY as any)
    const rule = findByName(allRules, name)
    if (!rule)
      throw new ResourceNotFoundError('RULE_NOT_FOUND', '规则不存在', {
        rule: name,
      })
    let rules: any[] = []
    for (let i = 0; i < rule.urls.length; i++) {
      const ruleUrl = rule.urls[i]
      $.info(
        `正在处理URL：${ruleUrl}，进度--${
          100 * (((i + 1) / rule.urls.length) as any).toFixed(1)
        }% `,
      )
      try {
        const { body } = await (download as any)(ruleUrl)
        const currentRules = RuleUtils.parse(body)
        rules = rules.concat(currentRules)
      } catch (err) {
        $.error(
          `处理分流订阅中的URL: ${ruleUrl}时出现错误：${err}! 该订阅已被跳过。`,
        )
      }
    }
    // remove duplicates
    rules = await (RuleUtils as any).process(rules, [
      { type: 'Remove Duplicate Filter' },
    ])
    // produce output
    return RuleUtils.produce(rules, platform)
  }
  throw new RequestInvalidError('INVALID_RESOURCE_TYPE', '不支持的资源类型', {
    resourceType: type,
  })
}

export {
  produceArtifact,
  buildEmptySubscriptionOutput,
  handleIgnoreFailedRemoteSubError,
  normalizeIgnoreFailedRemoteSub,
  notifyIgnoreFailedRemoteSubFallback,
  resolveIgnoreFailedRemoteSubMode,
  shouldFallbackIgnoreFailedRemoteSub,
  shouldNotifyIgnoreFailedRemoteSub,
}
