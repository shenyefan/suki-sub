/** Suki Sub fragment options are local metadata and never sent upstream. */
export function parseResourceLink(content: string) {
  const [url, ...fragments] = content.trim().split('#')
  const args: Record<string, unknown> = {}
  for (const fragment of fragments.filter(Boolean)) {
    let parsed: unknown
    try {
      parsed = JSON.parse(decodeURIComponent(fragment))
    } catch {
      parsed = Object.fromEntries(
        fragment
          .split('&')
          .filter(Boolean)
          .map((pair) => {
            const equal = pair.indexOf('=')
            const decode = (value: string) => {
              try {
                return decodeURIComponent(value)
              } catch {
                return value
              }
            }
            return equal < 0
              ? [decode(pair), true]
              : [
                  decode(pair.slice(0, equal)),
                  decode(pair.slice(equal + 1)) || true,
                ]
          }),
      )
    }
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const [key, value] of Object.entries(parsed)) {
        if (!['__proto__', 'constructor', 'prototype'].includes(key))
          args[key] = value
      }
    }
  }
  for (const flag of ['noCache', 'noFlow', 'insecure', 'validCheck']) {
    if (Object.hasOwn(args, flag)) args[flag] = isLinkFlagEnabled(args[flag])
  }
  return { url, arguments: args }
}

export function isLinkFlagEnabled(value: unknown): boolean {
  return (
    value === true ||
    value === 1 ||
    ['true', '1', 'enabled', 'on'].includes(String(value).toLowerCase())
  )
}
