/**
 * Lowest-order Nédélec (Whitney 1-form) edge elements on triangles.
 *
 * Each triangle has three edge degrees of freedom — one per edge — and
 * the basis function for the edge from vertex `a` to vertex `b` is
 *
 *     N_{ab}(x, y)  =  λ_a(x, y) ∇λ_b  −  λ_b(x, y) ∇λ_a
 *
 * where λ_i is the barycentric coordinate at vertex i. These are
 * **curl-conforming** on the mesh (tangential continuity across edges
 * is automatic) and **divergence-free** within each element, which is
 * the property that suppresses spurious modes in the vector Helmholtz
 * eigenproblem.
 *
 * Convention (matches `edge-dofs.ts`):
 *   local edge k is opposite vertex k, traversed (k+1) → (k+2) (mod 3).
 *
 * Element matrices delivered here:
 *
 *   K^e_{kl}  =  ∫_T (∇×N_k) · (∇×N_l) dA      (curl-curl stiffness)
 *   M^e_{kl}  =  ∫_T  N_k · N_l dA              (vector mass)
 *
 * Both are 3×3 dense per triangle; assembly modules combine them with
 * orientation signs and material weights to form global blocks.
 *
 * Reference:
 *   J.-M. Jin, "The Finite Element Method in Electromagnetics" (3rd ed.)
 *   §8.4–8.5 derives the same formulae we implement below. Pelosi-
 *   Coccioli-Selleri Quick FEM §3.4 cross-checks the mass-matrix layout.
 */

/** Geometry of one triangle, ready for element-matrix assembly. */
export interface TriangleGeom {
  /** Signed area (positive when vertex order is counter-clockwise). */
  area: number;
  /**
   * Barycentric gradients ∇λ_i = (b_i, c_i), constants on the element.
   * Index 0..2 corresponds to vertex 0..2 of the triangle.
   */
  bs: [number, number, number];
  cs: [number, number, number];
}

/**
 * Compute the linear-T3 barycentric gradients and the unsigned area
 * given the three vertex coordinates. Throws if the triangle is
 * degenerate (zero area).
 */
export function triangleGeom(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): TriangleGeom {
  const twoA = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
  const area = 0.5 * Math.abs(twoA);
  if (area === 0) {
    throw new Error('triangleGeom: degenerate triangle (zero area)');
  }
  const inv2A = 1 / twoA;
  return {
    area,
    bs: [(y1 - y2) * inv2A, (y2 - y0) * inv2A, (y0 - y1) * inv2A],
    cs: [(x2 - x1) * inv2A, (x0 - x2) * inv2A, (x1 - x0) * inv2A],
  };
}

/**
 * Curl of the Whitney 1-form basis function for the local edge opposite
 * vertex `k`. In 2-D the curl of a vector field is a scalar
 * (∂N_y/∂x − ∂N_x/∂y); for `N_k = λ_a ∇λ_b − λ_b ∇λ_a` it works out to
 *
 *     curl N_k  =  2 (b_a c_b − b_b c_a)
 *
 * — a constant on the triangle. The factor of 2 is exact (often quoted
 * as `1/area` in references that fold the 2A into ∇λ).
 *
 * `k=0` → edge (v1, v2), `k=1` → (v2, v0), `k=2` → (v0, v1).
 */
export function edgeCurl(geom: TriangleGeom, k: 0 | 1 | 2): number {
  const a = (k + 1) % 3;
  const b = (k + 2) % 3;
  return 2 * (geom.bs[a]! * geom.cs[b]! - geom.bs[b]! * geom.cs[a]!);
}

/**
 * Element-level **curl-curl stiffness** matrix (3×3). Symmetric.
 *
 *     K^e_{kl}  =  (curl N_k)(curl N_l) · A
 *
 * Both curls are constants on the triangle, so this is a closed-form
 * outer product times area.
 */
export function elementCurlCurl(geom: TriangleGeom): [
  [number, number, number],
  [number, number, number],
  [number, number, number],
] {
  const c0 = edgeCurl(geom, 0);
  const c1 = edgeCurl(geom, 1);
  const c2 = edgeCurl(geom, 2);
  const a = geom.area;
  return [
    [c0 * c0 * a, c0 * c1 * a, c0 * c2 * a],
    [c1 * c0 * a, c1 * c1 * a, c1 * c2 * a],
    [c2 * c0 * a, c2 * c1 * a, c2 * c2 * a],
  ];
}

/**
 * Element-level **vector mass** matrix (3×3). Symmetric.
 *
 *     M^e_{kl}  =  ∫_T  N_k · N_l dA
 *
 * Substituting `N_k = λ_a ∇λ_b − λ_b ∇λ_a` and using the standard
 * triangle integrals
 *
 *     ∫λ_i² dA  = A / 6,        ∫λ_i λ_j dA = A / 12  (i ≠ j),
 *
 * the result expands to four (∇λ_p · ∇λ_q) inner products weighted by
 * `A/6` (when the two λ-indices match) or `A/12` (when they don't).
 *
 * The implementation builds the 3×3 directly from the gradients to
 * keep the formula honest — there's no shortcut that's both correct
 * and short.
 */
export function elementVectorMass(geom: TriangleGeom): [
  [number, number, number],
  [number, number, number],
  [number, number, number],
] {
  const A = geom.area;
  const dot = (i: number, j: number): number =>
    geom.bs[i]! * geom.bs[j]! + geom.cs[i]! * geom.cs[j]!;
  // Integral of λ_i λ_j over the triangle.
  const I = (i: number, j: number): number => (i === j ? A / 6 : A / 12);

  // For local edge k, the basis is N_k = λ_a ∇λ_b - λ_b ∇λ_a where
  // (a, b) = ((k+1) mod 3, (k+2) mod 3).
  const ab: [number, number][] = [
    [1, 2],
    [2, 0],
    [0, 1],
  ];

  const M: number[][] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];

  for (let k = 0; k < 3; k++) {
    const [a, b] = ab[k]!;
    for (let l = 0; l < 3; l++) {
      const [c, d] = ab[l]!;
      // (λ_a ∇λ_b − λ_b ∇λ_a) · (λ_c ∇λ_d − λ_d ∇λ_c)
      //  = λ_a λ_c (∇λ_b·∇λ_d) − λ_a λ_d (∇λ_b·∇λ_c)
      //   − λ_b λ_c (∇λ_a·∇λ_d) + λ_b λ_d (∇λ_a·∇λ_c)
      const v =
        I(a, c) * dot(b, d) -
        I(a, d) * dot(b, c) -
        I(b, c) * dot(a, d) +
        I(b, d) * dot(a, c);
      M[k]![l] = v;
    }
  }
  return M as [
    [number, number, number],
    [number, number, number],
    [number, number, number],
  ];
}
