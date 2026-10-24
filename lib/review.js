// Sage's launch review: the last gate before a coin goes out. A separate Claude call plays a
// ruthless pump.fun trader and looks at what decides whether anyone buys: is the story hot right now,
// would people search exactly this name/ticker, does the logo read at thumbnail size, is somebody
// already ahead on the same narrative (DexScreener), what is pumping right now (Jupiter), and how the
// crew's own last launches went. Below LAUNCH_MIN_SCORE the coin doesn't launch.
import Anthropic from "@anthropic-ai/sdk";
import { trending } from "./market.js";
import { pushTranscript, pushEvent } from "./state.js";
import { emptyPlan } from "../shared/roster.js";

export const MIN_SCORE = Number(process.env.LAUNCH_MIN_SCORE || 7);
const MODEL = process.env.ANTHROPIC_REVIEW_MODEL || process.env.ANTHROPIC_MODEL || "claude-opus-5-5";
const DEX = "https://api.dexscreener.com/latest/dex/search?q=";
const PUMP_DEXES = new Set(["pumpfun", "pumpswap", "meteoradbc", "raydium", "meteora", "orca"]);
const META_TTL = 10 * 60_000;

const usd = (n) => (n == null ? "?" : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(0)}k` : `$${Math.round(n)}`);
const ago = (h) => (h < 1 ? `${Math.round(h * 60)}m` : `${h.toFixed(1)}h`);

/** Solana coins from the last 48h that match the plan's ticker, name or subject. */
export async function competition(plan) {
  const terms = [...new Set([plan.ticker, plan.name, plan.logoSubject].filter(Boolean).map((s) => String(s).trim()).filter((s) => s.length >= 2))].slice(0, 3);
  const seen = new Map();
  for (const q of terms) {
    try {
      const r = await fetch(DEX + encodeURIComponent(q), { signal: AbortSignal.timeout(10_000) });
      const j = await r.json();
      for (const p of j.pairs || []) {
        if (p.chainId !== "solana" || !PUMP_DEXES.has(p.dexId) || !p.pairCreatedAt) continue;
        const ageH = (Date.now() - p.pairCreatedAt) / 3_600_000;
        if (ageH > 48 || seen.has(p.baseToken.address)) continue;
        seen.set(p.baseToken.address, {
          symbol: p.baseToken.symbol, name: p.baseToken.name, dex: p.dexId, ageH,
          mcap: p.marketCap ?? p.fdv ?? null, volH1: p.volume?.h1 ?? null, volH24: p.volume?.h24 ?? null,
          buysH1: p.txns?.h1?.buys ?? null, sameTicker: String(p.baseToken.symbol).toUpperCase() === String(plan.ticker).toUpperCase(),
        });
      }
    } catch { /* DexScreener hiccup: the review goes on without it */ }
  }
  return [...seen.values()].sort((a, b) => (b.volH1 || 0) - (a.volH1 || 0)).slice(0, 12);
}

/** A coin with our exact ticker already took the narrative in the last hours: launching a copy is pointless. */
export function leaderAhead(comp) {
  return comp.find((c) => c.sameTicker && c.ageH < 6 && ((c.volH1 || 0) > 5_000 || (c.mcap || 0) > 30_000)) || null;
}

/** What is pumping right now: new coins (under 48h) from Jupiter's trending lists, cached. */
export async function marketMeta(world) {
  const m = world.marketMeta;
  if (m && Date.now() - m.at < META_TTL) return m.items;
  let items = [];
  try {
    items = (await trending({ interval: "1h", limit: 40 }))
      .filter((t) => t.ageHours != null && t.ageHours <= 48)
      .sort((a, b) => (b.vol24h || 0) - (a.vol24h || 0))
      .slice(0, 12)
      .map((t) => ({ symbol: t.symbol, name: t.name, ageH: t.ageHours, mcap: t.mcap, vol24h: t.vol24h, change1h: t.change1h }));
  } catch { /* keep going without it */ }
  world.marketMeta = { at: Date.now(), items };
  return items;
}

export function metaBlock(items) {
  if (!items?.length) return "";
  return `WHAT IS PUMPING ON SOLANA RIGHT NOW (new coins under 48h, by 24h volume):\n${items.map((t) => `- $${t.symbol} "${t.name}" · ${t.ageH}h old · mcap ${usd(t.mcap)} · vol24h ${usd(t.vol24h)}${t.change1h != null ? ` · 1h ${t.change1h > 0 ? "+" : ""}${Math.round(t.change1h)}%` : ""}`).join("\n")}`;
}

function pastBlock(world) {
  const ls = (world.launches || []).filter((l) => l.status === "launched").slice(0, 10);
  if (!ls.length) return "THE CREW'S PAST LAUNCHES: none yet.";
  const rows = ls.map((l) => {
    const ds = l.devSell || {};
    const out = ds.status !== "sold" ? "still held" : ds.noBuyers ? "NO outside buyers" : ds.pnl > 0 ? `outside buyers, dev buy +${ds.pnl} SOL` : `sold ${ds.pnl ?? "?"} SOL`;
    return `- $${l.ticker} "${l.name}" (story: ${l.source?.title?.slice(0, 80) || "?"}) -> ${out}`;
  });
  return `THE CREW'S PAST LAUNCHES (newest first; learn from them, nobody buying is the usual failure):\n${rows.join("\n")}`;
}

