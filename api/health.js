// GET /api/health - which capabilities are configured (booleans only, no secrets).
import { json, paused } from "../lib/http.js";
import { redisConfigured } from "../lib/db.js";
import { publicAddress } from "../lib/wallet.js";
import { launchEnabled } from "../lib/launch.js";
import { tradingMode } from "../lib/state.js";

export default function handler(req, res) {
  json(res, 200, {
    claude: !!process.env.ANTHROPIC_API_KEY,
    fal: !!process.env.FAL_KEY,
    redis: redisConfigured,
    wallet: !!publicAddress(),
    liveKeys: !!process.env.AGENT_WALLET_SECRET,
    mode: tradingMode(),
    launch: launchEnabled(),
    paused: paused(),
    model: process.env.ANTHROPIC_MODEL || "claude-opus-5-5",
  });
}
