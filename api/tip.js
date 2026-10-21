// POST /api/tip - a viewer drops a tip for the agents. Consumed by the next tick.
import { json, clientIp, readBody } from "../lib/http.js";
import { rateLimit } from "../lib/ratelimit.js";
import { db } from "../lib/db.js";
import { TIPS_KEY } from "../lib/state.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "POST only" });
  const rl = rateLimit(`tip:${clientIp(req)}`, 5, 10 * 60 * 1000);
  if (!rl.ok) return json(res, 429, { error: `Slow down, try again in ${rl.retryAfter}s` });
  const body = await readBody(req);
  const text = String(body.text || "").replace(/\s+/g, " ").trim().slice(0, 200);
  if (text.length < 2) return json(res, 400, { error: "tip too short" });
  const len = await db().llen(TIPS_KEY);
  if (len >= 20) return json(res, 429, { error: "The tip box is full, wait for the next conversation" });
  await db().rpush(TIPS_KEY, JSON.stringify({ text, t: Date.now() }));
  return json(res, 200, { ok: true });
}
