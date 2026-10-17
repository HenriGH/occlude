import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { loadEnv } from 'vite'
import { publicConfiguration } from './src/sync/config.ts'

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), 'VITE_'), ...process.env }
  publicConfiguration(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY)
  return {
  plugins: [react(), tailwindcss()],
  build: { rolldownOptions: { output: { codeSplitting: { groups: [{ name: 'supabase', test: /node_modules\/@supabase\// }] } } } },
  test: {
    environment: 'jsdom', setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'], restoreMocks: true,
  },
  }
})
