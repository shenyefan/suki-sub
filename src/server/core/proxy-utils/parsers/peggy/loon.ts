// 生成后保留文件顶部的 // @ts-nocheck；生成代码不做人工类型改写。
// 重新生成:./node_modules/.bin/peggy --format es -o loon.gen.ts grammars/loon.peggy
import { parse, SyntaxError } from './loon.gen'

let parser: any

export default function getParser(): any {
  if (!parser) {
    parser = { parse, SyntaxError }
  }
  return parser
}
