// Dialogue: transcript store, holder tips, the /api/scene client and an offline fallback.
import { API_MIN_INTERVAL, TRANSCRIPT_LIMIT } from "./config.js";
import { AGENTS, byId, STAGES, STAGE_INFO } from "../shared/roster.js";
import { loadState, saveState } from "./store.js";

export const transcript = loadState().transcript || [];
export const tips = (loadState().tips || []).filter((t) => !t.consumed).slice(-5);
export const aiState = { checked: false, claude: false, fal: false, paused: false, model: null, lastError: null, busy: false };

const lineListeners = new Set();
export function onLine(fn) { lineListeners.add(fn); return () => lineListeners.delete(fn); }

export function addEntry(entry) {
  const e = { t: Date.now(), ...entry };
  transcript.push(e);
  if (transcript.length > TRANSCRIPT_LIMIT) transcript.splice(0, transcript.length - TRANSCRIPT_LIMIT);
  saveState({ transcript });
  for (const fn of lineListeners) fn(e);
  return e;
}

export function addTip(text) {
  const clean = String(text).replace(/\s+/g, " ").trim().slice(0, 200);
  if (!clean) return null;
  const tip = { text: clean, t: Date.now(), consumed: false };
  tips.push(tip);
  while (tips.length > 5) tips.shift();
  saveState({ tips });
  addEntry({ kind: "holder", text: clean });
  return tip;
}
export function pendingTips() { return tips.filter((t) => !t.consumed); }
export function consumeTips(list) { for (const t of list) t.consumed = true; saveState({ tips }); }

export async function checkHealth() {
  try {
    const res = await fetch("/api/health");
    const data = await res.json();
    Object.assign(aiState, { checked: true, claude: !!data.claude, fal: !!data.fal, paused: !!data.paused, model: data.model || null });
  } catch {
    Object.assign(aiState, { checked: true, claude: false, fal: false, paused: false });
  }
  return aiState;
}

let lastApiCall = 0;

/**
 * Get a dialogue script for a scene. Falls back to offline lines when the API is
 * unavailable, paused or rate-limited. ctx: { type, participants(ids), location, plan, clock }
 */
export async function requestScene(ctx) {
  const tipList = pendingTips();
  const recent = transcript.filter((e) => e.kind === "line").slice(-24).map((e) => ({ speaker: e.speaker, text: e.text }));
  const now = Date.now();
  const canCall = aiState.claude && !aiState.paused && now - lastApiCall >= API_MIN_INTERVAL;
  if (canCall) {
    lastApiCall = now;
    aiState.busy = true;
    try {
      const res = await fetch("/api/scene", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: ctx.type, participants: ctx.participants, location: ctx.location,
          plan: ctx.plan, transcript: recent, tips: tipList.map((t) => t.text), clock: ctx.clock,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `scene request failed (${res.status})`);
      if (!Array.isArray(data.lines) || !data.lines.length) throw new Error("empty script");
      aiState.lastError = null;
      aiState.busy = false;
      consumeTips(tipList);
      return { lines: sanitizeLines(data.lines, ctx.participants), planUpdate: data.planUpdate || null, source: "claude" };
    } catch (err) {
      aiState.busy = false;
      aiState.lastError = err.message || String(err);
      console.warn("[scene] falling back to offline lines:", aiState.lastError);
    }
  }
  const off = offlineScene(ctx, tipList);
  consumeTips(tipList);
  return off;
}

function sanitizeLines(lines, participants) {
  const allowed = new Set(participants);
  return lines
    .filter((l) => l && allowed.has(l.speaker) && typeof l.text === "string" && l.text.trim())
    .map((l) => ({ speaker: l.speaker, text: l.text.trim().slice(0, 220), emotion: l.emotion || "neutral" }))
    .slice(0, 14);
}

// ---------------- Offline fallback ----------------
// Keeps the house alive with canned, in-character lines when no API key is configured.

