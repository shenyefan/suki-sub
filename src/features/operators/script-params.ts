import { parseResourceLink } from '#/shared/resource-link'

export function parseScriptLink(content: string): {
  url: string
  arguments: Record<string, unknown>
  noCache: boolean
  insecure: boolean
} {
  const parsed = parseResourceLink(content)
  const args = { ...parsed.arguments }
  const noCache = parsed.arguments.noCache === true
  const insecure = parsed.arguments.insecure === true
  delete args.noCache
  delete args.insecure
  return {
    url: parsed.url,
    arguments: args,
    noCache,
    insecure,
  }
}

export function buildScriptLink(
  url: string,
  args: Record<string, unknown>,
  noCache: boolean,
  insecure: boolean,
): string {
  const flags = [noCache && 'noCache', insecure && 'insecure']
    .filter(Boolean)
    .join('&')
  const parameters = Object.keys(args).length
    ? encodeURIComponent(JSON.stringify(args))
    : ''
  const base = parseResourceLink(url).url
  return `${base}${parameters ? `#${parameters}` : ''}${flags ? `#${flags}` : ''}`
}
