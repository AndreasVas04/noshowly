/**
 * eslint.config.mjs
 *
 * Next.js rules (core web vitals, React, React Hooks, accessibility) and the
 * typescript-eslint recommended rules, from eslint-config-next.
 */

import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // A leading underscore marks a parameter that must be there but is not
      // used, e.g. the request argument of a route handler.
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'coverage/**',
    'node_modules/**',
    'supabase/**',
    'next-env.d.ts',
  ]),
]);
