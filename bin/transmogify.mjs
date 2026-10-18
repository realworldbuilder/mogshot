#!/usr/bin/env node
// Transmogify: the page and its server are in cli/transmogify.ts; this loads it through Vite,
// which also serves the page Chrome draws the pictures in (on 127.0.0.1 only).
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({
  configFile: false,
  root,
  logLevel: 'error',
  appType: 'mpa',
  cacheDir: 'node_modules/.vite-transmogify',
  server: { host: '127.0.0.1', port: Number(process.env.TRANSMOGIFY_HARNESS_PORT ?? 4191), strictPort: true, hmr: false, watch: null },
});

let listening;
const { serve } = await server.ssrLoadModule('/cli/transmogify.ts');
await serve({
  root,
  harness: async () => {
    listening ??= server.listen();
    await listening;
    const address = server.httpServer.address();
    return `http://127.0.0.1:${address.port}/cli/harness.html`;
  },
});
