// POST /api/admin - owner actions, protected by ADMIN_TOKEN (header x-admin-token).
// actions: approve-launch, reject-launch, halt, resume, reset-plan, reset-world, tick
import { json, readBody } from "../lib/http.js";
import { getJSON, setJSON, acquireLock, releaseLock, db } from "../lib/db.js";
import { WORLD_KEY, LOCK_KEY, TIPS_KEY, pushTranscript } from "../lib/state.js";
import { runTick } from "../lib/engine.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "POST only" });
  const token = process.env.ADMIN_TOKEN;
  if (!token) return json(res, 503, { error: "ADMIN_TOKEN not configured" });
  if (req.headers["x-admin-token"] !== token) return json(res, 401, { error: "unauthorized" });
  const body = await readBody(req);
  const action = String(body.action || "");
  if (action === "tick") return json(res, 200, await runTick({ force: true }));
  if (!(await acquireLock(LOCK_KEY, 30))) return json(res, 503, { error: "busy" });
  try {
    if (action === "reset-world") { await db().del(WORLD_KEY); await db().del(TIPS_KEY); return json(res, 200, { ok: true, reset: true }); }
    const world = await getJSON(WORLD_KEY);
    if (!world) return json(res, 404, { error: "no world yet" });
    switch (action) {
      case "approve-launch":
        if (world.launch.status !== "proposed") return json(res, 400, { error: `launch is ${world.launch.status}` });
        world.launch.status = "approved"; world.launch.approvedAt = Date.now();
        pushTranscript(world, { kind: "system", text: "✅ The owner approved the launch. Byte is preparing the transaction." });
        break;
      case "reject-launch":
        world.launch = { status: "none", rejectedAt: Date.now() };
        pushTranscript(world, { kind: "system", text: "The owner sent the launch back to the drawing board." });
        break;
      case "reset-plan": {
        const { emptyPlan } = await import("../shared/roster.js");
        world.plan = emptyPlan();
        world.launch = { status: "none" };
        world.research = null;
        pushTranscript(world, { kind: "system", text: "The coin plan was wiped by the owner. Back to the whiteboard." });
        break;
      }
      case "clean": {
        // drop error chatter from the transcript and let research retry right away
        world.transcript = world.transcript.filter((e) => !(e.kind === "system" && /Claude call failed|Research failed|Desk order rejected|Logo failed/.test(e.text)));
        if (world.research?.failedAt) world.research = null;
        break;
      }
      case "halt":
        world.treasury.halted = { day: "manual", reason: String(body.reason || "Trading paused by the owner.") };
        pushTranscript(world, { kind: "system", text: `🛑 ${world.treasury.halted.reason}` });
        break;
      case "resume":
        world.treasury.halted = null;
        pushTranscript(world, { kind: "system", text: "Trading resumed by the owner." });
        break;
      default:
        return json(res, 400, { error: `unknown action ${action}` });
    }
    world.updatedAt = Date.now();
    await setJSON(WORLD_KEY, world);
    return json(res, 200, { ok: true, launch: world.launch, halted: world.treasury.halted });
  } finally {
    await releaseLock(LOCK_KEY);
  }
}
