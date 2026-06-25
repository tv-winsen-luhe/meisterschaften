import eslintPluginAstro from 'eslint-plugin-astro'
import { defineConfig } from 'eslint/config'
import tseslint from 'typescript-eslint'

const config = defineConfig([
  {
    ignores: ['.astro/**', 'dist/**', 'node_modules/**']
  },
  ...eslintPluginAstro.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tseslint.parser
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin
    },
    rules: {
      // Arrow functions instead of function declarations/expressions
      'func-style': ['error', 'expression'],
      'prefer-arrow-callback': 'error',
      // Always destructure object properties
      'prefer-destructuring': ['error', { object: true, array: false }],
      // Explicit interfaces over `type X = {…}` aliases
      '@typescript-eslint/consistent-type-definitions': ['error', 'interface'],
      // No inline object types — declare a named interface and reference it. Matches inline
      // object types in param annotations, return types and variable annotations (but not
      // `type X = {…}`, handled above, nor object types nested inside generics like Promise<{…}>).
      'no-restricted-syntax': [
        'error',
        {
          selector: 'TSTypeAnnotation > TSTypeLiteral',
          message:
            'No inline object types — declare an explicit interface and reference it (applies to function params and return types too).'
        }
      ]
    }
  }
])

export default config
