// Local owner console. Loads .env / .env.local and talks to the same world the dev server uses.
// Usage: node scripts/admin.mjs <tick|scene-now|desk-now|reset|show>
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
for (const name of [".env", ".env.local"]) {
  const file = path.join(root, name);
  if (!fs.existsSync(file)) continue;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const { runTick, loadWorld } = await import("../lib/engine.js");
const { db, setJSON } = await import("../lib/db.js");
const { WORLD_KEY, TIPS_KEY, VIEWER_KEY } = await import("../lib/state.js");

const cmd = process.argv[2] || "show";
if (cmd === "reset") { await db().del(WORLD_KEY); await db().del(TIPS_KEY); console.log("world reset"); }
else if (cmd === "tick") console.log(await runTick({ force: true }));
else if (cmd === "scene-now" || cmd === "desk-now") {
  const w = await loadWorld();
  await db().set(VIEWER_KEY, String(Date.now()));
  if (w.scene) w.scene.endsAt = 0;
  w.nextSceneAt = 0;
  if (cmd === "desk-now") w.treasury.nextDeskAt = 0;
  await setJSON(WORLD_KEY, w);
  console.log(await runTick({ force: true }));
  if (w.scene) console.log(await runTick({ force: true }));
} else {
  const w = await loadWorld();
  console.log({ tick: w.tickCount, scene: w.scene?.title, stage: w.plan.stage, equity: w.treasury.equitySol, mode: w.treasury.mode, transcript: w.transcript.length });
  console.log(w.transcript.slice(-8).map((e) => `${e.kind} ${e.speaker || ""}: ${e.text}`).join("\n"));
}
process.exit(0);
