import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'

const port = 18765
const baseURL = `http://127.0.0.1:${port}`

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL,
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow',
    trace: process.env.PLAYWRIGHT_TRACE === 'on' ? 'on' : 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  webServer: {
    // Run the same built app as Docker: Fastify serves both the SPA and the API.
    command: `pnpm --filter @calendar/api exec fastify start --address 127.0.0.1 --port ${port} dist/app.js`,
    url: `${baseURL}/health`,
    env: {
      NODE_ENV: 'test',
      WEB_ROOT: fileURLToPath(new URL('./dist', import.meta.url)),
      // Tomorrow is always in the future, even if the check runs near midnight.
      BOOKING_WINDOW_START: 'tomorrow'
    },
    // Never attach to a developer's process or reuse its in-memory records.
    reuseExistingServer: false,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 }
  }
})
