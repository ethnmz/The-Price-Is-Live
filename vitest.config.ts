import { defineConfig } from 'vitest/config';

// Tests must run offline: no network, no API keys, no phone. Mock everything external.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 15000,
  },
});
