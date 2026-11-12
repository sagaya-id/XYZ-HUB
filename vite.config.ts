import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '0.0.0.0',
    port: 3000,
    strictPort: true,
    // Never watch the local D1/R2 state or build output: those files change on
    // every API request and would otherwise trigger a reload loop in dev.
    watch: {
      ignored: ['**/.wrangler/**', '**/dist/**', '**/dist-server/**', '**/scripts/**', '**/artifacts/**'],
    },
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1400,
  },
})
