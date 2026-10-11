import { Base64 } from 'js-base64'

/** 同时提供 ASCII 回退和 RFC 6266 UTF-8 文件名，兼容订阅客户端。 */
export function contentDisposition(filename: string): string {
  const clean =
    new TextDecoder()
      .decode(new TextEncoder().encode(filename))
      .split('')
      .map((char) =>
        char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 ? '_' : char,
      )
      .join('')
      .replace(/[/\\:"<>|?*]/g, '_')
      .trim() || 'subscription.txt'
  const fallback = clean.replace(/[^\x20-\x7e]/g, '_')
  const encoded = encodeURIComponent(clean).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  )
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`
}

export function downloadMetadata(
  title: string,
  platform: string,
  produceType?: string,
  encrypted = false,
) {
  const target = platform.toLowerCase()
  const extension = encrypted
    ? 'age'
    : produceType === 'raw'
      ? 'txt'
      : produceType === 'internal' ||
          ['json', 'singbox', 'sing-box'].includes(target)
        ? 'json'
        : [
              'clash',
              'clashmeta',
              'clash.meta',
              'meta',
              'mihomo',
              'stash',
              'egern',
            ].includes(target)
          ? 'yaml'
          : [
                'surge',
                'surgemac',
                'loon',
                'qx',
                'quantumultx',
                'surfboard',
              ].includes(target)
            ? 'conf'
            : 'txt'
  const name = title.trim() || 'subscription'
  const filename = name.toLowerCase().endsWith(`.${extension}`)
    ? name
    : `${name}.${extension}`
  return {
    'content-disposition': contentDisposition(filename),
    'profile-title': `base64:${Base64.encode(name)}`,
    'content-type':
      extension === 'json'
        ? 'application/json; charset=utf-8'
        : 'text/plain; charset=utf-8',
  }
}
