import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    // tests/db and tests/domain run in plain Node (no DOM needed).
    environment: 'node',
    // PGlite boots a full Postgres in WASM; allow time for migrations.
    testTimeout: 30000,
    hookTimeout: 60000,
  },
})
