import { defineConfig } from '@playwright/test';

// Set MOGSHOT_URL to run against a deployed site instead of a local build.
const deployed = process.env.MOGSHOT_URL;

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  // The checks read gigabytes from the same install; running them one at a time keeps timings honest.
  workers: 1,
  use: {
    // The installed Google Chrome: it is the browser the product targets.
    channel: 'chrome',
    baseURL: deployed ?? 'http://localhost:4173/mogshot/',
    // Screenshots at 2x, so the character canvas is captured at its full pixel size.
    deviceScaleFactor: 2,
  },
  webServer: deployed
    ? undefined
    : {
        command: 'pnpm build && pnpm preview --port 4173 --strictPort',
        url: 'http://localhost:4173/mogshot/',
        reuseExistingServer: true,
      },
});
