# 0xHub

A modern gaming hub. First title: **Tetris Battle**, with an Endless mode and a real-time 1v1 Battle mode modeled on Facebook's Tetris Battle 2P.

## Stack

| Layer | Choice | Why |
| --- | --- | --- |
| Frontend | React 19, TypeScript, Vite, Tailwind CSS v4 | Fast dev loop, small bundle; the game renders on `<canvas>` |
| Realtime | WebSockets on Cloudflare Durable Objects | One Durable Object per match keeps both sockets and the match state in a single place |
| Database | Durable Object SQLite storage | Built into the leaderboard object, free tier, nothing extra to set up |
| Hosting | Cloudflare Workers (static assets + API in one deploy) | Free plan covers it, and the site and game server deploy together |

**Why not Vercel:** Vercel serverless functions can't hold a WebSocket open, so a live 1v1 would need a paid third-party realtime service. Cloudflare runs the site, the WebSocket server and the database on one free account.

## Project layout

```
shared/protocol.ts        Message types shared by client and server
worker/index.ts           HTTP + WebSocket routing (/api/*)
worker/matchmaker.ts      Quick-match queue (Durable Object)
worker/room.ts            1v1 match referee: clock, garbage routing, KOs, results
worker/leaderboard.ts     SQLite leaderboard: endless high scores + battle Elo ratings
src/games/tetris/engine.ts   Pure Tetris engine (unit tested)
src/games/tetris/render.ts   Canvas renderer + block skins
src/games/tetris/skins.ts    Skin and board-theme definitions
src/games/tetris/session.ts  Game loop, input, effects
src/pages/*               Dashboard, Games, Tetris, Endless, Battle, Leaderboard, Profile, Settings
```

## Tetris mechanics

- SRS rotation with full wall-kick tables, 7-bag randomizer, hold (once per piece), 5-piece next queue, ghost piece
- Lock delay of 500 ms with move reset (15 resets max)
- T-spin detection (3-corner rule, including minis), back-to-back, combos, perfect clears
- Configurable DAS, ARR and soft-drop speed; key remapping

**Battle 2P rules (Tetris Battle style)**

- 2-minute rounds. Topping out gives your opponent a KO and your field resets. Most KOs wins; ties go to whoever sent more lines.
- Garbage sent: Double 1, Triple 2, Tetris 4, T-Spin Single/Double/Triple 2/4/6, Back-to-Back +1, Combo +1…+5, Perfect Clear +10
- Incoming garbage shows on the red meter. Your line clears cancel it first; anything left rises when you lock a piece without clearing.
- Your opponent's board streams live (about 20 updates/sec) and renders in their chosen skin.
- Quick match, or a private room with a 5-character code and a share link
- Elo rating (starts at 1000) and a global battle leaderboard

**Customization:** 10 block skins (Classic bevel, Flat, Neon, Glass, 8-Bit, Candy, Gems, Wireframe, Monochrome, Sunset) and 8 board themes (Tetris Battle, Midnight, Aurora, Synthwave, Matrix, Ember, Void, Paper), with a live preview.

## Develop

```bash
npm install
npm run dev        # http://localhost:5173 — runs the Worker + Durable Objects locally too
npm test           # engine unit tests
npm run typecheck
```

To test 1v1 locally, open two browser windows and hit **Quick match** in both. Use a private window for one of them so you get two different players.

## Deploy to Cloudflare (free)

1. Create a free account at https://dash.cloudflare.com/sign-up
2. Log in from this folder (opens your browser once):
   ```bash
   npx wrangler login
   ```
3. Deploy:
   ```bash
   npm run deploy
   ```
   This prints your URL, e.g. `https://0xhub.<your-subdomain>.workers.dev`.
4. Optional: add a custom domain under Workers & Pages → 0xhub → Settings → Domains & Routes.

For automatic deploys on every push, connect the GitHub repo under Workers & Pages → 0xhub → Settings → Builds. Use build command `npm run build` and deploy command `npx wrangler deploy`.

## Known limits / next steps

- Players are guests identified by a random ID in localStorage. Anyone could reuse an ID, and clearing site data creates a new player. Real accounts (e.g. OAuth) would be the next step before treating the leaderboard as competitive.
- Each client simulates its own board, and the server referees time, garbage and KOs. Endless scores get a basic plausibility check, not full server-side replay validation.
- Switching browser tabs mid-battle pauses your board (browsers throttle background animation), but the match clock keeps running.
