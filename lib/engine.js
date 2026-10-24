// The tick: advances the shared world by one step. Runs under a Redis lock so only
// one invocation (cron, visitor-triggered or admin) mutates the world at a time.
import { db, getJSON, setJSON, acquireLock, releaseLock } from "./db.js";
import { WORLD_KEY, LOCK_KEY, TIPS_KEY, VIEWER_KEY, TICK_INTERVAL_MS, DESK_INTERVAL_MS, IDLE_AFTER_MS, emptyWorld, pushTranscript, pushEvent, tradingMode } from "./state.js";
import { AGENTS, AGENT_IDS, STAGE_INFO, emptyPlan } from "../shared/roster.js";
import { SEATS, SPOTS, CHAT_SPOTS, isWalkable, randomWalkable } from "../src/world.js";
import { writeScene, writeDesk } from "./scenes.js";
import { applyPlanUpdate } from "./plan.js";
import { markToMarket, validateOrder, executeOrder, eligible, autoExits } from "./trading.js";
import { trending } from "./market.js";
import { scanDonations, artworkCredits } from "./donations.js";
import { proposeLaunch, executeLaunch, collectCreatorFees, archiveLaunch, retryDevSells, launchEnabled, LAUNCH_COOLDOWN_MS } from "./launch.js";
import { scanSignals, takeHotSignal, findSignal, imageFor, NEWS_ONLY } from "./signals.js";
import { checkImage } from "./image.js";
const SPRINT_LEAD_MS = 3 * 60_000; // start the sprint a little before the launch window opens
import { generateImage, generateLogo, logoPrompt, artworkPrompt, falConfigured } from "./logo.js";
import { publicAddress } from "./wallet.js";
import { researchDue, runResearch } from "./research.js";
import { updateUpgrades } from "./stats.js";
import { runScalper } from "./scalper.js";
import { updateAsks, openAsk } from "./backing.js";
import { ensurePlanId, maybeOpenPoll, updatePoll, voteGate } from "./poll.js";

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
      for (const raw of rawTips) {
        try {
          const t = JSON.parse(raw);
          world.pendingTips = [...(world.pendingTips || []), { text: t.text, from: t.from || null, held: t.held || null }].slice(-5);
          pushTranscript(world, { kind: "holder", text: t.text, from: t.from || null, t: t.t });
        } catch { /* ignore */ }
      }
    }

    // 2. finish a scene whose lines have all played
    if (world.scene && now >= world.scene.endsAt) finishScene(world, log);

    // 3. everyday life
    assignActivities(world, now);

    // 4. money
    await markToMarket(world);
    if ((await autoExits(world)).length) await markToMarket(world);
    try { const sr = await runScalper(world); if (sr.log?.length) log.push(...sr.log.map((l) => `scalp ${l}`)); } catch (err) { pushEvent(world, "scalp-error", { error: err.message }); }
    try { const sg = await scanSignals(world, { slow: true }); if (sg.fresh) log.push(`radar: ${sg.fresh} new`); } catch (err) { pushEvent(world, "signal-error", { error: err.message }); }
    await scanDonations(world);
    if (["launched", "simulated"].includes(world.launch.status)) await archiveLaunch(world); // worlds from before multi-launch
    if (world.launch.status === "approved") await executeLaunch(world);
    if (NEWS_ONLY) await newsOnlyPlan(world, log);
    // launch as soon as the crew calls the plan ready (waits briefly for the logo if fal can render it)
    const logoPending = (!NEWS_ONLY || world.plan.logoSource === "generated") && falConfigured() && world.plan.logoPrompt && !world.plan.logoUrl && !world.plan.logoRetryAt;
    // a "launch-ready" plan without the essentials goes back to the whiteboard for another sprint
    if (world.plan.stage === "launch-ready" && (!world.plan.name || !world.plan.ticker || !world.plan.concept)) world.plan.stage = "brainstorm";
    if (world.plan.stage === "launch-ready" && world.launch.status === "none" && !logoPending && proposeLaunch(world) && world.launch.status === "approved") await executeLaunch(world);
    if (world.plan.stage === "launch-ready" && world.launch.status === "none") log.push(`launch waiting: ${logoPending ? "logo" : world.launchWait || "?"}`);
    await collectCreatorFees(world);
    try { await retryDevSells(world); } catch (err) { pushEvent(world, "dev-sell-error", { error: err.message }); }
    try { await updateAsks(world, { live: launchEnabled() }); } catch (err) { pushEvent(world, "ask-error", { error: err.message }); }
    updateUpgrades(world);
    ensurePlanId(world.plan);
    maybeOpenPoll(world);
    await updatePoll(world);

    // 5. images (one per tick, keeps the tick short)
    await maybeRenderImages(world, log);

    // launch sprint: once the next launch window is close, the crew designs a whole coin in one meeting
    const lastLaunchAt = world.launches?.[0]?.launchedAt || 0;
    const windowOpen = world.launch.status === "none" && world.plan.stage !== "launch-ready" && now >= lastLaunchAt + LAUNCH_COOLDOWN_MS - SPRINT_LEAD_MS;
    // a hot post or headline on the radar: flash sprint as soon as the launch window allows
    const flashDue = windowOpen && !!world.signals?.hot;
    // news-only: no research sprints, only flash sprints on a radar story
    const sprintDue = windowOpen && (flashDue || (!NEWS_ONLY && now - (world.lastSprintAt || 0) > 4 * 60_000));

    // 6. research before the crew designs a coin (its own tick: web search takes a while)
    const designing = ["brainstorm", "concept"].includes(world.plan.stage);
    if (!NEWS_ONLY && !world.scene && !flashDue && designing && researchDue(world) && (watched || sprintDue || world.tickCount < 3)) {
      const r = await runResearch(world);
      log.push(r ? `research: ${r.searches} searches, ${r.trends.length} trends` : `research failed: ${world.research?.error}`);
      world.updatedAt = Date.now();
      await setJSON(WORLD_KEY, world);
      return { ok: true, ms: Date.now() - started, log, scene: null, nextTickAt: world.updatedAt + TICK_INTERVAL_MS };
    }

    // 7. a new scene
    if (!world.scene && sprintDue) {
      world.lastSprintAt = now;
      const hot = flashDue ? takeHotSignal(world) : null;
      if (hot) world.plan = { ...emptyPlan(), id: `plan-${now.toString(36)}` }; // the breaking post replaces whatever was on the whiteboard
      await startScene(world, world.pendingTips || [], clock, log, { sprint: true, hot });
    } else if (!world.scene && now >= world.nextSceneAt) {
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

async function startScene(world, tips, clock, log, { sprint = false, hot = null } = {}) {
  const now = Date.now();
  world.sceneCount++;
  const meeting = sprint || world.sceneCount % MEETING_EVERY === 0 || tips.length > 0 || (world.pendingThanks || []).length > 0;
  let participants, spots = {}, location, title, type;
  if (meeting) {
    type = sprint ? "sprint" : "meeting"; participants = AGENT_IDS; location = "the big table in the meeting room";
    const n = (world.launches || []).length + 1;
    title = hot ? `Flash sprint · ${hot.author ? "@" + hot.author : hot.feed} · coin #${n}` : sprint ? `Launch sprint · coin #${n}` : "Team meeting";
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
  const script = await writeScene({ type, participants, location, world, tips, clock, hot });
  if (!script.lines.length) return skipScene(world, script, log, type);
  const startsAt = now + (hot ? 6_000 : meeting ? 22_000 : 15_000);
  const sceneId = `sc-${now}`;
  const { lines, endsAt } = scheduleLines(script.lines, startsAt, sceneId);
  world.scene = { id: sceneId, type, title, location, participants, spots, startsAt, endsAt, lines, source: script.source, planUpdate: script.planUpdate || null, ask: script.ask || null, signal: hot, createdAt: now };
  for (const id of participants) world.agents[id].activity = { kind: "scene", label: "In a conversation", ...spots[id], since: now, until: endsAt };
  pushTranscript(world, { kind: "scene", text: title });
  world.pendingTips = []; world.pendingThanks = [];
  // failures go to events (and the status badge), not into the chat
  if (script.error) pushEvent(world, "scene-fallback", { error: script.error });
  else if (script.source === "claude") pushEvent(world, "claude-ok");
  log.push(`scene ${type} (${script.source})${script.error ? ` fallback: ${script.error}` : ""}`);
}

async function startDesk(world, tips, clock, log) {
  const now = Date.now();
  const t = world.treasury;
  t.lastDeskAt = now; t.nextDeskAt = now + DESK_INTERVAL_MS;
  let candidates = [];
  try { candidates = (await trending({ interval: "1h", limit: 100 })).filter((c) => eligible(c, world)).slice(0, 15); }
  catch (err) { pushEvent(world, "market-error", { error: err.message }); }
  // Nothing to decide (no vetted token, no open position, no tips): no desk session, no API spend.
  const hasWork = candidates.length > 0 || Object.keys(t.positions).length > 0 || tips.length > 0;
  const script = hasWork ? await writeDesk({ world, candidates, tips, clock }) : { lines: [], source: "none" };
  if (!script.lines.length) return skipScene(world, script, log, "desk");
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
  else if (script.source === "claude") pushEvent(world, "claude-ok");
  log.push(`desk (${script.source}), ${candidates.length} candidates, ${(script.orders || []).length} orders`);
}

/** Claude gave no script: nobody talks, everyone keeps working; tips wait for the next scene. */
function skipScene(world, script, log, type) {
  if (script.error) pushEvent(world, "scene-fallback", { error: script.error });
  world.nextSceneAt = Date.now() + rand(...SCENE_GAP);
  log.push(`no ${type} scene (${script.error ? `Claude failed: ${script.error}` : script.source === "none" && type === "desk" ? "nothing to decide" : "no Claude"})`);
}

function finishScene(world, log) {
  const s = world.scene;
  archiveLines(world, s);
  // news-only: only a flash sprint on a radar story may touch the coin plan
  if (s.planUpdate && !(NEWS_ONLY && !s.signal)) {
    const before = world.plan.stage;
    const u = { ...s.planUpdate };
    // holders vote on the candidates first: no final name and no stage past "concept" until the vote closes
    const candidatesAfter = Array.isArray(u.candidates) && u.candidates.length >= 2 ? u.candidates : world.plan.candidates;
    if (voteGate({ ...world, plan: { ...world.plan, candidates: candidatesAfter } })) {
      for (const k of ["name", "ticker", "tagline", "concept", "logoPrompt"]) delete u[k];
      if (u.stage && u.stage !== "concept") u.stage = world.plan.stage === "brainstorm" ? "concept" : null;
    }
    const changed = applyPlanUpdate(world.plan, u);
    attachSource(world, s, u, changed);
    if (s.type === "meeting" || s.type === "sprint") {
      world.plan.story = [...(world.plan.story || []), { t: s.startsAt, stage: before, changed, lines: s.lines.map((l) => ({ speaker: l.speaker, text: l.text })) }].slice(-10);
    }
    if (changed.includes("stage")) pushTranscript(world, { kind: "system", text: `Plan moved from ${STAGE_INFO[before].label} to ${STAGE_INFO[world.plan.stage].label}.` });
    else if (changed.length) pushTranscript(world, { kind: "system", text: `Plan updated: ${changed.join(", ")}.` });
    if ((changed.includes("name") || changed.includes("ticker")) && world.plan.name) pushTranscript(world, { kind: "system", text: `The coin has a name: ${world.plan.name}${world.plan.ticker ? ` ($${world.plan.ticker})` : ""}.` });
  }
  // a funding ask goes up once the crew has talked it through on screen
  if (s.ask) openAsk(world, s.ask, { live: launchEnabled() });
  world.scene = null;
  world.nextSceneAt = Date.now() + rand(...SCENE_GAP);
  for (const id of s.participants) world.agents[id].activity.until = 0;
  log.push(`finished ${s.type}`);
}

/** A coin built on a radar item keeps its source; a found image can become the logo as is. */
function attachSource(world, scene, u, changed) {
  const src = (u.sourceId && (scene.signal?.id === u.sourceId ? scene.signal : findSignal(world, u.sourceId))) || scene.signal;
  if (!src) return;
  const p = world.plan;
  p.source = { id: src.id, title: src.title, author: src.author || null, feed: src.feed, url: src.url || null, image: src.image || null, at: src.at || null, score: src.score ?? null };
  if (world.signals) world.signals.used = [...new Set([...(world.signals.used || []), src.id])].slice(-100);
  // logo: the story's real photo, a photorealistic generated picture, or an illustrated mascot (the crew's call)
  // default: the real photo if the story has one, otherwise a true-to-life generated picture (not a cartoon)
  let style = ["photo", "realistic", "illustration"].includes(u.logoStyle) ? u.logoStyle : (src.image ? "photo" : "realistic");
  // a named photo subject (e.g. "Jon Husted"): look for a real photo of exactly that first, the article's
  // own photo (often the wrong person) is only the fallback
  p.logoSubject = typeof u.logoSubject === "string" && u.logoSubject.trim() ? u.logoSubject.trim().slice(0, 80) : src.subject || null;
  if (style === "photo" && (!src.image || p.logoSubject)) style = "photo-search";
  p.logoStyle = style;
  if (style === "photo") {
    p.logoUrl = src.image; p.logoSource = "web"; p.logoRetryAt = 0;
    changed.push("logo");
    pushTranscript(world, { kind: "system", text: `🖼️ Pixel grabbed the real photo from ${src.author ? "@" + src.author + "'s post" : src.feed} for the logo (cropped to 1:1 at launch).` });
  } else if (style === "photo-search") {
    p.logoUrl = null; p.logoSource = "web";
  } else {
    p.logoUrl = null; p.logoSource = "generated"; p.logoRetryAt = 0;
    pushTranscript(world, { kind: "system", text: style === "realistic" ? "📸 Pixel generates a photorealistic picture for the logo." : "🎨 Pixel draws a mascot logo for this one." });
  }
}

/** News-only mode: the whiteboard only ever holds a coin built on a radar story. Its logo is the
 * story's real photo when one loads; otherwise Pixel draws one that fits the story. */
async function newsOnlyPlan(world, log) {
  const p = world.plan;
  if (world.launch.status !== "none") return;
  const drop = (why) => {
    if (p.name) pushTranscript(world, { kind: "system", text: `🗑️ ${p.name}${p.ticker ? ` ($${p.ticker})` : ""} dropped: ${why}. The crew waits for the next breaking story.` });
    world.plan = { ...emptyPlan(), id: `plan-${Date.now().toString(36)}` };
    log.push(`plan dropped: ${why}`);
  };
  if (!p.source) { if (p.stage !== "brainstorm" || p.name) drop("not built on a news story"); return; }
  if (p.stage !== "launch-ready" || p.logoChecked) return;
  if (p.logoSource === "generated" && p.logoUrl) { p.logoChecked = true; return; }
  // the crew asked for a generated picture: Pixel is on it (maybeRenderImages), the launch waits
  if (p.logoSource === "generated") { if (!falConfigured()) drop("no image generator configured"); return; }
  // a real photo: first one of the named subject, then the story's own; it has to load and convert to 1:1
  if (p.logoSubject && !p.logoUrl) {
    const hit = await imageFor(p.logoSubject).catch(() => null);
    if (hit && await checkImage(hit.image)) { p.logoUrl = hit.image; p.logoSource = "web"; p.logoChecked = true; log.push(`photo of ${p.logoSubject}`); return; }
  }
  const tried = [...new Set([p.logoSource === "web" ? p.logoUrl : null, p.source.image].filter(Boolean))];
  for (const url of tried) if (await checkImage(url)) { p.logoUrl = url; p.logoSource = "web"; p.logoChecked = true; return; }
  const alt = await imageFor(p.source.title, tried).catch(() => null);
  if (alt && await checkImage(alt.image)) { p.logoUrl = alt.image; p.logoSource = "web"; p.logoChecked = true; log.push("photo from Bing News"); return; }
  // no photo anywhere: Pixel generates a true-to-life picture that fits the story, the launch waits for it
  if (falConfigured() && p.logoPrompt) {
    p.logoSource = "generated"; p.logoStyle = "realistic"; p.logoUrl = null; p.logoRetryAt = 0;
    pushTranscript(world, { kind: "system", text: "📸 No usable photo for this story, so Pixel generates a photorealistic one." });
    return;
  }
  drop("no usable photo for the story");
}

// ---------- images ----------
async function maybeRenderImages(world, log) {
  if (!falConfigured()) return;
  const now = Date.now();
  const p = world.plan;
  if ((!NEWS_ONLY || p.logoSource === "generated") && p.logoPrompt && !p.logoUrl && now >= (p.logoRetryAt || 0)) {
    try { p.logoUrl = await generateLogo(logoPrompt(p), { realistic: p.logoStyle === "realistic" }); pushTranscript(world, { kind: "system", text: "🎨 Pixel put the new logo on the big screen." }); log.push(`logo rendered (${p.logoStyle || "illustration"})`); }
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
