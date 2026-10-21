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
  Summon + star grades (1.12) use `little-rescue-summon-v1` (summon.js, `{v, units:{<unitId>:{star,shards}}, sinceLegend,
  pulls, freeDay}`), keyed by unit id; written inside `savedAction` before coins are spent; cloud-save.js carries it as `bundle.summon`. Rates live in engine.js `SUMMON`
  and are shown in the game: keep the in-game table and the README in step with any change.
- Cloud save (1.11): `functions/api/[[path]].js` (Pages Function, D1 bound as `SAVES_DB` (`DB` is the stats DB); no binding = 503 and the ☁️ chip
  stays hidden). `cloud-save.js` uploads `{transfer, meta, daily}` with compare-and-swap `rev`; account in
  `little-rescue-cloud-v1`. Restores go through `SideviewBridge.importCloud` (only when import is safe). Local save stays primary.
  Test locally: `wrangler pages dev game --d1 SAVES_DB=local` from the repo root.
- Server wallet (1.13): for cloud accounts the server owns coins/levels/stars/shards/cleared (`functions/_lib/wallet.js`,
  `play.js`, numbers in `economy.js`, checked against the game by check.mjs). `wallet.js` queues actions in
  `little-rescue-wallet-v1` and adopts the server's numbers via `SideviewBridge.applyWallet` when the queue is empty.
  Any new way to earn or spend coins must also `SideviewWallet.record(...)` it and get a matching op in play.js.
  API: `docs/server-wallet.md`.
- Real-money shop (1.14): `functions/api/shop/[[path]].js` (Stripe Checkout, THB, card + PromptPay; webhook verifies the
  HMAC signature and the order amount). Gems live only in the server wallet (`functions/_lib/wallet.js`), never in a local key;
  `little-rescue-shop-v1` only remembers the last opened order. Live keys stay blocked unless `SHOP_LIVE=1`. Packs are
  `PACKS` in that file; gems buy summons at the coin rates. Test: README "ร้านค้าเพชร".
- Friends + guilds (1.15): `functions/api/friends/[[path]].js`, `functions/api/guilds/[[path]].js`, shared `functions/_lib/social.js`
  (tables profiles, friend_links, friend_gifts, helper_uses, guilds, guild_members in SAVES_DB). Friendship points are the
  server wallet's `fp`, earned only through `award()` (300 F/day cap, Thai day). Client `friends.js`: nothing in any save;
  the lent hero is a UI choice in `little-rescue-social-v1`; a borrowed helper is `battle.setHelper()` for one run.
- Admin + live ops (1.16): `game/admin.html` → `functions/api/admin/[[path]].js` (secret `ADMIN_KEY` ≥ 24 chars, Bearer;
  10 bad keys/15 min/IP → 429; every action and every player view goes to `admin_log`). Gift box, events, maintenance live
  in `functions/_lib/live.js` (tables in SAVES_DB). Players: `GET /api/live` (public), `GET/POST /api/gifts` (device token).
  Gift coins go to the server wallet in one batch with the claim row (ledger ref `gift:<id>:<player>`); cookies are paid
  locally via `little-rescue-gifts-v1` pending → savedAction. Event coin bonus is added by app.js on claim and by play.js
  on the `win` op (same rounding). `game/live.js` mounts before app.js; the lobby 🎁 tab opens it.
- World map (1.17): `STAGES[].chapter` + `CHAPTERS` (engine.js), map art `MAP_ART` (app.js). Pre-1.17 builds clamp meta
  `cleared`/`stage` to 5 stages and may write that back, so app.js mirrors them in `little-rescue-world-v1` (`{v,cleared,stage}`)
  and `readMeta` takes the larger `cleared`. A boss may set `enemy` (ENEMIES index), `calls` (seconds between extra enemies), `aura`.
- Weekly event (1.17): `WEEKLY` + `weekOf`/`weeklyEvent` in engine.js and economy.js (check.mjs compares them); local
  counters in `little-rescue-weekly-v1` (weekly.js, written inside savedAction); server ops `event` / `event-chest` in play.js
  (week progress in the wallet's `days.week`). `battle.setEventStage(spec)` plays it without touching `stageIndex`/`cleared`.
- The save export format is strict (save-transfer.js rejects unknown keys); meta is not exported yet.
- Keep the origin, `manifest.webmanifest` `id`/`start_url`, the Web Locks lifecycle lease and update gating
  (pwa.js never reloads mid-battle or before a reward is claimed).

## Every release

- Bump `BUILD_ID` (sw.js), `PAGE_BUILD_ID` (pwa.js), the version strings in app.js / index.html, `TARGET` in every
  `recover-v*/index.html`; copy the newest recover page to `recover-vXYZ/`; add new files to sw.js PRECACHE.
- `node tools/check.mjs` must pass (CI runs it).
- Test in Chromium (`/opt/pw-browsers/chromium`): serve `game/` with `python3 -m http.server`, win a stage in the
  previous build, open the new build on the same origin, check the save and stage meta, then reopen the old build.
- Layout: since 1.12.5 phones are landscape only (rotate-hint.js covers portrait and pauses a battle; the 1.6.6 portrait
  CSS stays for tablets/old builds); `fit-screen.css` (loaded last) fits phone landscape and computers
  to one screen. Check 390×844, 360×640, 844×390, 820×1180, 1366×768, 1920×1080.

## Game data

- engine.js: `STAGES` (stage 1 = 1.6.6 values, but since 1.9 no stage has a time limit unless it sets `timeLimit`;
  `rage` makes enemies spawned after 60 s stronger), `LEVELS` (+10%/level, cost 20×level coins), `UNITS`, `ENEMIES`,
  deterministic fixed-step `Battle`. Types หินอุ่น > แสงดาว > สายลม > หินอุ่น.
