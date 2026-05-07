import '@testing-library/jest-dom/vitest';

// Triangle-wasm's Emscripten loader prefers WebAssembly.instantiateStreaming
// when available, but in Node 22+ that defers to global fetch — and our
// integration tests pass a filesystem path. Disabling streaming forces the
// safer instantiateArrayBuffer path that uses Node's `fs.readFileSync`.
// Disable for *all* test files so the same bytes path runs everywhere.
(globalThis as { WebAssembly: typeof WebAssembly }).WebAssembly = new Proxy(WebAssembly, {
  get(target, prop) {
    if (prop === 'instantiateStreaming') return undefined;
    return Reflect.get(target, prop);
  },
}) as typeof WebAssembly;