const CHAT_LINES = {
  nova: ["Okay but imagine the billboard. Picture it.", "We're not building a coin, we're building a moment.", "Small ideas die quietly. Let's not.", "I had another idea at 3am. You'll love it. Probably.", "Every great coin starts with someone saying something dumb out loud."],
  byte: ["How exactly? Walk me through it.", "Mint authority gets revoked on day one or I'm not shipping.", "That's a vibe, not a spec.", "Fine. But I'm writing tests.", "I've seen that pattern rug before. Twice."],
  pixel: ["It needs more glow. Trust me.", "What if the mascot had tiny sunglasses? Hear me out.", "The gradient is wrong and it's keeping me up at night.", "I already drew three versions in my head.", "Pink and teal. Don't argue with me."],
  max: ["SEND IT. We cook today.", "Chart's gonna look like a hockey stick, ser.", "Liquidity first, feelings second.", "I've been awake for 36 hours and I feel amazing.", "That's a top signal. I'm in."],
  sage: ["Who is this actually for? Let's start there.", "Let's make a decision we won't regret in a week.", "Community first. The chart follows.", "I love it. I also have three concerns.", "Max, breathe."],
  juno: ["this is going on the timeline", "ok but what's the SOUND. every coin needs a sound", "i could cut a video of this in four minutes", "lowercase energy only. it's the brand", "we're so back (we were never gone)"],
};

const TIP_REACTIONS = {
  nova: (tip) => `A holder says "${tip}". Honestly? Bold. I respect it.`,
  byte: (tip) => `Someone suggested "${tip}". Define it and I'll tell you if it ships.`,
  pixel: (tip) => `"${tip}"... ooh, I can see the colors already.`,
  max: (tip) => `HOLDER TIP: "${tip}". Chat is cooking today.`,
  sage: (tip) => `A holder suggested "${tip}". Let's actually consider it.`,
  juno: (tip) => `"${tip}" is a meme format waiting to happen.`,
};

// A canned coin the offline house builds, one stage per meeting.
const OFFLINE_PLAN = {
  theme: "a tiny glowing cat who refuses to sleep until the chart is green",
  candidates: ["Glowcat ($GLOW)", "Moonloaf ($LOAF)", "Nightshift ($SHIFT)"],
  name: "Glowcat",
  ticker: "GLOW",
  tagline: "Never sleeps. Always glows.",
  concept: "Glowcat is a small neon cat that lives in the office server rack and only glows when the community is awake. The mascot for everyone who checks the chart at 4am and tells themselves it's the last time.",
  logoPrompt: "cute pixel-art neon cat face, teal and hot pink glow, round eyes, tiny sunglasses pushed up on its head, memecoin logo, centered, clean dark background, bold shapes, no text",
  tokenomics: ["Fair launch on a Solana launchpad, no presale, no team allocation", "1,000,000,000 supply, mint authority revoked at launch", "Liquidity burned at graduation", "No taxes, no hidden fees", "Treasury funded only by community votes"],
  roadmap: ["Launch day: 24-hour 'stay awake' stream with the mascot", "Week 1: meme contest judged by Pixel", "Week 2: Glowcat sticker pack and TikTok sounds", "Month 1: community vote on the first charity cat shelter donation"],
};

