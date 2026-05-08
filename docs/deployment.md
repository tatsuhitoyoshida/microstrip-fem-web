# Deployment

The site is a static SPA. Anything that can serve the contents of `dist/`
under the SPA "rewrite all unknown paths to /index.html" rule will host
it correctly. We target Cloudflare Pages.

This document covers the one-time bring-up; once it is wired,
`git push` to the `main` branch is the entire deploy workflow.

## Prerequisites

- A GitHub repository at `photonic-edge/microstrip-fem-web` (the URL
  baked into `package.json` and the in-app About page).
- A Cloudflare account with access to **Workers & Pages**.
- Ownership of `photonic-edge.com` DNS (the production hostname is
  `tools.photonic-edge.com`).

## 1. Local sanity check

```bash
npm install
npm run typecheck
npm run lint
npm run format:check
npm run test:run
npm run build
npm run preview        # serves dist/ on http://localhost:4173
```

If `preview` looks correct in the browser, the build artefact is good.

## 2. Push to GitHub

```bash
git remote add origin git@github.com:photonic-edge/microstrip-fem-web.git
git branch -M main
git push -u origin main
```

Confirm the repo is public (or invite the Cloudflare integration to a
private repo).

## 3. Connect Cloudflare Pages

1. **Cloudflare dashboard → Workers & Pages → Create → Pages → Connect
   to Git.**
2. Pick the GitHub account and the `microstrip-fem-web` repository.
3. Build settings:

   | Field                  | Value                                 |
   | ---------------------- | ------------------------------------- |
   | Production branch      | `main`                                |
   | Framework preset       | None (or "Vite" if offered)           |
   | Build command          | `npm run build`                       |
   | Build output directory | `dist`                                |
   | Root directory         | (leave blank)                         |
   | Node.js version        | `20` (set via `NODE_VERSION` env var) |

4. Add an environment variable `NODE_VERSION = 20` to both Production
   and Preview environments. Without this Cloudflare's default build
   image picks Node 18, which fails on some of our devDependencies.
5. Save. The first build runs immediately. It should land at a
   `*.pages.dev` URL within a minute or two.

## 4. Custom domain

1. **Pages project → Custom domains → Set up a custom domain →
   `tools.photonic-edge.com`.**
2. Cloudflare provisions a TLS certificate automatically.
3. DNS:
   - If `photonic-edge.com` is on Cloudflare DNS already, the CNAME is
     created for you.
   - If it lives at another DNS provider, add a CNAME record
     `tools → <project-slug>.pages.dev` (TTL 5 min for the first cut,
     bump to 1 h once the site is stable).
4. Wait for DNS propagation (usually a few minutes), then verify
   `https://tools.photonic-edge.com/` serves the app.

## 5. SPA routing fallback

The app uses URL prefixes `/ja/` and `/en/` for language detection
(react-i18next). These are not real routes — there is no router — but
Cloudflare Pages must serve `index.html` for any unknown path so the
client-side detection sees the prefix.

Cloudflare Pages applies SPA rewrites automatically when no `_redirects`
file is present. If you ever need to override, drop a `public/_redirects`
with:

```text
/*    /index.html    200
```

It will be copied to `dist/_redirects` by Vite.

## 6. Verifying the production deploy

Once the Pages build is green and DNS has switched over, run through the
manual checklist:

- `https://tools.photonic-edge.com/` returns 200 and renders the app.
- Network tab: `triangle.out.wasm` (125 kB) and the lazy `plotly.min.js`
  chunk (~1.4 MB gzip) both load with `200` after the first **Calculate**.
- Pressing **Calculate** completes a forward solve in roughly 600 ms on
  desktop (≈1.5 s on a mid-range mobile), and **Find W for target Z₀**
  completes in roughly 1.5 s.
- Switching the language toggle moves the URL between `/ja/` and `/en/`
  and translates the UI on the spot.
- DevTools Lighthouse → Performance ≥ 90.
- `https://tools.photonic-edge.com/ja/` and `/en/` directly load the app
  with the right language.

## 7. Subsequent deploys

Cloudflare Pages auto-builds on every push to `main`. Preview builds run
automatically for pull requests against `main` and get their own
`<branch>--<project>.pages.dev` URLs.

To force a redeploy without a code change (e.g. after rotating an env
var), use **Pages project → Deployments → Retry deployment**.

## 8. Rollback

If a deploy is bad: **Pages project → Deployments → pick a previous
green deploy → Rollback to this deployment**. This swaps the production
alias atomically; no DNS change.
