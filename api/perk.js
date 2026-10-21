// POST /api/perk - a supporter who sent >= 0.2 SOL asks Pixel for an artwork.
import { json, clientIp, readBody } from "../lib/http.js";
import { rateLimit } from "../lib/ratelimit.js";
import { getJSON, setJSON, acquireLock, releaseLock } from "../lib/db.js";
import { WORLD_KEY, LOCK_KEY } from "../lib/state.js";
import { artworkCredits } from "../lib/donations.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "POST only" });
  const rl = rateLimit(`perk:${clientIp(req)}`, 5, 10 * 60 * 1000);
  if (!rl.ok) return json(res, 429, { error: `Slow down, try again in ${rl.retryAfter}s` });
  const body = await readBody(req);
  const address = String(body.address || "").trim();
  const request = String(body.request || "").replace(/\s+/g, " ").trim().slice(0, 300);
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return json(res, 400, { error: "That doesn't look like a Solana address" });
  if (request.length < 5) return json(res, 400, { error: "Describe the artwork in a few words" });
  if (!(await acquireLock(LOCK_KEY, 20))) return json(res, 503, { error: "The house is busy, try again in a moment" });
  try {
    const world = await getJSON(WORLD_KEY);
    if (!world) return json(res, 503, { error: "World not ready" });
    const credits = artworkCredits(world, address);
    if (credits <= 0) return json(res, 403, { error: "No artwork credit found for this address yet. Send 0.2 SOL to the house wallet first (it can take a minute to show up)." });
    world.perks.pending.push({ id: `pk-${Date.now()}`, by: address, request, t: Date.now() });
    await setJSON(WORLD_KEY, world);
    return json(res, 200, { ok: true, queued: world.perks.pending.length });
  } finally {
    await releaseLock(LOCK_KEY);
  }
}
