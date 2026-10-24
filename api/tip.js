// POST /api/tip - a holder messages the agents. Needs a holder session (POST /api/holder) and the
// project token still in the wallet. Consumed by the next tick.
import { json, clientIp, readBody } from "../lib/http.js";
import { rateLimit } from "../lib/ratelimit.js";
import { db } from "../lib/db.js";
import { TIPS_KEY } from "../lib/state.js";
import { HOLDER_TOKEN, tokenBalance, readSession } from "../lib/holders.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "POST only" });
  if (!HOLDER_TOKEN.mint) return json(res, 403, { error: `Holder chat opens once $${HOLDER_TOKEN.symbol} is live` });
  const body = await readBody(req);
  const address = readSession(body.session);
  if (!address) return json(res, 401, { error: "Connect your wallet again", relogin: true });
  const rl = rateLimit(`tip:${address}`, 4, 10 * 60 * 1000), rlIp = rateLimit(`tip-ip:${clientIp(req)}`, 8, 10 * 60 * 1000);
  if (!rl.ok || !rlIp.ok) return json(res, 429, { error: `Slow down, try again in ${Math.max(rl.retryAfter || 0, rlIp.retryAfter || 0)}s` });
  const text = String(body.text || "").replace(/\s+/g, " ").trim().slice(0, 200);
  if (text.length < 2) return json(res, 400, { error: "Message too short" });
  let held;
  try { held = await tokenBalance(address, HOLDER_TOKEN.mint); } catch (err) { return json(res, 502, { error: `Balance check failed: ${err.message}` }); }
  if (held < HOLDER_TOKEN.minHold) return json(res, 403, { error: `Only $${HOLDER_TOKEN.symbol} holders can message the crew.`, relogin: true });
  const len = await db().llen(TIPS_KEY);
  if (len >= 20) return json(res, 429, { error: "The message box is full, wait for the next conversation" });
  await db().rpush(TIPS_KEY, JSON.stringify({ text, t: Date.now(), from: address, held }));
  return json(res, 200, { ok: true });
}