async function logoJpeg(url) {
  try {
    const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(12_000) });
    if (!r.ok) return null;
    const sharp = (await import("sharp")).default;
    return await sharp(Buffer.from(await r.arrayBuffer())).resize(512, 512, { fit: "cover", position: "attention" }).jpeg({ quality: 80 }).toBuffer();
  } catch { return null; }
}

const RULES = `You are Sage, running the pre-launch review for the Cookers: six AI agents who launch memecoins on pump.fun built on news stories. You think like a sharp, ruthless pump.fun trader. Most launches die with zero buyers: your job is to stop weak ones and fix fixable ones.

Score 0-10 on what actually makes strangers buy in the first minutes:
- timing: is this story hot RIGHT NOW (minutes/hours old, spreading) and would people want a coin on it today?
- searchable: is the name/ticker exactly what someone types after seeing the story (the person's name, the viral word, quote or object)? Clever portmanteaus, puns and generic words score low.
- clarity: does the coin explain itself in one glance (name + logo), with the story's key meme element front and center?
- logo: does it read at thumbnail size, show the subject clearly, look like a real photo or a strong meme image (not mush, no garbled text)?
- edge: compared with coins already out on the same narrative (listed below), is the crew early, canonical or clearly better? A late copy of a coin that already runs scores 0-2.
Be honest and calibrated: 7+ only when you'd put your own SOL on it. Never use price predictions in the reason.`;

/** Claude's verdict for the plan. */
async function askClaude({ world, plan, comp, meta, logo }) {
  const story = plan.source ? `STORY: "${plan.source.title}" (${plan.source.feed || plan.source.author || "news"}${plan.source.at ? `, ${ago((Date.now() - plan.source.at) / 3_600_000)} ago` : ""}, radar score ${plan.source.score ?? "?"}/10)` : "STORY: none";
  const compText = comp.length
    ? `COINS ALREADY OUT ON THIS (DexScreener, last 48h):\n${comp.map((c) => `- $${c.symbol} "${c.name}" ${c.sameTicker ? "[SAME TICKER] " : ""}· ${ago(c.ageH)} old · ${c.dex} · mcap ${usd(c.mcap)} · vol1h ${usd(c.volH1)} · buys1h ${c.buysH1 ?? "?"}`).join("\n")}`
    : "COINS ALREADY OUT ON THIS: none found on DexScreener (the crew would be first).";
  const text = `${story}
PLAN: name "${plan.name}", ticker $${plan.ticker}
tagline: ${plan.tagline || "-"}
concept: ${plan.concept || "-"}
logo: ${logo ? "attached" : "could not be loaded"} (${plan.logoSource || "?"}${plan.logoSubject ? `, subject: ${plan.logoSubject}` : ""})
${compText}
${metaBlock(meta) || "WHAT IS PUMPING NOW: unknown"}
${pastBlock(world)}

Return JSON. verdict: "launch" (score >= ${MIN_SCORE} as is), "fix" (a better name/ticker or a new logo would make it a ${MIN_SCORE}+; give the fix and scoreAfterFix), or "skip". fixName/fixTicker: null unless you change them (ticker 3-6 letters A-Z/0-9, the most obvious word). fixLogo: true only if the logo is the problem. line: one short sentence Sage says in the office chat about the decision, in character, no price predictions.`;
  const content = [];
  if (logo) content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: logo.toString("base64") } });
  content.push({ type: "text", text });
  const schema = {
    type: "object", additionalProperties: false,
    required: ["timing", "searchable", "clarity", "logo", "edge", "score", "verdict", "reason", "fixName", "fixTicker", "fixLogo", "scoreAfterFix", "line"],
    properties: {
      timing: { type: "integer" }, searchable: { type: "integer" }, clarity: { type: "integer" }, logo: { type: "integer" }, edge: { type: "integer" },
      score: { type: "integer" }, verdict: { type: "string", enum: ["launch", "fix", "skip"] }, reason: { type: "string" },
      fixName: { type: ["string", "null"] }, fixTicker: { type: ["string", "null"] }, fixLogo: { type: "boolean" }, scoreAfterFix: { type: ["integer", "null"] }, line: { type: "string" },
    },
  };
  const r = await new Anthropic().messages.create({
    model: MODEL, max_tokens: 800, system: RULES,
    messages: [{ role: "user", content }],
    output_config: { effort: "medium", format: { type: "json_schema", schema } },
  });
  if (r.stop_reason === "refusal") throw new Error("review refused");
  return JSON.parse(r.content.filter((b) => b.type === "text").map((b) => b.text).join(""));
}

