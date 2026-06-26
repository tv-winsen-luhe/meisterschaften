import eslintPluginAstro from 'eslint-plugin-astro'
import reactHooks from 'eslint-plugin-react-hooks'
import { defineConfig } from 'eslint/config'
import tseslint from 'typescript-eslint'

const config = defineConfig([
  {
    ignores: ['.astro/**', 'dist/**', 'node_modules/**']
  },
  ...eslintPluginAstro.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
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
      // No inline object types — declare a named interface and reference it. The first selector
      // catches direct annotations (params, return types, variables, nested interface props); the
      // second catches object literals passed as generic arguments (Promise<{…}>, Map<_, {…}>).
      // Deliberately NOT caught: `type X = {…}` (consistent-type-definitions handles that), object
      // literals in intersections (`A & {…}` — keeps vendored shadcn `ComponentProps<…> & {…}` props
      // legal), and generic args in value position (`new Hono<{…}>()`).
      'no-restricted-syntax': [
        'error',
        {
          selector: 'TSTypeAnnotation > TSTypeLiteral',
          message:
            'No inline object types — declare an explicit interface and reference it (applies to function params and return types too).'
        },
        {
          selector: 'TSTypeAnnotation TSTypeParameterInstantiation > TSTypeLiteral',
          message:
            'No inline object types in generic arguments — declare an explicit interface and reference it (e.g. Promise<MyResult> instead of Promise<{…}>).'
        }
      ]
    }
  },
  {
    // The admin is the only React code (a client:only island, ADR-0008) and is set to grow. The
    // Hooks rules guard it: rules-of-hooks is a hard error (a conditional hook is a real bug);
    // exhaustive-deps is advisory (warn), because a few effects intentionally diverge from the
    // mechanical dependency set. Scoped to src/admin so the Astro/worker code is unaffected.
    files: ['src/admin/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn'
    }
  }
])

export default config
