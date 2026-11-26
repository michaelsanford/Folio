// defineConfig from vitest/config, not vite: the plain Vite type has no `test`
// key, so the config did not typecheck once `tsc -b` started checking it.
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // 'prompt': a new build waits until the user reloads from the
      // "Update available" item in the navigation (usePwaUpdate). The hook
      // registers the worker itself, so no registerSW.js script is injected.
      registerType: 'prompt',
      injectRegister: false,
      // Icons are rendered from the SVG sources by `npm run generate-icons`
      // and committed; see scripts/generate-icons.mjs.
      includeAssets: [
        'favicon.ico',
        'folio-icon.svg',
        'apple-touch-icon-180x180.png',
      ],
      manifest: {
        id: '/',
        lang: 'en-CA',
        dir: 'ltr',
        name: 'Folio Personal Finance',
        short_name: 'Folio',
        description: 'Ledger, budget and net worth for your household',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        theme_color: '#141110',
        background_color: '#1a1715',
        categories: ['finance'],
        // A shortcut or a second launch brings the open window forward
        // instead of opening another copy of the app.
        launch_handler: { client_mode: 'focus-existing' },
        icons: [
          { src: '/pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: '/maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        // Shown in the browser's install dialog (demo data only).
        screenshots: [
          { src: '/screenshots/dashboard-wide.png', sizes: '1256x627', type: 'image/png', form_factor: 'wide', label: 'Household dashboard: net worth and accounts' },
          { src: '/screenshots/dashboard-narrow.png', sizes: '492x759', type: 'image/png', form_factor: 'narrow', label: 'Household dashboard on a phone' },
        ],
        // Long-press / right-click shortcuts on the installed app. App.tsx
        // reads ?view= once to pick the starting tab.
        shortcuts: [
          { name: 'Ledger', url: '/?view=ledger', icons: [{ src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' }] },
          { name: 'Budget', url: '/?view=budgeting', icons: [{ src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' }] },
          { name: 'Import', url: '/?view=ingestion', icons: [{ src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' }] },
        ],
      },
      workbox: {
        // API calls always go to the network; never answer one with the app shell.
        navigateFallbackDenylist: [/^\/api(\/|$)/],
      },
    })
  ],
  build: {
    // No manualChunks: forcing echarts into a named chunk dragged React in with
    // it (a shared dependency), which made the entry import that chunk eagerly
    // and defeated the split. Rollup's automatic splitting handles the dynamic
    // import in LazyChart correctly on its own.
    chunkSizeWarningLimit: 700,
  },
  test: {
    environment: 'happy-dom',
    globals: true,
    alias: {
      'virtual:pwa-register/react': fileURLToPath(new URL('./src/test/pwaRegisterStub.ts', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.BACKEND_URL || process.env.VITE_BACKEND_URL || 'http://127.0.0.1:8000',
        changeOrigin: true
      }
    }
  }
})
