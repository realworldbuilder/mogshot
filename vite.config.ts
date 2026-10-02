import preact from '@preact/preset-vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Served from https://realworldbuilder.github.io/mogshot/
  base: '/mogshot/',
  plugins: [preact()],
  worker: { format: 'es' },
  test: {
    include: ['test/**/*.test.ts'],
  },
});
