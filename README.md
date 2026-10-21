# Agent House

Six autonomous AI agents live in a pixel-art office, go about their day, and plan their own
Solana memecoin together. Their conversations are written live by Claude, the coin logo is
rendered by fal.ai, and viewers ("holders") can drop tips that the agents react to.

- **Nova** – The Visionary (Founder & Narrative)
- **Byte** – The Builder (Solana Engineer)
- **Pixel** – The Artist (Brand & Design)
- **Max** – The Degen (Tokenomics & Markets)
- **Sage** – The Diplomat (Community & Strategy)
- **Juno** – The Meme Lord (Content & Virality)

Everything is English, every agent has a distinct look, personality, voice and skill sheet
(click any agent to open their profile card).

## How it works

- `index.html`, `styles.css`, `src/` – the browser app. Canvas renders the isometric office
  (`renderer.js`), procedural pixel sprites (`sprites.js`), pathfinding and behaviors (`sim.js`).
- `shared/roster.js` – the six agents and the coin-plan stages. Used by both the browser and the API.
- `api/scene.js` – Vercel serverless function. Sends the scene context (participants, plan,
  recent transcript, holder tips) to Claude and gets back a JSON script plus plan updates.
- `api/logo.js` – renders the logo with fal.ai from the prompt Pixel wrote.
- `api/health.js` – tells the browser which keys are configured.

The plan moves through five stages: **brainstorm → concept → branding → tokenomics → launch-ready**.
Every third conversation is a team meeting at the big table; those make the real decisions.
Casual one-on-ones happen at the coffee machine, the couch, the pool table and so on.

Without an `ANTHROPIC_API_KEY` the house runs in offline mode with canned lines so the page
still looks alive. Without a `FAL_KEY` the logo stays a placeholder.

## Deploy on Vercel

1. Import the repo on Vercel (no framework, no build step needed).
2. Add environment variables (Project Settings → Environment Variables):
   - `ANTHROPIC_API_KEY` – required for live dialogue
   - `FAL_KEY` – required for logo generation
   - `ANTHROPIC_MODEL` – optional, default `claude-opus-5-5` (cheaper: `claude-haiku-5-5`)
   - `FAL_MODEL` – optional, default `fal-ai/flux/schnell`
   - `AI_PAUSED` – optional, set to `1` to stop all AI calls without redeploying
3. Deploy.

## Run locally

```bash
npm install
cp .env.example .env   # fill in your keys
npm run serve          # http://localhost:3000
```

`scripts/dev-server.mjs` serves the static site and runs `api/*.js` the same way Vercel does.

## Cost control

- The browser waits 28–55 s between conversations and never calls the API more than once per 25 s.
- `api/scene.js` allows 24 scenes per 10 minutes per IP; `api/logo.js` allows 6 logos per hour per IP.
- The system prompt is cached (`cache_control`), so repeated calls mostly pay for the short dynamic part.
- Set `AI_PAUSED=1` on Vercel to pause everything instantly.

Note: each visitor runs their own copy of the house in their browser (state is kept in
`localStorage`). A shared, server-side world is the natural next step.

## Disclaimer

The agents only plan. Nothing is deployed on-chain, no funds are held, and nothing in the
house is financial advice.
