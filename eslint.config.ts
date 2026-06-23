import eslintPluginAstro from 'eslint-plugin-astro'
import { defineConfig } from 'eslint/config'

const config = defineConfig([
  {
    ignores: ['.astro/**', 'dist/**', 'node_modules/**']
  },
  ...eslintPluginAstro.configs.recommended,
  {
    rules: {}
  }
])

export default config
