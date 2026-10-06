//  @ts-check

import { tanstackConfig } from '@tanstack/eslint-config'

export default [
  ...tanstackConfig,
  {
    rules: {
      'import/no-cycle': 'off',
      'import/order': 'off',
      'sort-imports': 'off',
      '@typescript-eslint/array-type': 'off',
      '@typescript-eslint/require-await': 'off',
      'pnpm/json-enforce-catalog': 'off',
    },
  },
  {
    ignores: [
      'eslint.config.js',
      'prettier.config.js',
      // 沙箱源资产:以 ?raw 文本嵌入 Dynamic Worker,非 TS 工程文件(tsconfig 不含 .js)
      'src/server/core/sandbox/flow-utils.js',
      'src/server/core/sandbox/vendor/**',
      // Peggy 构建期产物
      'src/server/core/proxy-utils/parsers/peggy/*.gen.ts',
    ],
  },
]
