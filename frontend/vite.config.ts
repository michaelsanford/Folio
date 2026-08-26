// defineConfig from vitest/config, not vite: the plain Vite type has no `test`
// key, so the config did not typecheck once `tsc -b` started checking it.
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Folio Personal Finance',
        short_name: 'Folio',
        description: 'Self-hosted personal finance tracking and expense budgeting',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'portrait-primary',
        // The previous entries pointed at PNGs that were never added to the
        // repository, so an install prompt had no icon to show. favicon.svg is
        // the one icon that actually exists; 'any maskable' at size 'any' is the
        // correct declaration for a scalable source.
        icons: [
          {
            src: '/favicon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable'
          }
        ]
      }
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
