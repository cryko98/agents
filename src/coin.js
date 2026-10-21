// The coin plan the agents are building, plus logo generation via /api/logo.
import { emptyPlan, STAGES } from "../shared/roster.js";
import { loadState, saveState } from "./store.js";

export const plan = Object.assign(emptyPlan(), loadState().plan || {});
export const logoState = { inflight: false, error: null, retryAt: 0 };

const listeners = new Set();
export function onPlanChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function notify() { plan.updatedAt = Date.now(); saveState({ plan }); for (const fn of listeners) fn(plan); }

const LIST_KEYS = ["candidates", "tokenomics", "roadmap"];
const TEXT_KEYS = ["theme", "name", "ticker", "tagline", "concept", "logoPrompt", "notes"];

/** Merge a planUpdate from a scene. Returns the list of changed keys. */
export function applyPlanUpdate(update) {
  if (!update || typeof update !== "object") return [];
  const changed = [];
  for (const k of TEXT_KEYS) {
    const v = update[k];
    if (typeof v === "string" && v.trim() && v.trim() !== plan[k]) {
      plan[k] = v.trim();
      changed.push(k);
      if (k === "logoPrompt") { plan.logoUrl = null; logoState.error = null; logoState.retryAt = 0; }
    }
  }
  for (const k of LIST_KEYS) {
    const v = update[k];
    if (Array.isArray(v) && v.length) {
      const clean = v.map((s) => String(s).trim()).filter(Boolean).slice(0, 8);
      if (clean.length && JSON.stringify(clean) !== JSON.stringify(plan[k])) { plan[k] = clean; changed.push(k); }
    }
  }
  if (typeof update.stage === "string" && STAGES.includes(update.stage)) {
    // never move backwards
    if (STAGES.indexOf(update.stage) > STAGES.indexOf(plan.stage)) { plan.stage = update.stage; changed.push("stage"); }
  }
  if (plan.ticker) plan.ticker = plan.ticker.replace(/[^A-Z0-9]/gi, "").toUpperCase().slice(0, 8) || null;
  if (changed.length) notify();
  return changed;
}

export function stageIndex() { return STAGES.indexOf(plan.stage); }

export function needsLogo() {
  return !!plan.logoPrompt && !plan.logoUrl && !logoState.inflight && Date.now() >= logoState.retryAt;
}

/** Ask the server to render the logo with fal.ai. Resolves to the URL or null. */
export async function generateLogo({ force = false } = {}) {
  if (!plan.logoPrompt) return null;
  if (logoState.inflight) return null;
  if (!force && plan.logoUrl) return plan.logoUrl;
  logoState.inflight = true; logoState.error = null; notify();
  try {
    const res = await fetch("/api/logo", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: plan.logoPrompt, name: plan.name, ticker: plan.ticker }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.url) throw new Error(data.error || `logo request failed (${res.status})`);
    plan.logoUrl = data.url;
    logoState.inflight = false;
    notify();
    return data.url;
  } catch (err) {
    logoState.inflight = false;
    logoState.error = err.message || String(err);
    logoState.retryAt = Date.now() + 5 * 60 * 1000;
    notify();
    return null;
  }
}

export function resetPlan() {
  Object.assign(plan, emptyPlan());
  logoState.inflight = false; logoState.error = null; logoState.retryAt = 0;
  notify();
}

export function briefText() {
  const lines = [
    `# ${plan.name || "Untitled coin"}${plan.ticker ? ` ($${plan.ticker})` : ""}`,
    plan.tagline ? `> ${plan.tagline}` : "",
    "",
    `Stage: ${plan.stage}`,
    plan.theme ? `Theme: ${plan.theme}` : "",
    "",
    plan.concept ? `## Concept\n${plan.concept}` : "",
    plan.logoPrompt ? `\n## Logo prompt\n${plan.logoPrompt}` : "",
    plan.logoUrl ? `Logo: ${plan.logoUrl}` : "",
    plan.tokenomics.length ? `\n## Tokenomics\n${plan.tokenomics.map((t) => `- ${t}`).join("\n")}` : "",
    plan.roadmap.length ? `\n## Roadmap\n${plan.roadmap.map((t) => `- ${t}`).join("\n")}` : "",
    plan.notes ? `\n## Notes\n${plan.notes}` : "",
    "",
    "Made in Agent House. Not financial advice. The agents do not hold funds or launch anything themselves.",
  ];
  return lines.filter((l) => l !== "").join("\n");
}
