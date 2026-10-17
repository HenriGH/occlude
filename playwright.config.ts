import { defineConfig, devices } from '@playwright/test'
const production = process.env.PLAYWRIGHT_USE_PREVIEW === '1'
export default defineConfig({
  testDir: './e2e', fullyParallel: false,
  use: {
    baseURL: 'http://127.0.0.1:5173', trace: 'retain-on-failure',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {},
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: { command: `npm run ${production ? 'preview' : 'dev'} -- --port 5173 --strictPort`, url: 'http://127.0.0.1:5173', reuseExistingServer: !process.env.CI && !production },
})
