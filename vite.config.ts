/// <reference types="vitest" />
import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  build: {
    rollupOptions: {
      input: { main: resolve(__dirname, 'index.html'), editor: resolve(__dirname, 'editor.html') },
    },
    chunkSizeWarningLimit: 1200,
  },
  server: { port: 5178 },
  preview: { port: 5179 },
  test: { include: ['src/**/*.test.ts'] }, // Playwright specs live in tests/e2e
});
