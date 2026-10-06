// 重新生成:./node_modules/.bin/peggy --format es -o surge.gen.ts grammars/surge.peggy
import { parse, SyntaxError } from './surge.gen'

let parser: any

export default function getParser(): any {
  if (!parser) {
    parser = { parse, SyntaxError }
  }
  return parser
}
