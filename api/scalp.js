// GET|POST /api/scalp - one fast scalper pass (prices, exits, entries). No LLM calls, so it can
// run every ~30 seconds: the open page pings it and the GitHub Actions loop does when nobody watches.
import { json, paused } from "../lib/http.js";
import { setJSON, acquireLock, releaseLock } from "../lib/db.js";
import { WORLD_KEY, LOCK_KEY } from "../lib/state.js";
import { loadWorld } from "../lib/engine.js";
import { runScalper } from "../lib/scalper.js";
import { scanSignals } from "../lib/signals.js";
import { pushEvent } from "../lib/state.js";

export default async function handler(req, res) {
  if (paused()) return json(res, 503, { error: "AI is paused" });
  if (!(await acquireLock(LOCK_KEY, 60))) return json(res, 200, { skipped: "locked" });
  try {
    const world = await loadWorld();
    const result = await runScalper(world);
    // the news radar rides along (rate-limited inside), so a hot post is caught even between full ticks
    let radar = null;
    try { radar = await scanSignals(world); } catch (err) { pushEvent(world, "signal-error", { error: err.message }); }
    if (result.skipped && (!radar || radar.skipped)) return json(res, 200, result);
    result.radar = radar;
    await setJSON(WORLD_KEY, world); // updatedAt untouched: it drives the full tick's schedule
    return json(res, 200, result);
  } catch (err) {
    console.error(err);
    return json(res, 500, { error: err.message });
  } finally {
    await releaseLock(LOCK_KEY);
  }
}
