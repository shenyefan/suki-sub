import { RequestInvalidError } from '../core/errors'
import { isLinkFlagEnabled, parseResourceLink } from '#/shared/resource-link'

export function detectPlatform(ua: string, accept = ''): string {
  const platforms: [RegExp, string][] = [
    [/quantumult(?:%20|[ -])x|\bqx\b/i, 'qx'],
    [/egern/i, 'egern'],
    [/surfboard/i, 'surfboard'],
    [/surge[ /].*mac|surge mac/i, 'surgemac'],
    [/surge/i, 'surge'],
    [/decar|loon/i, 'loon'],
    [/shadowrocket/i, 'shadowrocket'],
    [/stash/i, 'stash'],
    [/^meta$|mihomo|clash.*meta|clash-verge|flclash/i, 'clashmeta'],
    [/clash/i, 'clash'],
    [/v2ray/i, 'v2ray'],
    [/sing-box|singbox/i, 'sing-box'],
  ]
  return (
    platforms.find(([pattern]) => pattern.test(ua))?.[1] ||
    (accept.startsWith('application/json') ? 'JSON' : 'v2ray')
  )
}

/** 只传输出选项；分享的资源绑定不能被查询参数替换。 */
export function downloadOptions(
  query: Record<string, string>,
  pathTarget: string | undefined,
  ua: string,
  accept = '',
) {
  for (const key of [
    'url',
    'content',
    'mergeSources',
    'fakeSub',
    '_fakeNode',
    'fakeNode',
    'proxy',
    'insecure',
  ]) {
    if (Object.hasOwn(query, key)) {
      throw new RequestInvalidError(
        'INVALID_DOWNLOAD_OPTION',
        `分享下载不支持参数 ${key}`,
      )
    }
  }
  const flag = (key: string) =>
    Object.hasOwn(query, key) &&
    (query[key] === '' || isLinkFlagEnabled(query[key]))
  const platform =
    pathTarget || query.platform || query.target || detectPlatform(ua, accept)
  const produceType = query.produceType || undefined
  if (produceType && !['text', 'raw', 'internal'].includes(produceType)) {
    throw new RequestInvalidError(
      'INVALID_DOWNLOAD_OPTION',
      'produceType 必须为 text、raw 或 internal',
    )
  }
  if (
    Object.hasOwn(query, 'ignoreFailedRemoteSub') &&
    ![
      '',
      'true',
      '1',
      'enabled',
      'on',
      'false',
      '0',
      'disabled',
      'off',
      'quiet',
      'fallbackNotify',
      'fallbackQuiet',
    ].includes(query.ignoreFailedRemoteSub)
  ) {
    throw new RequestInvalidError(
      'INVALID_DOWNLOAD_OPTION',
      'ignoreFailedRemoteSub 的值无效',
    )
  }
  const useMihomoExternal = platform.toLowerCase() === 'surgemac'
  const localPort = !Object.hasOwn(query, 'mihomoLocalPort')
    ? undefined
    : Number(query.mihomoLocalPort)
  if (
    useMihomoExternal &&
    localPort != null &&
    (!Number.isInteger(localPort) || localPort < 1 || localPort > 65535)
  ) {
    throw new RequestInvalidError(
      'INVALID_DOWNLOAD_OPTION',
      'mihomoLocalPort 必须为 1 至 65535 的整数',
    )
  }
  return {
    platform,
    ua: query.ua || ua,
    produceType,
    noCache: flag('noCache'),
    noFlow: flag('noFlow'),
    ignoreFailedRemoteSub: Object.hasOwn(query, 'ignoreFailedRemoteSub')
      ? query.ignoreFailedRemoteSub === '' ||
        ['true', '1', 'on'].includes(query.ignoreFailedRemoteSub)
        ? true
        : ['false', '0', 'disabled', 'off'].includes(
              query.ignoreFailedRemoteSub,
            )
          ? false
          : query.ignoreFailedRemoteSub
      : undefined,
    produceOpts: {
      'include-unsupported-proxy': flag('includeUnsupportedProxy'),
      prettyYaml: Object.hasOwn(query, 'prettyYaml')
        ? flag('prettyYaml')
        : flag('pretty-yaml'),
      useMihomoExternal,
      mihomoExternal: useMihomoExternal && flag('mihomoExternal'),
      merge: useMihomoExternal && flag('mihomoMerge'),
      mergeName: useMihomoExternal ? query.mihomoMergeName : undefined,
      localPort: useMihomoExternal ? localPort : undefined,
    },
  }
}

export function scriptOptions(
  value: string | undefined,
  request: Record<string, unknown>,
): Record<string, unknown> {
  // Hono 已做一次 URL 解码；只对再次编码的 JSON 进行额外解码。
  let custom: Record<string, unknown> = {}
  if (value) {
    let parsed: unknown
    try {
      parsed = JSON.parse(value)
    } catch {
      parsed = parseResourceLink(`options#${value}`).arguments
    }
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
      custom = Object.fromEntries(
        Object.entries(parsed).filter(
          ([key]) =>
            !['__proto__', 'constructor', 'prototype', '_req'].includes(key),
        ),
      )
  }
  return { ...custom, _req: request }
}
