// GET /api/coin?ticker=XYZ - the birth record of a coin the crew launched.
// Without ?ticker it lists every launched coin.
import { json } from "../lib/http.js";
import { getJSON } from "../lib/db.js";
import { WORLD_KEY } from "../lib/state.js";
import { coinKey } from "../lib/launch.js";

export default async function handler(req, res) {
  try {
    const url = new URL(req.url, "http://x");
    const ticker = String(url.searchParams.get("ticker") || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);
    const world = await getJSON(WORLD_KEY);
    const launches = (world?.launches || []).filter((l) => l.status === "launched");
    if (!ticker) return json(res, 200, { coins: launches.map(({ name, ticker, mint, url, logoUrl, launchedAt, page }) => ({ name, ticker, mint, url, logoUrl, launchedAt, page })) });
    let rec = await getJSON(coinKey(ticker));
    if (!rec) {
      const l = launches.find((x) => x.ticker === ticker);
      if (l) rec = { ...l, partial: true };
    }
    if (!rec) return json(res, 404, { error: `No coin $${ticker} launched by the crew` });
    rec.index = launches.length - launches.findIndex((x) => x.ticker === ticker);
    rec.creatorFeesSol = world?.treasury?.creatorFeesSol || 0;
    return json(res, 200, rec);
  } catch (err) {
    console.error(err);
    return json(res, 500, { error: err.message });
  }
}
