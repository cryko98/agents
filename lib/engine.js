// The tick: advances the shared world by one step. Runs under a Redis lock so only
// one invocation (cron, visitor-triggered or admin) mutates the world at a time.
import { db, getJSON, setJSON, acquireLock, releaseLock } from "./db.js";
import { WORLD_KEY, LOCK_KEY, TIPS_KEY, VIEWER_KEY, TICK_INTERVAL_MS, DESK_INTERVAL_MS, IDLE_AFTER_MS, emptyWorld, pushTranscript, pushEvent, tradingMode } from "./state.js";
import { AGENTS, AGENT_IDS, STAGE_INFO } from "../shared/roster.js";
import { SEATS, SPOTS, CHAT_SPOTS, isWalkable, randomWalkable } from "../src/world.js";
import { writeScene, writeDesk } from "./scenes.js";
import { applyPlanUpdate } from "./plan.js";
import { markToMarket, validateOrder, executeOrder, eligible } from "./trading.js";
import { trending } from "./market.js";
import { scanDonations, artworkCredits } from "./donations.js";
import { proposeLaunch, executeLaunch, collectCreatorFees } from "./launch.js";
import { generateImage, logoPrompt, artworkPrompt, falConfigured } from "./logo.js";
import { publicAddress } from "./wallet.js";
import { researchDue, runResearch } from "./research.js";
import { offlineScene } from "./offline.js";

const rand = (a, b) => a + Math.random() * (b - a);
const choice = (arr) => arr[Math.floor(Math.random() * arr.length)];
const key = (c, r) => `${c},${r}`;
const LINE_MIN = 2600, LINE_MAX = 7000, LINE_PER_CHAR = 48;
const SCENE_GAP = [40_000, 90_000];
const MEETING_EVERY = 3;

const LABELS = { desk: "Working at their desk", lounge: "Chilling on the couch", kitchen: "Snacking in the kitchen", coffee: "Making coffee", arcade: "Playing arcade", pool: "Shooting pool", beanbag: "Sunk into the beanbag", whiteboard: "Scribbling on the whiteboard", screen: "Staring at the big screen", wander: "Wandering around" };

export async function loadWorld() {
  let world = await getJSON(WORLD_KEY);
  if (!world) { world = emptyWorld(); await setJSON(WORLD_KEY, world); }
  // env-driven fields can change between deploys
  const addr = publicAddress();
  world.treasury.address = addr; world.donations.address = addr;
  world.treasury.mode = tradingMode();
  return world;
}

