#!/bin/bash
# Modified build.sh that enables ALLOW_MEMORY_GROWTH so the heap can
# expand at runtime instead of being capped at 16 MB.
#
# Initial: 32 MB (~120 k tri capacity for the very first triangulate call)
# Maximum: 512 MB (~2 M tri ceiling — well past anything we'd plausibly mesh)

set -e

EMSCRIPTEN_DIR="${EMSCRIPTEN_DIR:-C:/emsdk/upstream/emscripten}"
EMSDK_PYTHON="${EMSDK_PYTHON:-C:/emsdk/python/3.13.3_64bit/python.exe}"

"$EMSDK_PYTHON" "$EMSCRIPTEN_DIR/emcc.py" \
  -I ./triangle \
  -s MODULARIZE=1 \
  -s EXPORTED_RUNTIME_METHODS="['lengthBytesUTF8','stringToUTF8','HEAP8','HEAPU8','HEAP16','HEAPU16','HEAP32','HEAPU32','HEAPF32','HEAPF64']" \
  -s EXPORTED_FUNCTIONS="['_malloc','_free','_triangulate']" \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s INITIAL_MEMORY=33554432 \
  -s MAXIMUM_MEMORY=536870912 \
  -O2 \
  -o triangle.out.js \
  ./triangle/triangle.c -DTRILIBRARY
