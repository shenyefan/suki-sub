/**
 * age 输出加密:按配置对产出内容加密后返回。
 */
import { AGE_PUBLIC_KEY, encryptArmor } from '#/server/core/utils/age'

const SHARE_AGE_PUBLIC_KEY_HEADER = 'x-suki-sub-share-age-public-key'

function normalizeAgePublicKey(value: any) {
  return String(value ?? '').trim()
}

function createAgePublicKeyConfig(publicKey: any) {
  const key = normalizeAgePublicKey(publicKey)
  return key ? { [AGE_PUBLIC_KEY]: key } : undefined
}

function resolveAgePublicKey(...configs: any[]) {
  for (const config of configs) {
    const key = normalizeAgePublicKey(config?.[AGE_PUBLIC_KEY])
    if (key) return key
  }

  return ''
}

function resolveShareAgeConfig({ req, type, name, findShareToken }: any) {
  if (!req?.path?.startsWith('/s/')) {
    return undefined
  }

  const consumedToken = req.sukiSubShareToken
  const token =
    consumedToken ||
    (req.query?.token && typeof findShareToken === 'function'
      ? findShareToken({
          token: req.query.token,
          type,
          name,
          pathname: req.path,
        })
      : null)
  const headerKey = req.headers?.[SHARE_AGE_PUBLIC_KEY_HEADER]

  return createAgePublicKeyConfig(token?.[AGE_PUBLIC_KEY] || headerKey)
}

async function applyAgeOutputEncryption({ body, res, configs = [] }: any) {
  const publicKey = resolveAgePublicKey(...configs)

  if (!publicKey) {
    return body
  }

  const armored = await encryptArmor(body ?? '', publicKey)
  if (res?.set) {
    res.set('Content-Type', 'text/plain; charset=utf-8')
  }

  return armored
}

export {
  SHARE_AGE_PUBLIC_KEY_HEADER,
  applyAgeOutputEncryption,
  createAgePublicKeyConfig,
  resolveAgePublicKey,
  resolveShareAgeConfig,
}
