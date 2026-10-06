import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

const DEFAULT_PARSE_OPTIONS = {
  logLevel: 'error',
  merge: true,
}

function retry(fn: any, content: any, ...args: any[]) {
  try {
    return fn(content, ...args)
  } catch (e) {
    return fn(
      dump(
        fn(content.replace(/!<str>\s*/g, '__SukiSubJSYAMLString__'), ...args),
      ).replace(/__SukiSubJSYAMLString__/g, ''),
      ...args,
    )
  }
}

function toSerializable(content: any) {
  return JSON.parse(JSON.stringify(content))
}

function normalizeParseOptions(options: any) {
  return {
    ...DEFAULT_PARSE_OPTIONS,
    ...(options || {}),
  }
}

function normalizeStringifyOptions(options = {} as any) {
  const {
    forceQuotes,
    lineWidth,
    noArrayIndent,
    noRefs,
    quotingType,
    sortKeys,
    ...rest
  } = options || {}
  const normalized: any = { ...rest }

  if (typeof lineWidth === 'number') {
    normalized.lineWidth = lineWidth <= 0 ? 0 : lineWidth
  }
  if (typeof noArrayIndent === 'boolean') {
    normalized.indentSeq = !noArrayIndent
  }
  if (typeof noRefs === 'boolean') {
    normalized.aliasDuplicateObjects = !noRefs
  }
  if (typeof sortKeys !== 'undefined') {
    normalized.sortMapEntries = sortKeys
  }
  if (quotingType === "'") {
    normalized.singleQuote = true
  } else if (quotingType === '"') {
    normalized.singleQuote = false
  }
  if (forceQuotes) {
    normalized.defaultStringType =
      quotingType === "'" ? 'QUOTE_SINGLE' : 'QUOTE_DOUBLE'
  }

  return normalized
}

function parse(content: any, ...args: any[]) {
  return parseYaml(content, normalizeParseOptions(args[0]))
}

function stringify(content: any, ...args: any[]) {
  return stringifyYaml(content, normalizeStringifyOptions(args[0]))
}

export function safeLoad(content: any, ...args: any[]) {
  return retry(parse, toSerializable(content), ...args)
}
export function load(content: any, ...args: any[]) {
  return retry(parse, toSerializable(content), ...args)
}
export function safeDump(content: any, ...args: any[]) {
  return stringify(toSerializable(content), ...args)
}
export function dump(content: any, ...args: any[]) {
  return stringify(toSerializable(content), ...args)
}

export default {
  safeLoad,
  load,
  safeDump,
  dump,
  parse: safeLoad,
  stringify: safeDump,
}
