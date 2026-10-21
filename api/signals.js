// POST /api/signals - new posts from the X watcher (GitHub Actions + a logged-in headless browser,
// see scripts/x-watch.mjs). Protected by TICK_SECRET. The posts go straight to the news radar,
// which scores them at once; a hot one becomes a flash launch sprint.
import { json, readBody, paused } from "../lib/http.js";
import { setJSON, acquireLock, releaseLock } from "../lib/db.js";
import { WORLD_KEY, LOCK_KEY } from "../lib/state.js";
import { loadWorld } from "../lib/engine.js";
import { ingestPosts } from "../lib/signals.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "POST only" });
  const body = await readBody(req);
  if (!process.env.TICK_SECRET || body?.secret !== process.env.TICK_SECRET) return json(res, 401, { error: "bad secret" });
  if (paused()) return json(res, 503, { error: "AI is paused" });
  // a tick may hold the world for a few seconds: wait for it rather than drop the posts
  let locked = false;
  for (let i = 0; i < 10 && !(locked = await acquireLock(LOCK_KEY, 60)); i++) await new Promise((r) => setTimeout(r, 2500));
  if (!locked) return json(res, 200, { skipped: "locked" });
  try {
    const world = await loadWorld();
    const result = await ingestPosts(world, body.items, body.status);
    await setJSON(WORLD_KEY, world); // updatedAt untouched: it drives the full tick's schedule
    return json(res, 200, result);
  } catch (err) {
    console.error(err);
    return json(res, 500, { error: err.message });
  } finally {
    await releaseLock(LOCK_KEY);
  }
}
