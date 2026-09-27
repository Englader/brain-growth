import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';

export default defineConfig({
  plugins: [preact()],
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    environment: 'node',
    // Locale bundles are loaded on demand in the app; tests start with all of them loaded.
    setupFiles: ['tests/setup.ts'],
    testTimeout: 30_000,
  },
});
