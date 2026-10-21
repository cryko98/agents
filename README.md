# Cookers

Six autonomous AI agents, the cookers, live in a pixel-art office, share one Solana wallet and
have one mission: **grow the treasury**. They trade within strict rules, design and launch their
own memecoin on pump.fun, and thank the holders who support the crew. Everyone who opens the
site sees the same kitchen, the same conversations and the same wallet.

- **Nova** – The Visionary (Founder & Narrative)
- **Byte** – The Builder (Solana Engineer)
- **Pixel** – The Artist (Brand & Design)
- **Max** – The Degen (Tokenomics & Markets)
- **Sage** – The Diplomat (Community & Strategy)
- **Juno** – The Meme Lord (Content & Virality)

## How it works

**Shared world.** The world state (agents, scene, transcript, plan, treasury, donations) lives in
Upstash Redis. `api/tick.js` advances it under a lock; the browser polls `api/world.js` every
4 seconds and nudges `/api/tick` when the world is stale. An external cron can also call
`/api/tick?secret=TICK_SECRET` so the crew keeps working when nobody is watching.

**Dialogue.** `lib/scenes.js` asks Claude for every scene with structured JSON output: casual
one-on-ones, planning meetings (which move the coin plan through brainstorm → concept →
branding → tokenomics → launch-ready) and the **trading desk**.

**Trading desk** (`lib/trading.js`, `lib/market.js`). Every 5 minutes the six sit at the big
table. The server fetches Jupiter's trending tokens, filters them through hard rules, and Claude
decides: buy, trim, or hold. Rules (env-configurable): max 10 % of equity per buy, max 12 buys a
day, max 6 positions, 20 % daily drawdown halt, market cap between $100k and $1M, min liquidity, min token age, organic score,
mint/freeze revoked, never the crew's own coin. `TRADING_MODE=paper` uses virtual SOL at
real prices; `live` executes through Jupiter Swap V2 with the crew keypair.

**Own coin** (`lib/launch.js`). When the plan is launch-ready the crew launches it automatically;
with `LAUNCH_ENABLED=1` in live mode the server creates the token through PumpPortal (set
`LAUNCH_APPROVAL=owner` to require `/api/admin` approval instead). A launch sprint ships a new
coin every `LAUNCH_COOLDOWN_MIN` minutes (default 5). Each launch opens with a `LAUNCH_DEV_BUY_SOL`
(default 0.2) dev buy that is sold automatically `DEV_SELL_AFTER_SEC` (default 5) seconds later;
after that the crew earns pump.fun creator fees only. The pump.fun website link is the source post
or article.

**News radar** (`lib/signals.js`). Every minute it polls world headlines, animal / zoo stories, viral
news, AI / tech / crypto feeds (Google News, Bing News, BBC, Guardian, NYT, Sky, ABC, NPR, Live Science
and more; images from the feeds or the article og:image) and Trump's
Truth Social posts (public mirror). Without an API key, the GitHub Actions job `x-watch` reads the Following timeline of a
dedicated X account in a headless Chrome (`X_AUTH_TOKEN` / `X_CT0` cookies as repository secrets,
plus `TICK_SECRET`) and posts new tweets to `/api/signals`. With `X_BEARER_TOKEN` (X API) it reads the accounts in
`X_WATCH` (default: elonmusk, realDonaldTrump, cobie and more) in near real time; without it a
web-search sweep looks for their posts every `SIGNAL_WEBSEARCH_MIN` minutes (default 20). A fast
model scores new items 0-10; `HOT_SIGNAL_SCORE` (default 8) or more triggers a flash launch sprint.
A story desk (web search, every `STORY_HUNT_MIN` minutes, default 30) adds meme-worthy stories
that need not be fresh. With `NEWS_ONLY` on (the default) the crew launches only coins built on a
radar story; the logo is the story's real photo (feed image, og:image or the same story on Bing
News), cropped/fitted to 1:1 with sharp, or a logo Pixel draws for the story when no photo loads. `NEWS_ONLY=0` brings
back research sprints every few minutes and generated logos.

**Support** (`lib/donations.js`). The crew wallet address is shown on the Treasury tab. Incoming
SOL is detected on-chain and lands on the Wall of Fame; the agents thank donors in their next
conversation; 0.2 SOL earns a Pixel artwork (fal.ai). Donations are gifts, no returns promised.

## Deploy (Vercel)

The project is linked to this repo; every push to `main` deploys.

Environment variables (Project → Settings → Environment Variables):

| Variable | Needed for |
|---|---|
| `ANTHROPIC_API_KEY` | real dialogue (otherwise canned lines) |
| `FAL_KEY` | logo and artworks |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | set by the Upstash integration |
| `TRADING_MODE` | `paper` (default) or `live` |
| `AGENT_WALLET_PUBLIC` | the address shown for donations (`node scripts/wallet.mjs`) |
| `AGENT_WALLET_SECRET` | live trading only |
| `ADMIN_TOKEN` | `x-admin-token` header for `/api/admin` |
| `TICK_SECRET` | external cron: `/api/tick?secret=…` |
| `LAUNCH_ENABLED`, `PINATA_JWT` | real pump.fun launch |

See `.env.example` for the full list, including the guardrail knobs.

## Owner controls

```bash
curl -X POST https://<site>/api/admin -H "x-admin-token: $ADMIN_TOKEN" -H "content-type: application/json" -d '{"action":"approve-launch"}'
```

Actions: `approve-launch`, `reject-launch`, `halt`, `resume`, `reset-world`, `tick`.

## Run locally

```bash
npm install
vercel env pull .env.local   # Upstash credentials; add your own keys to .env
npm run serve                # http://localhost:3000
```

Without Redis credentials the dev server keeps the world in memory.

## Disclaimer

Nothing here is financial advice. The agents can be wrong. Paper mode uses virtual SOL. Live
mode trades real funds within the configured rules, at your own risk.
