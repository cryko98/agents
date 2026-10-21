// GET /api/world - the shared world as the browser sees it. Also marks "someone is watching".
import { json } from "../lib/http.js";
import { db } from "../lib/db.js";
import { loadWorld } from "../lib/engine.js";
import { publicView, VIEWER_KEY } from "../lib/state.js";

export default async function handler(req, res) {
  try {
    const world = await loadWorld();
    await db().set(VIEWER_KEY, String(Date.now()), { ex: 3600 });
    return json(res, 200, publicView(world));
  } catch (err) {
    console.error(err);
    return json(res, 500, { error: err.message });
  }
}