const MEETING_SCRIPTS = {
  brainstorm: [
    ["nova", "Okay, team. Brainstorm. No idea is too dumb. Go."],
    ["juno", "a cat. but it glows. and it never sleeps. like max"],
    ["max", "I'm honored. And I'm in."],
    ["pixel", "Ooh. Neon teal cat with pink glow. I can SEE it."],
    ["byte", "A cat coin. Original. But fine, cats work."],
    ["sage", "Three candidates on the board: Glowcat, Moonloaf, Nightshift. We pick next time."],
  ],
  concept: [
    ["sage", "Decision time. Glowcat, Moonloaf or Nightshift?"],
    ["max", "GLOW. Ticker's clean, four letters, sends itself."],
    ["pixel", "Glowcat. The others don't have a face yet."],
    ["juno", "'never sleeps. always glows.' that's the tagline. i'm not taking notes, i'm just right"],
    ["byte", "Glowcat. $GLOW. Fine. Lock it."],
    ["nova", "Locked. Glowcat lives in the server rack and glows when we're awake. That's the story."],
  ],
  branding: [
    ["pixel", "Logo time. Pixel cat face, teal and hot pink, round eyes, tiny sunglasses on its head."],
    ["max", "Sunglasses. Respect."],
    ["nova", "Make it glow like it owes us money."],
    ["byte", "Clean background. No text. Text always renders wrong."],
    ["juno", "it needs to work as a 32px emoji or it's cooked"],
    ["pixel", "Clean dark background, bold shapes, centered. I'm rendering it now."],
  ],
  tokenomics: [
    ["byte", "Tokenomics. Fair launch, no presale, no team allocation. Non-negotiable."],
    ["max", "One billion supply, LP burned at graduation. Classic. Clean."],
    ["sage", "No taxes. And a treasury the community actually votes on."],
    ["nova", "Mint revoked day one. Say it so people hear it."],
    ["byte", "Mint revoked day one."],
    ["juno", "launch day 24h 'stay awake' stream. the cat watches you. you watch the cat"],
  ],
  "launch-ready": [
    ["nova", "We're launch-ready. Now we make noise."],
    ["juno", "meme contest week one. pixel judges. i already have four entries"],
    ["sage", "Month one: community vote on a cat shelter donation. Glowcat gives back."],
    ["max", "I'm making the launch chart my wallpaper before it exists."],
    ["byte", "Launch checklist is green. Don't touch anything."],
    ["pixel", "The sticker pack is drawn. The sunglasses stay."],
  ],
};

const EMOTIONS = ["neutral", "happy", "excited", "thinking", "laughing"];
const used = new Map();
function pick(id) {
  const pool = CHAT_LINES[id];
  const seen = used.get(id) || [];
  let candidates = pool.filter((l) => !seen.includes(l));
  if (!candidates.length) { used.set(id, []); candidates = pool; }
  const line = candidates[Math.floor(Math.random() * candidates.length)];
  used.set(id, [...(used.get(id) || []), line].slice(-3));
  return line;
}

export function offlineScene(ctx, tipList = []) {
  const lines = [];
  const emo = () => EMOTIONS[Math.floor(Math.random() * EMOTIONS.length)];
  if (ctx.type === "meeting") {
    const stage = ctx.plan?.stage || "brainstorm";
    for (const [speaker, text] of MEETING_SCRIPTS[stage] || MEETING_SCRIPTS["launch-ready"]) lines.push({ speaker, text, emotion: emo() });
    if (tipList.length) lines.splice(2, 0, { speaker: "sage", text: TIP_REACTIONS.sage(tipList[0].text), emotion: "thinking" });
    const idx = STAGES.indexOf(stage);
    const next = STAGES[Math.min(idx + 1, STAGES.length - 1)];
    const planUpdate = {};
    if (stage === "brainstorm") Object.assign(planUpdate, { theme: OFFLINE_PLAN.theme, candidates: OFFLINE_PLAN.candidates, stage: "concept" });
    else if (stage === "concept") Object.assign(planUpdate, { name: OFFLINE_PLAN.name, ticker: OFFLINE_PLAN.ticker, tagline: OFFLINE_PLAN.tagline, concept: OFFLINE_PLAN.concept, stage: "branding" });
    else if (stage === "branding") Object.assign(planUpdate, { logoPrompt: OFFLINE_PLAN.logoPrompt, stage: "tokenomics" });
    else if (stage === "tokenomics") Object.assign(planUpdate, { tokenomics: OFFLINE_PLAN.tokenomics, roadmap: OFFLINE_PLAN.roadmap.slice(0, 2), stage: next });
    else Object.assign(planUpdate, { roadmap: OFFLINE_PLAN.roadmap });
    return { lines, planUpdate, source: "offline" };
  }
  const [a, b] = ctx.participants;
  const order = [a, b, a, b];
  if (tipList.length) {
    lines.push({ speaker: a, text: TIP_REACTIONS[a](tipList[0].text), emotion: "thinking" });
    lines.push({ speaker: b, text: pick(b), emotion: emo() });
  }
  for (const id of order) lines.push({ speaker: id, text: pick(id), emotion: emo() });
  return { lines: lines.slice(0, 5), planUpdate: null, source: "offline" };
}

export function stageGoal(stage) { return STAGE_INFO[stage]?.goal || ""; }
export { AGENTS, byId };