export async function runTick({ force = false } = {}) {
  if (!(await acquireLock(LOCK_KEY, 110))) return { skipped: "locked" };
  const started = Date.now();
  const log = [];
  try {
    const world = await loadWorld();
    const now = Date.now();
    if (!force && now - world.updatedAt < TICK_INTERVAL_MS - 5000) return { skipped: "fresh", nextTickAt: world.updatedAt + TICK_INTERVAL_MS };
    world.tickCount++;
    const viewerAt = Number(await db().get(VIEWER_KEY)) || 0;
    const watched = now - viewerAt < IDLE_AFTER_MS;
    const clock = new Date().toISOString().slice(11, 16) + " UTC";

    // 1. tips from viewers
    const rawTips = await db().lrange(TIPS_KEY, 0, -1);
    if (rawTips.length) {
      await db().del(TIPS_KEY);
      for (const raw of rawTips) { try { const t = JSON.parse(raw); world.pendingTips = [...(world.pendingTips || []), t.text].slice(-5); pushTranscript(world, { kind: "holder", text: t.text, t: t.t }); } catch { /* ignore */ } }
    }

    // 2. finish a scene whose lines have all played
    if (world.scene && now >= world.scene.endsAt) finishScene(world, log);

    // 3. everyday life
    assignActivities(world, now);

    // 4. money
    await markToMarket(world);
    await scanDonations(world);
    if (world.launch.status === "approved") await executeLaunch(world);
    // launch as soon as the crew calls the plan ready (waits briefly for the logo if fal can render it)
    const logoPending = falConfigured() && world.plan.logoPrompt && !world.plan.logoUrl && !world.plan.logoRetryAt;
    if (world.plan.stage === "launch-ready" && world.launch.status === "none" && !logoPending) proposeLaunch(world);
    await collectCreatorFees(world);

    // 5. images (one per tick, keeps the tick short)
    await maybeRenderImages(world, log);

    // 6. research before the crew designs a coin (its own tick: web search takes a while)
    const designing = ["brainstorm", "concept"].includes(world.plan.stage);
    if (!world.scene && designing && researchDue(world) && (watched || world.tickCount < 3)) {
      const r = await runResearch(world);
      log.push(r ? `research: ${r.searches} searches, ${r.trends.length} trends` : `research failed: ${world.research?.error}`);
      world.updatedAt = Date.now();
      await setJSON(WORLD_KEY, world);
      return { ok: true, ms: Date.now() - started, log, scene: null, nextTickAt: world.updatedAt + TICK_INTERVAL_MS };
    }

    // 7. a new scene
    if (!world.scene && now >= world.nextSceneAt) {
      const tips = world.pendingTips || [];
      if (now >= world.treasury.nextDeskAt) await startDesk(world, tips, clock, log);
      else if (watched || tips.length || world.pendingThanks?.length) await startScene(world, tips, clock, log);
      else { world.nextSceneAt = now + 60_000; log.push("idle: no viewers"); }
    }

    world.updatedAt = Date.now();
    await setJSON(WORLD_KEY, world);
    return { ok: true, ms: Date.now() - started, log, scene: world.scene?.title || null, nextTickAt: world.updatedAt + TICK_INTERVAL_MS };
  } catch (err) {
    console.error("tick failed", err);
    return { error: err.message, log };
  } finally {
    await releaseLock(LOCK_KEY);
  }
}

// ---------- everyday activities ----------
function reservedSpots(world, except) {
  const set = new Set();
  for (const [id, a] of Object.entries(world.agents)) if (id !== except && a.activity) set.add(key(a.activity.c, a.activity.r));
  if (world.scene) for (const s of Object.values(world.scene.spots)) set.add(key(s.c, s.r));
  return set;
}

function assignActivities(world, now) {
  for (const def of AGENTS) {
    const a = world.agents[def.id];
    if (world.scene?.participants.includes(def.id)) continue;
    if (a.activity && now < a.activity.until) continue;
    const taken = reservedSpots(world, def.id);
    const free = (list) => list.filter((s) => !taken.has(key(s.c, s.r)) && isWalkable(s.c, s.r));
    const kinds = ["desk", "lounge", "kitchen", "coffee", "arcade", "pool", "beanbag", "whiteboard", "screen", "wander"];
    const kind = Math.random() < 0.55 ? choice(def.favorites) : choice(kinds);
    let spot = null, sit = false;
    switch (kind) {
      case "desk": spot = SEATS.desk[def.id]; sit = true; break;
      case "lounge": spot = choice(free(SEATS.lounge)); sit = true; break;
      case "kitchen": spot = choice(free(SEATS.kitchen)); sit = true; break;
      case "beanbag": spot = choice(free(SEATS.beanbag)); sit = true; break;
      case "coffee": spot = choice(free(SPOTS.coffee)); break;
      case "arcade": spot = choice(free(SPOTS.arcade)); break;
      case "pool": spot = choice(free(SPOTS.pool)); break;
      case "whiteboard": spot = choice(free(SPOTS.whiteboard)); break;
      case "screen": spot = choice(free(SPOTS.screen)); break;
      default: { const w = randomWalkable(taken); spot = { c: w.c, r: w.r, facing: choice(["se", "sw"]) }; }
    }
    if (!spot) { const w = randomWalkable(taken); spot = { c: w.c, r: w.r, facing: "sw" }; }
    const dur = kind === "wander" ? rand(15_000, 30_000) : rand(50_000, 140_000);
    a.activity = { kind, label: LABELS[kind] || "Hanging out", c: spot.c, r: spot.r, facing: spot.facing, sit, since: now, until: now + dur };
  }
}

