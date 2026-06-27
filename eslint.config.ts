import eslintPluginAstro from 'eslint-plugin-astro'
import reactHooks from 'eslint-plugin-react-hooks'
import { defineConfig } from 'eslint/config'
import tseslint from 'typescript-eslint'

const config = defineConfig([
  {
    ignores: ['.astro/**', 'dist/**', 'node_modules/**', '.wrangler/**']
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
      // Cap file length to keep modules navigable. Counts code only (skips blank lines and the
      // codebase's deliberately dense comments), so the threshold measures actual code — every
      // hand-written TS/TSX file is under it today. Scoped to TS/TSX (Astro files legitimately
      // bundle markup + scoped CSS and are exempt); vendored shadcn under src/admin/ui is exempt
      // below.
      'max-lines': ['error', { max: 300, skipBlankLines: true, skipComments: true }],
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
    // Vendored shadcn/ui primitives (ADR-0016) are generated, not hand-maintained — exempt them
    // from the file-length cap (sidebar.tsx alone is ~600 code lines). Every other rule still applies.
    files: ['src/admin/ui/**/*.{ts,tsx}'],
    rules: {
      'max-lines': 'off'
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
