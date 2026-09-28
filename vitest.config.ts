/**
 * vitest.config.ts
 *
 * Unit test configuration. Tests live next to the code they cover in
 * `__tests__` folders and run in Node (the modules under test are pure
 * TypeScript with no browser or Next.js dependencies).
 *
 * The `@/` alias mirrors the `paths` entry in tsconfig.json.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/** Absolute path of the project root (no trailing separator). */
const projectRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)));

export default defineConfig({
  resolve: {
    alias: [{ find: /^@\//, replacement: `${projectRoot}/` }],
  },
  test: {
    environment: 'node',
    include: ['**/__tests__/**/*.test.ts'],
    exclude: ['node_modules/**', '.next/**'],
  },
});
