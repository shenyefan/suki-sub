import { Base64 } from 'js-base64'
import URI_Producer from './uri'
import $ from '#/server/core/app'

const URI = URI_Producer()

export interface Producer {
  type: string
  produce: (...args: any[]) => any
}

export default function V2Ray_Producer(): Producer {
  const type = 'ALL'
  const produce = (proxies: any[]) => {
    const result: string[] = []
    proxies.map((proxy: any) => {
      try {
        result.push(URI.produce(proxy))
      } catch (err) {
        $.error(`Cannot produce proxy: ${proxy.name}\nReason: ${err}`)
      }
    })

    return Base64.encode(result.join('\n'))
  }

  return { type, produce }
}
