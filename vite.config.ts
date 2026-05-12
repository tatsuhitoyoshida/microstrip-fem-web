import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  // Serves the SPA from `https://tatsuhitoyoshida.github.io/microstrip-fem-web/`
  // on GitHub Pages. Switch back to `'/'` once we point a custom apex
  // domain (e.g. `tools.photonic-edge.com`) at the same Pages site.
  base: '/microstrip-fem-web/',
  plugins: [react()],
  build: {
    // Vite 8's default Rolldown/OXC minify corrupts lone-surrogate
    // \uD800-\uDFFF escapes (used by KaTeX 0.16.x's Lexer regex) into
    // U+FFFD, which silently breaks parsing of every `\<letter>` macro —
    // \varepsilon collapses to \v, \frac to \f, etc. Terser preserves
    // the original escape sequences and produces an ASCII-safe output
    // without that destructive UTF-8 round-trip.
    minify: 'terser',
    terserOptions: {
      format: { ascii_only: true },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './tests/setup.ts',
    include: ['tests/**/*.{test,spec}.{ts,tsx}'],
    // FEM tests legitimately take 6–17 s under parallel-worker CPU
    // contention; the default 5 s makes them flake. Single-test wall
    // clock peaks around 17 s on FR-4 + Duroid (microstrip.test.ts), so
    // 30 s leaves enough margin without masking a real regression.
    testTimeout: 30000,
  },
});
