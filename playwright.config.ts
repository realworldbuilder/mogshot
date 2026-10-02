import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  use: {
    // The installed Google Chrome: it is the browser the product targets.
    channel: 'chrome',
    baseURL: 'http://localhost:4173/mogshot/',
  },
  webServer: {
    command: 'pnpm build && pnpm preview --port 4173 --strictPort',
    url: 'http://localhost:4173/mogshot/',
    reuseExistingServer: true,
  },
});
