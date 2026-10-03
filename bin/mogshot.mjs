#!/usr/bin/env node
// Mogshot from the command line. The work is in cli/main.ts; this loads it through Vite,
// which also serves the page that Chrome draws the pictures in.
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({
  configFile: false,
  root,
  logLevel: 'error',
  appType: 'mpa',
  cacheDir: 'node_modules/.vite-cli',
  server: { host: '127.0.0.1', port: 4179, hmr: false, watch: null },
});

let code = 1;
try {
  const { run } = await server.ssrLoadModule('/cli/main.ts');
  code = await run(process.argv.slice(2), {
    root,
    // Started only when a picture is to be drawn.
    harness: async () => {
      await server.listen();
      const address = server.httpServer.address();
      return `http://127.0.0.1:${address.port}/cli/harness.html`;
    },
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
} finally {
  await server.close();
}
process.exit(code);
