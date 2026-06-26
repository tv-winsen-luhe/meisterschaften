import { defineConfig } from 'astro/config'
import tailwindcss from '@tailwindcss/vite'
import sitemap from '@astrojs/sitemap'
import react from '@astrojs/react'

export default defineConfig({
  site: 'https://meisterschaften.tennisverein-winsen.de',
  // React is confined to the gated admin (a `client:only` island); the public
  // marketing/list pages stay zero-JS-by-default.
  integrations: [sitemap({ filter: page => !page.includes('/og') }), react()],
  vite: {
    plugins: [tailwindcss()]
  },
  devToolbar: {
    enabled: false
  }
})
