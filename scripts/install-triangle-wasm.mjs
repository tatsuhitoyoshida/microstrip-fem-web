#!/usr/bin/env node
/**
 * Drop our `ALLOW_MEMORY_GROWTH=1` rebuild of triangle-wasm into
 * `node_modules/triangle-wasm/`. Wired up as `postinstall` so it runs
 * automatically after `npm install`; can also be invoked manually:
 *
 *   node scripts/install-triangle-wasm.mjs
 *
 * Background: the upstream triangle-wasm@1.0.0 is compiled with a fixed
 * 16 MB heap (~60 k triangle ceiling). Our rebuild — sources committed
 * under `vendor/triangle-wasm/` — lifts that to ~300 k. See CLAUDE.md
 * §14.5 and `vendor/triangle-wasm/README.md` for the full story.
 */

import { copyFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const VENDOR = resolve(ROOT, 'vendor/triangle-wasm');

const sources = ['triangle.out.wasm', 'triangle.out.js'];

// Don't fail the whole `npm install` just because the dev hasn't built
// the vendor artifacts yet — print a friendly note and exit clean.
for (const f of sources) {
  if (!existsSync(resolve(VENDOR, f))) {
    console.warn(
      `[install-triangle-wasm] vendor artifact missing: ${f}\n` +
        '  Skipping postinstall step. Re-run `vendor/triangle-wasm/build-with-growth.sh`\n' +
        '  if you need the heap-growth wasm.',
    );
    process.exit(0);
  }
}

const targets = [
  ['triangle.out.wasm', 'node_modules/triangle-wasm/triangle.out.wasm'],
  ['triangle.out.js', 'node_modules/triangle-wasm/triangle.out.js'],
  // The static asset under `public/` is committed and Vite serves it at
  // the site root in production. Keeping it in sync here means a future
  // vendor rebuild only requires committing the new `vendor/` files —
  // postinstall (or a manual run) propagates to `public/` automatically.
  ['triangle.out.wasm', 'public/triangle.out.wasm'],
];

for (const [src, dest] of targets) {
  const srcPath = resolve(VENDOR, src);
  const destPath = resolve(ROOT, dest);
  // Skip if node_modules/triangle-wasm doesn't exist yet — this runs
  // *before* `npm install` resolves deps in some edge cases (e.g. when
  // `node_modules` is wiped manually).
  if (dest.startsWith('node_modules/') && !existsSync(dirname(destPath))) {
    console.warn(`[install-triangle-wasm] skipping ${dest} (target dir missing)`);
    continue;
  }
  copyFileSync(srcPath, destPath);
}

console.log('[install-triangle-wasm] heap-growth triangle.out.{wasm,js} installed.');
