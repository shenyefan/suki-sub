declare module 'jsrsasign' {
  interface KJURCryptoUtil {
    hashHex: (hex: string, algorithm: string) => string
  }

  interface KJURCrypto {
    Util: KJURCryptoUtil
  }

  interface KJUR {
    crypto: KJURCrypto
  }

  interface Jsrsasign {
    pemtohex: (pem: string) => string
    KJUR: KJUR
  }

  const rs: Jsrsasign
  export default rs
}
