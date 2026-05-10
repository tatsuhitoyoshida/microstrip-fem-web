/**
 * Vitest config for the shelved full-wave research code under
 * `research/`. The main `vitest.config.ts` ships in the production
 * release path and only picks up `tests/**`; this config exists so
 * the math under `research/src/fem-fullwave/` and the numerical
 * regression tests in `research/tests/` can be re-run on demand
 * without contaminating the production test surface.
 *
 * Usage:
 *
 *     npm run test:research          # run the full-wave validation suite
 *     npm run test:research -- --watch
 */
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './tests/setup.ts',
    include: ['research/tests/**/*.{test,spec}.{ts,tsx}'],
  },
});