// ---------- scenes ----------
function scheduleLines(lines, startsAt, sceneId) {
  let t = startsAt;
  const out = lines.map((l, i) => {
    const dur = Math.max(LINE_MIN, Math.min(LINE_MAX, 1400 + l.text.length * LINE_PER_CHAR));
    const e = { ...l, id: `${sceneId}-${i}`, at: t, until: t + dur };
    t += dur;
    return e;
  });
  return { lines: out, endsAt: t + 1500 };
}

// Lines enter the transcript once the scene has played, with the ids the browser already used.
function archiveLines(world, scene) {
  for (const l of scene.lines) {
    world.transcript.push({ id: l.id, kind: "line", speaker: l.speaker, text: l.text, emotion: l.emotion, t: l.at });
  }
  if (world.transcript.length > 200) world.transcript.splice(0, world.transcript.length - 200);
}

async function startScene(world, tips, clock, log) {
  const now = Date.now();
  world.sceneCount++;
  const meeting = world.sceneCount % MEETING_EVERY === 0 || tips.length > 0 || (world.pendingThanks || []).length > 0;
  let participants, spots = {}, location, title, type;
  if (meeting) {
    type = "meeting"; participants = AGENT_IDS; location = "the big table in the meeting room"; title = "Team meeting";
    participants.forEach((id, i) => { spots[id] = { ...SEATS.meeting[i], sit: true }; });
  } else {
    type = "chat";
    const [a, b] = AGENT_IDS.slice().sort(() => Math.random() - 0.5).slice(0, 2);
    participants = [a, b];
    const taken = reservedSpots(world, null);
    const options = CHAT_SPOTS.filter((cs) => cs.spots.every((s) => !taken.has(key(s.c, s.r))));
    const place = choice(options.length ? options : CHAT_SPOTS);
    location = place.name;
    const na = AGENTS.find((x) => x.id === a).name, nb = AGENTS.find((x) => x.id === b).name;
    title = `${na} & ${nb} at ${place.name}`;
    spots[a] = { ...place.spots[0], sit: !!place.spots[0].sit }; spots[b] = { ...place.spots[1], sit: !!place.spots[1].sit };
  }
  const script = await writeScene({ type, participants, location, world, tips, clock });
  const startsAt = now + (meeting ? 22_000 : 15_000);
  const sceneId = `sc-${now}`;
  const { lines, endsAt } = scheduleLines(script.lines, startsAt, sceneId);
  world.scene = { id: sceneId, type, title, location, participants, spots, startsAt, endsAt, lines, source: script.source, planUpdate: script.planUpdate || null, createdAt: now };
  for (const id of participants) world.agents[id].activity = { kind: "scene", label: "In a conversation", ...spots[id], since: now, until: endsAt };
  pushTranscript(world, { kind: "scene", text: title });
  world.pendingTips = []; world.pendingThanks = [];
  if (script.error) pushEvent(world, "scene-fallback", { error: script.error });
  log.push(`scene ${type} (${script.source})${script.error ? ` fallback: ${script.error}` : ""}`);
}

