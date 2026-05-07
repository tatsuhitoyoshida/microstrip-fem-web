/**
 * Type augmentation for `triangle-wasm`.
 * The published @types/triangle-wasm omits `segmentlist` / `segmentmarkerlist`,
 * but they are fully supported by the underlying Triangle binary and required
 * for PSLG (Planar Straight-Line Graph) input. See
 * node_modules/triangle-wasm/index.js (lines ~145-247) and the upstream
 * Triangle docs (`-p` switch).
 */
import 'triangle-wasm';

declare module 'triangle-wasm' {
  interface TriangulateData {
    segmentlist?: number[];
    segmentmarkerlist?: number[];
  }
  interface TriangulateIO {
    segmentlist?: number[];
    segmentmarkerlist?: number[];
  }
}
