# Server wallet and anti-cheat (1.13.0)

For a player with a cloud account (☁️), the server holds the real coins, gems, friend points and everything coins
buy: hero levels, stars, shards, summon pity and cleared stages. Guests without an account play exactly as before,
with nothing sent anywhere.

Everything runs on the existing Cloudflare Pages Functions and the D1 database bound as `SAVES_DB`. No new
Cloudflare setting is needed: the tables are created on first use.

## How it works

1. The game still applies every action locally at once, so it keeps working offline.
2. A signed-in device also queues each action (win, loss, level-up, star-up, daily reward) in
   `little-rescue-wallet-v1` and sends the queue when online (`POST /api/wallet/ops`).
3. The server re-checks each action against its own wallet and the numbers in `functions/_lib/economy.js`
   (prices, rewards, what is unlocked) and the play limits below, then records it in `ledger`.
4. When the queue is empty, the game adopts the server's numbers (only before a battle or after the reward).
   Coins edited in browser storage therefore come back to the real value at the next sync.
5. Summons are rolled by the server (`crypto.getRandomValues`), so a signed-in player needs a connection to summon.
6. The first time an account that played before 1.13 syncs, its local progress seeds the wallet once
   (`POST /api/wallet/seed`). Coins brought in this way are capped at 50,000; the ledger row keeps what was sent.

### Play limits (`PLAY` in economy.js)

| Check | Limit |
|---|---|
| Battle time of a win | at least 20 s (the fastest possible win at max power is about 30 s) |
| Real time between `/api/wallet/run` and the claim | at least 12 s and at least half the battle time (x2 speed) |
| Wins | 60 per hour, 400 per day |
| Wins without a run ticket (played offline) | 30 per day, claimed within 7 days |
| Run tickets | 120 per hour |
| Daily login / missions | once per calendar day, day within ±1 of the server's date; missions count server-verified wins, level-ups and calls |

`tools/check.mjs` fails the build if economy.js and the game's numbers (engine.js, daily-missions.js) differ,
including the summon algorithm.

## HTTP API (same origin, `Authorization: Bearer <device token>`)

| Route | Body | Answer |
|---|---|---|
| `GET /api/health` | | `{ok, cloud, wallet}`; `wallet: true` = this server checks coins |
| `GET /api/wallet` | | `{playerId, wallet}`; `wallet` is `null` until seeded |
| `POST /api/wallet/seed` | `{coins, levels[5], cleared, units, sinceLegend, pulls, freeDay, login}` | `{playerId, wallet}` (a second seed changes nothing) |
| `POST /api/wallet/run` | `{stage}` | `{run, startedAt}`, or 409 `stage-locked` / 429 `rate-limited` |
| `POST /api/wallet/ops` | `{ops: [...]}` (max 50, applied in order) | `{results: [{id, ok, error?, duplicate?, result?}], wallet}` |

The wallet the game sees: `{rev, seeded, coins, gems, fp, cleared, levels, units: {<unitId>: {star, shards}},
sinceLegend, pulls, freeDay, login: {streak, lastDay}}`.

Every op has `id` (8–64 of `A-Z a-z 0-9 _ -`, chosen by the device; the same id is never applied twice) and `day`
(the player's local `YYYY-MM-DD`).

| kind | fields | effect |
|---|---|---|
| `win` | `stage, battle` (seconds), `summons`, `run?`, `at` | + stage reward, unlocks the next stage |
| `loss` | `stage, summons` | counts calls for the daily mission only |
| `level` | `unit` (0–4), `level` (current) | − 20 × level coins, level + 1 |
| `star` | `unit` (id), `star` (current) | − shards and coins, star + 1 |
| `summon` | `pull: 'free' | '1' | '10'`, `currency: 'coins' | 'gems'` | server roll; `result.results` = `[{tier, unit, shards}]` |
| `daily` | `mission: 'login' | 'wins' | 'summons' | 'levelups'` | + reward |

Errors: `no-wallet`, `stage-locked`, `too-fast`, `too-old`, `rate-limited`, `bad-run`, `stale` (the device's
level/star was out of date), `insufficient`, `max`, `used`, `claimed`, `not-done`, `bad-day`, `busy`.

## For other server features (shop, friends, admin)

```js
import {json, fail, readBody, authenticate} from '../../_lib/http.js';
import {getWallet, credit, debit, apply} from '../../_lib/wallet.js';

await credit(db, playerId, {coins: 100}, {kind: 'gift', ref: `gift:${giftId}:${playerId}`});
await debit(db, playerId, {gems: 30}, {kind: 'shop', ref: `gemspend:${uuid}`}); // error 'insufficient' if short
```

- `ref` is the idempotency key for the whole system (`ledger.op_id`): the same ref pays or charges once.
  Prefix it with your feature (`pay:`, `refund:`, `gift:`, `fgift:` …).
- Both return `{applied, duplicate, error?, wallet}`. `credit` creates the wallet row when the player has none.
- `apply(db, playerId, {ref, kind}, w => { …edit w…; return {statements: [...]} })` adds your own statements to the
  same atomic batch as the wallet and ledger write.
- Writes are compare-and-swap on `wallets.rev`; `ledger (player_id, seq)` is unique, so two concurrent writes can
  never both land on the same revision.
- Put your routes in their own file (`functions/api/shop/[[path]].js` etc.), not in `functions/api/[[path]].js`.
