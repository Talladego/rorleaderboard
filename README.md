# RoR Leaderboard (standalone)

Standalone app extracted from `rorplanner3/public/leaderboard.html`, built with the same dev platform as RoR Planner 3 (Vite 7 + Tailwind 4 via PostCSS).

## Quick start

```powershell
# from this folder
npm install
npm run dev
# Then open http://localhost:3002/
```

The page is fully static and uses the public GraphQL API at `https://production-api.waremu.com/graphql/`.

The app is served from the root path (`/`). The legacy route `/leaderboard.html` will redirect to `/`.

## Build

```powershell
npm run build
npm run preview
# Then open http://localhost:4173/
```

## Notes

- Icons: The page loads career icons from `https://killboard.returnofreckoning.com/...` with a fallback to `/icons/careers/...`. If you want offline/local icons, copy the careers PNGs from `rorplanner3/public/icons/careers/` into `public/icons/careers/` here (same filenames).
- Port: Dev server is on port 3002 to avoid clashing with RoR Planner 3 (3001). Adjust in `vite.config.ts` if you prefer.
- This project intentionally has no React/TypeScript source; Vite is used to serve/build the static public assets so it stays consistent with the main project’s toolchain.

## Deploy to Cloudflare Pages

Two options:

1) Cloudflare Pages GitHub integration (Dashboard)
- In the Cloudflare dashboard, create a Pages project and connect this repository at the `rorleaderboard` folder (monorepo support). Build command: `npm run build`. Output directory: `dist`.
- Every push to your default branch will auto-deploy. The site serves from `/` (index.html). The legacy `/leaderboard.html` path will redirect to `/`.

2) GitHub Actions (preconfigured here)
- A workflow is included at `.github/workflows/deploy-cloudflare-pages.yml` that builds and deploys to Pages.
- Add the following repository secrets (Settings → Secrets and variables → Actions → New repository secret):
	- `CLOUDFLARE_API_TOKEN` – Pages write token with “Cloudflare Pages” + “Edit Cloudflare Workers” permissions, or an API token with Pages:Edit.
	- `CLOUDFLARE_ACCOUNT_ID` – Your Cloudflare account ID.
	- `CLOUDFLARE_PROJECT_NAME` – The Pages project name (e.g., `rorleaderboard`).
- Push to `main` (or `master`) to trigger the workflow.

After the first deploy, your site should be available at `https://<project>.pages.dev/` (root). `https://<project>.pages.dev/leaderboard.html` will redirect to root.