/** Owner test (admin test-review): the full review of a sample plan, nothing in the world changes. */
export async function dryReview(world, plan) {
  const comp = await competition(plan);
  const meta = await marketMeta({ ...world });
  const logo = plan.logoUrl ? await logoJpeg(plan.logoUrl) : null;
  return { leader: leaderAhead(comp), competitors: comp.length, logoLoaded: !!logo, verdict: await askClaude({ world, plan, comp, meta, logo }) };
}

function drop(world, why, log) {
  const p = world.plan;
  pushTranscript(world, { kind: "system", text: `🗑️ ${p.name} ($${p.ticker}) didn't pass Sage's launch review: ${why}. The crew waits for a stronger story.` });
  pushEvent(world, "review-skip", { ticker: p.ticker, why });
  world.plan = { ...emptyPlan(), id: `plan-${Date.now().toString(36)}` };
  log.push(`review skip: ${why}`);
}

/** Does the launch-ready plan still need (another) review? New logo after a fix -> one more round. */
export function needsReview(p, newsOnly) {
  if (p.stage !== "launch-ready" || p.review?.ok || (newsOnly && !p.logoUrl)) return false;
  if (!p.review || p.review.error) return true;
  return p.review.round < 2 && p.logoUrl && p.review.logo !== p.logoUrl;
}

/**
 * Review a launch-ready plan once its logo is in place. Sets plan.review.ok when it may launch,
 * applies a name/ticker fix, asks Pixel for a new logo (one more round), or drops the plan.
 */
export async function reviewPlan(world, log) {
  const p = world.plan;
  if (!process.env.ANTHROPIC_API_KEY) { p.review = { ok: true, skipped: "no Claude key" }; return; }
  const round = (p.review?.round || 0) + 1;
  const comp = await competition(p);
  const leader = leaderAhead(comp);
  if (leader) return drop(world, `$${leader.symbol} already runs this narrative (${usd(leader.mcap)} mcap, ${ago(leader.ageH)} old), a copy would get no buyers`, log);
  const meta = await marketMeta(world);
  const logo = p.logoUrl ? await logoJpeg(p.logoUrl) : null;
  let v;
  try { v = await askClaude({ world, plan: p, comp, meta, logo }); }
  catch (err) {
    // no review, no launch: retry on the next ticks, give up on the plan after three failures
    pushEvent(world, "review-error", { error: err.message });
    p.review = { round, error: err.message, at: Date.now() };
    if (round >= 3) drop(world, "the review couldn't run", log);
    return;
  }
  const scores = { timing: v.timing, searchable: v.searchable, clarity: v.clarity, logo: v.logo, edge: v.edge };
  p.review = { round, score: v.score, verdict: v.verdict, reason: v.reason.slice(0, 300), scores, competitors: comp.length, logo: p.logoUrl, at: Date.now() };
  const say = (text) => pushTranscript(world, { kind: "line", speaker: "sage", text: text.slice(0, 220), emotion: "thinking" });
  log.push(`review r${round}: ${v.verdict} ${v.score}/10`);

  if (v.verdict === "launch" && v.score >= MIN_SCORE) {
    p.review.ok = true;
    say(v.line);
    pushTranscript(world, { kind: "system", text: `✅ Sage's launch review: ${v.score}/10 for $${p.ticker}. ${v.reason}` });
    return;
  }
  const ticker = String(v.fixTicker || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const canFix = v.verdict === "fix" && round < 2 && (v.scoreAfterFix ?? 0) >= MIN_SCORE;
  if (canFix && (v.fixName || ticker.length >= 3)) {
    const before = `${p.name} ($${p.ticker})`;
    if (v.fixName) p.name = String(v.fixName).slice(0, 32);
    if (ticker.length >= 3 && ticker.length <= 10) p.ticker = ticker;
    say(v.line);
    pushTranscript(world, { kind: "system", text: `✏️ Sage's launch review renamed ${before} to ${p.name} ($${p.ticker}): ${v.reason}` });
  }
  if (canFix && v.fixLogo) {
    // Pixel draws a new, true-to-life picture; the plan gets reviewed again once it's in
    p.logoSource = "generated"; p.logoStyle = "realistic"; p.logoUrl = null; p.logoRetryAt = 0; p.logoChecked = true;
    pushTranscript(world, { kind: "system", text: "📸 Sage wants a stronger picture, so Pixel redraws the logo before launch." });
    return;
  }
  if (canFix) { p.review.ok = true; return; }
  drop(world, `${v.score}/10, ${v.reason}`, log);
}
