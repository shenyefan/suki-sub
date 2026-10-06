import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'

/** Hash the certificate bytes without initializing a random-number pool at startup. */
export function generateFingerprint(caStr: string) {
  const base64 = caStr.replace(/-----[^-]+-----/g, '').replace(/\s/g, '')
  const hex = createHash('sha256')
    .update(Buffer.from(base64, 'base64'))
    .digest('hex')
  return (hex.match(/.{2}/g) ?? []).join(':').toUpperCase()
}

export default { generateFingerprint }
