# microstrip-fem-web

Browser-based 2D Finite Element Method (FEM) solver for microstrip transmission line characteristic impedance Z₀.

> **Status**: v0.1 in development. See [CLAUDE.md](./CLAUDE.md) for the full roadmap.

[日本語版 README](./README.ja.md)

## Why FEM?

Most online microstrip calculators use Hammerstad-Jensen or Wheeler closed-form
expressions, which lose accuracy for thick conductors, low h/W ratios, and high
frequencies. This tool runs a true 2D quasi-static FEM directly in the browser,
giving rigorous Z₀ values that hold up where closed-form approximations break
down. v0.1 covers single-ended microstrip; differential pairs, CPW, and
stripline are planned for later phases.

## Quick start

```bash
npm install
npm run dev      # start the local Vite dev server
npm run test     # run Vitest in watch mode
npm run build    # produce a production build in dist/
```

Node.js v20 LTS or later is required.

## Tech stack

| Area            | Choice                      |
| --------------- | --------------------------- |
| Language        | TypeScript (strict)         |
| UI              | React 19                    |
| Build           | Vite                        |
| Mesh            | `triangle-wasm`             |
| Linear solver   | `eigen-js` (SimplicialLDLT) |
| Plotting        | Plotly.js                   |
| i18n            | `react-i18next`             |
| Compute offload | Web Worker                  |
| Tests           | Vitest                      |
| Hosting         | Cloudflare Pages            |

## Project structure

The full project structure, FEM mathematics, and per-phase development plan are
documented in [CLAUDE.md](./CLAUDE.md). Theory and validation notes will live in
`docs/` once Phase 9 is reached.

## License

MIT. See [LICENSE](./LICENSE).

## Contributing

Issues and PRs are welcome. Please read [CLAUDE.md](./CLAUDE.md) first to
understand the design constraints, especially the v0.1 scope-out list.

---

Built by [Photonic Edge Inc.](https://photonic-edge.com) — published at
`tools.photonic-edge.com`.