async function startDesk(world, tips, clock, log) {
  const now = Date.now();
  const t = world.treasury;
  t.lastDeskAt = now; t.nextDeskAt = now + DESK_INTERVAL_MS;
  let candidates = [];
  try { candidates = (await trending({ interval: "1h", limit: 100 })).filter((c) => eligible(c, world)).slice(0, 12); }
  catch (err) { pushEvent(world, "market-error", { error: err.message }); }
  // Nothing to decide (no vetted token, no open position, no tips): a short canned hold, no API spend.
  const hasWork = candidates.length > 0 || Object.keys(t.positions).length > 0 || tips.length > 0;
  const script = hasWork ? await writeDesk({ world, candidates, tips, clock }) : offlineScene({ type: "desk", participants: AGENT_IDS, plan: world.plan, tips });
  const participants = AGENT_IDS;
  const spots = {}; participants.forEach((id, i) => { spots[id] = { ...SEATS.meeting[i], sit: true }; });
  const startsAt = now + 22_000;
  const sceneId = `sc-${now}`;
  const { lines, endsAt } = scheduleLines(script.lines, startsAt, sceneId);
  world.scene = { id: sceneId, type: "desk", title: "Trading desk", location: "the big table", participants, spots, startsAt, endsAt, lines, source: script.source, createdAt: now };
  for (const id of participants) world.agents[id].activity = { kind: "scene", label: "At the trading desk", ...spots[id], since: now, until: endsAt };
  pushTranscript(world, { kind: "scene", text: "Trading desk" });
  if (script.thesis) t.thesis = script.thesis;
  world.pendingTips = []; world.pendingThanks = [];
  // execute orders now; the dialogue explains them as it plays
  for (const order of script.orders || []) {
    const check = validateOrder(order, world, candidates);
    if (!check.ok) { pushTranscript(world, { kind: "system", text: `Desk order rejected (${order.side} ${order.symbol || order.mint?.slice(0, 6)}): ${check.reason}` }); continue; }
    try {
      const trade = await executeOrder(order, check, world);
      const txt = trade.side === "buy" ? `📈 ${t.mode === "paper" ? "Paper" : "Live"} buy: ${trade.sol} SOL → ${trade.symbol}. ${trade.reason}` : `📉 ${t.mode === "paper" ? "Paper" : "Live"} sell: ${trade.symbol} → ${trade.sol} SOL (${trade.realized >= 0 ? "+" : ""}${trade.realized} SOL). ${trade.reason}`;
      pushTranscript(world, { kind: "system", text: txt });
      log.push(txt);
    } catch (err) {
      pushTranscript(world, { kind: "system", text: `Desk order failed (${order.side} ${order.symbol}): ${err.message}` });
      pushEvent(world, "trade-error", { error: err.message });
    }
  }
  await markToMarket(world);
  if (script.error) pushEvent(world, "scene-fallback", { error: script.error });
  log.push(`desk (${script.source}), ${candidates.length} candidates, ${(script.orders || []).length} orders`);
}

function finishScene(world, log) {
  const s = world.scene;
  archiveLines(world, s);
  if (s.planUpdate) {
    const before = world.plan.stage;
    const changed = applyPlanUpdate(world.plan, s.planUpdate);
    if (changed.includes("stage")) pushTranscript(world, { kind: "system", text: `Plan moved from ${STAGE_INFO[before].label} to ${STAGE_INFO[world.plan.stage].label}.` });
    else if (changed.length) pushTranscript(world, { kind: "system", text: `Plan updated: ${changed.join(", ")}.` });
    if ((changed.includes("name") || changed.includes("ticker")) && world.plan.name) pushTranscript(world, { kind: "system", text: `The coin has a name: ${world.plan.name}${world.plan.ticker ? ` ($${world.plan.ticker})` : ""}.` });
  }
  world.scene = null;
  world.nextSceneAt = Date.now() + rand(...SCENE_GAP);
  for (const id of s.participants) world.agents[id].activity.until = 0;
  log.push(`finished ${s.type}`);
}

// ---------- images ----------
async function maybeRenderImages(world, log) {
  if (!falConfigured()) return;
  const now = Date.now();
  const p = world.plan;
  if (p.logoPrompt && !p.logoUrl && now >= (p.logoRetryAt || 0)) {
    try { p.logoUrl = await generateImage(logoPrompt(p)); pushTranscript(world, { kind: "system", text: "🎨 Pixel put the new logo on the big screen." }); log.push("logo rendered"); }
    catch (err) { p.logoRetryAt = now + 10 * 60_000; pushEvent(world, "logo-error", { error: err.message }); }
    return;
  }
  const req = world.perks.pending[0];
  if (req) {
    world.perks.pending.shift();
    try {
      const url = await generateImage(artworkPrompt(req.request));
      world.perks.gallery.unshift({ id: req.id, by: req.by, request: req.request, url, t: now });
      world.perks.gallery.splice(30);
      pushTranscript(world, { kind: "system", text: `🖼️ Pixel finished an artwork for ${req.by.slice(0, 4)}…${req.by.slice(-4)}: "${req.request.slice(0, 60)}"` });
      log.push("artwork rendered");
    } catch (err) { pushEvent(world, "artwork-error", { error: err.message, by: req.by }); }
  }
}

export { artworkCredits };
