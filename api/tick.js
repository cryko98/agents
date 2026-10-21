// GET|POST /api/tick - advance the world. Visitors call it when the world looks stale;
// an external cron (e.g. cron-job.org every 2 minutes, with ?secret=TICK_SECRET) keeps
// the mission running when nobody is watching.
import { json, paused } from "../lib/http.js";
import { runTick } from "../lib/engine.js";

export default async function handler(req, res) {
  if (paused()) return json(res, 503, { error: "AI is paused" });
  const url = new URL(req.url, "http://x");
  const secret = url.searchParams.get("secret") || req.headers["x-tick-secret"];
  const force = !!process.env.TICK_SECRET && secret === process.env.TICK_SECRET;
  try {
    const result = await runTick({ force });
    return json(res, 200, result);
  } catch (err) {
    console.error(err);
    return json(res, 500, { error: err.message });
  }
}
