#!/bin/bash
# Restore the heap-growth-enabled triangle.out.{wasm,js} into node_modules.
# Run after `npm install` (which would otherwise put back upstream's
# 16 MB-fixed-heap build that caps the mesh at ~60 k triangles).
#
# The artifacts in this directory were produced by build-with-growth.sh;
# see CLAUDE.md §14.5 for the why.

set -e

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"

cp "$HERE/triangle.out.wasm" "$ROOT/node_modules/triangle-wasm/triangle.out.wasm"
cp "$HERE/triangle.out.js" "$ROOT/node_modules/triangle-wasm/triangle.out.js"
cp "$HERE/triangle.out.wasm" "$ROOT/public/triangle.out.wasm"

echo "Restored triangle-wasm with ALLOW_MEMORY_GROWTH=1."
