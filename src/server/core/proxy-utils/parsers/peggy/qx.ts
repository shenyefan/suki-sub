// Workers 禁止运行时动态求值(peggy.generate 内部用 new Function),
// 解析器改为构建期生成:grammars/qx.peggy → qx.gen.ts
// 重新生成:./node_modules/.bin/peggy --format es -o qx.gen.ts grammars/qx.peggy
// decodeQxAlpn 在 grammar 全局初始化块中(生成模块自包含)
import { parse, SyntaxError } from './qx.gen'

let parser: any

export default function getParser(): any {
  if (!parser) {
    parser = { parse, SyntaxError }
  }
  return parser
}
