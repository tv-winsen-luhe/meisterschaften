import { type Config } from 'prettier'

const config: Config = {
  arrowParens: 'avoid',
  plugins: ['prettier-plugin-astro', 'prettier-plugin-tailwindcss'],
  printWidth: 120,
  semi: false,
  singleQuote: true,
  tailwindStylesheet: './src/styles/global.css',
  trailingComma: 'none',
  overrides: [
    {
      files: '*.astro',
      options: {
        parser: 'astro'
      }
    }
  ]
}

export default config
