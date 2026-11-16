import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

/** The API in development: `npm run dev` (or `dev:memory`) in 3arabity-backend. */
const api = process.env.API_TARGET ?? 'http://localhost:3000'

export default defineConfig(() => ({
  // Always under /admin: served by the API in production, and in development
  // reached through the web front (localhost:5174/admin) as well as on 5173.
  base: process.env.ADMIN_BASE ?? '/admin/',
  plugins: [react()],
  server: {
    port: 5173,
    // Same origin in development, so no CORS and photos load as they are.
    proxy: {
      '/api': api,
      '/uploads': api,
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['src/test/setup.ts'],
  },
}))
