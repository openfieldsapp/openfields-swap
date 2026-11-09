import path from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { lib: path.resolve(__dirname, 'lib'), components: path.resolve(__dirname, 'components') } },
  test: { include: ['tests/**/*.test.ts'] },
})
