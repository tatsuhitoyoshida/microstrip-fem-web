# vendor/triangle-wasm

Custom rebuild of [triangle-wasm](https://github.com/brunoimbrizi/triangle-wasm)
with `ALLOW_MEMORY_GROWTH=1` so the WebAssembly heap can grow at runtime
instead of being capped at the upstream's 16 MB. This lifts the
~60 k-triangle ceiling that constrained the adaptive mesh refinement loop.

## Files

| File | Role |
| --- | --- |
| `build-with-growth.sh` | Emscripten command line that produces the artifacts. |
| `triangle.out.wasm`    | Rebuilt WebAssembly module. Initial 32 MB, growth up to 512 MB. |
| `triangle.out.js`      | Matching Emscripten JS loader (modular factory). |
| `install.sh`           | Bash version of the install step (Git Bash / Linux / macOS). |
| (`scripts/install-triangle-wasm.mjs`) | Node.js version, runs as `postinstall` and via `npm run install:triangle-wasm`. |

## When to rebuild

You don't need to, normally — the rebuilt artifacts are committed. Rebuild only if:

- Triangle's C source needs a newer version
- A different growth ceiling / initial heap is desired
- The Emscripten output needs newer ABI shape

## How to rebuild

Requires the Emscripten SDK (~1 GB):

```bash
git clone https://github.com/emscripten-core/emsdk.git C:/emsdk
cd C:/emsdk
./emsdk install latest
./emsdk activate latest
```

Get the Triangle source (Shewchuk 1.6, public netlib):

```bash
git clone https://github.com/brunoimbrizi/triangle-wasm.git C:/triangle-wasm-src
mkdir -p C:/triangle-wasm-src/lib/triangle
cd C:/triangle-wasm-src/lib/triangle
curl -LO https://www.netlib.org/voronoi/triangle.zip
unzip -q triangle.zip
```

Build:

```bash
cp vendor/triangle-wasm/build-with-growth.sh C:/triangle-wasm-src/lib/
cd C:/triangle-wasm-src/lib
./build-with-growth.sh
cp triangle.out.{wasm,js} <repo>/vendor/triangle-wasm/
```

Then run `vendor/triangle-wasm/install.sh` to drop them into the
right places.

## After `npm install`

`npm install` would normally overwrite `node_modules/triangle-wasm/`
with the upstream (heap-locked) build. The `postinstall` hook in
`package.json` runs `scripts/install-triangle-wasm.mjs` automatically
to restore the growth-enabled artifacts — no manual step required.

If you want to re-run it explicitly: `npm run install:triangle-wasm`
(or, on bash, `./vendor/triangle-wasm/install.sh`).

## Why this matters

Upstream is compiled with `WebAssembly.Memory({ initial: 256 pages,
maximum: 256 pages })` — `initial === maximum` so growth is impossible
at the WebAssembly level. `_emscripten_resize_heap` is hard-wired to
`abort("OOM")`. Our build sets initial 32 MB / max 512 MB and lets
Emscripten generate the proper `growMemory` runtime, lifting the
triangle ceiling from ~60 k to ~300 k+ (the new practical limit is
Triangle's internal data structures, not the heap).
