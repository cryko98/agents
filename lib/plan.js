// Merge a planUpdate from a scene into the world's coin plan (server side).
import { STAGES } from "../shared/roster.js";

const LIST_KEYS = ["candidates", "tokenomics", "roadmap"];
const TEXT_KEYS = ["theme", "name", "ticker", "tagline", "concept", "logoPrompt", "notes"];

export function applyPlanUpdate(plan, update) {
  if (!update || typeof update !== "object") return [];
  const changed = [];
  for (const k of TEXT_KEYS) {
    const v = update[k];
    if (typeof v === "string" && v.trim() && v.trim() !== plan[k]) {
      plan[k] = v.trim().slice(0, k === "concept" ? 700 : 400);
      changed.push(k);
      if (k === "logoPrompt") { plan.logoUrl = null; plan.logoRetryAt = 0; }
    }
  }
  for (const k of LIST_KEYS) {
    const v = update[k];
    if (Array.isArray(v) && v.length) {
      const clean = v.map((s) => String(s).trim().slice(0, 200)).filter(Boolean).slice(0, 8);
      if (clean.length && JSON.stringify(clean) !== JSON.stringify(plan[k])) { plan[k] = clean; changed.push(k); }
    }
  }
  if (typeof update.stage === "string" && STAGES.includes(update.stage) && STAGES.indexOf(update.stage) > STAGES.indexOf(plan.stage)) {
    plan.stage = update.stage; changed.push("stage");
  }
  if (plan.ticker) plan.ticker = plan.ticker.replace(/[^A-Z0-9]/gi, "").toUpperCase().slice(0, 8) || null;
  if (changed.length) plan.updatedAt = Date.now();
  return changed;
}
