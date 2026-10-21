# Little Rescue: notes for Claude sessions

Buildless PWA in `game/` (plain JS, no bundler). Deployed to the existing Cloudflare Pages project
(little-rescue.pages.dev) by `.github/workflows/deploy.yml`: push to `main` = production, a PR = preview `pr-N`.
The owner writes Thai; reply in Thai.

## Never break saves (the game was released 2026-10-18)

- `little-rescue-sideview-save-v2` (save-store.js): its sanitizer keeps only `{energy, progress:{coins,rescued}, roster}`,
  and older builds strip unknown fields, so never add data to it. New data goes in its own key, like
  `little-rescue-meta-v1` (`{v, cleared, levels[5], stage}`, app.js `readMeta`/`writeMeta`).
  Daily missions + 7-day login (1.8) use `little-rescue-daily-v1` (daily-missions.js); claims are written inside
  `savedAction` so they hold the save lock.
- Cloud save (1.10): `functions/api/[[path]].js` (Pages Function, D1 bound as `DB`; no binding = 503 and the ☁️ chip
  stays hidden). `cloud-save.js` uploads `{transfer, meta, daily}` with compare-and-swap `rev`; account in
  `little-rescue-cloud-v1`. Restores go through `SideviewBridge.importCloud` (only when import is safe). Local save stays primary.
  Test locally: `wrangler pages dev game --d1 DB=local` from the repo root.
- The save export format is strict (save-transfer.js rejects unknown keys); meta is not exported yet.
- Keep the origin, `manifest.webmanifest` `id`/`start_url`, the Web Locks lifecycle lease and update gating
  (pwa.js never reloads mid-battle or before a reward is claimed).

## Every release

- Bump `BUILD_ID` (sw.js), `PAGE_BUILD_ID` (pwa.js), the version strings in app.js / index.html, `TARGET` in every
  `recover-v*/index.html`; copy the newest recover page to `recover-vXYZ/`; add new files to sw.js PRECACHE.
- `node tools/check.mjs` must pass (CI runs it).
- Test in Chromium (`/opt/pw-browsers/chromium`): serve `game/` with `python3 -m http.server`, win a stage in the
  previous build, open the new build on the same origin, check the save and stage meta, then reopen the old build.
- Layout: phones portrait keep the 1.6.6 layout; `fit-screen.css` (loaded last) fits phone landscape and computers
  to one screen. Check 390×844, 360×640, 844×390, 820×1180, 1366×768, 1920×1080.

## Game data

- engine.js: `STAGES` (stage 1 = 1.6.6 values, but since 1.9 no stage has a time limit unless it sets `timeLimit`;
  `rage` makes enemies spawned after 60 s stronger), `LEVELS` (+10%/level, cost 20×level coins), `UNITS`, `ENEMIES`,
  deterministic fixed-step `Battle`. Types หินอุ่น > แสงดาว > สายลม > หินอุ่น.
