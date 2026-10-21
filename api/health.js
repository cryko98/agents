// GET /api/health - tells the browser which capabilities are configured (booleans only).
import { json, paused } from "../lib/http.js";

export default function handler(req, res) {
  json(res, 200, {
    claude: !!process.env.ANTHROPIC_API_KEY,
    fal: !!process.env.FAL_KEY,
    paused: paused(),
    model: process.env.ANTHROPIC_MODEL || "claude-opus-5-5",
  });
}
