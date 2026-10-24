// Holder backing: the crew may ask holders for SOL, but only for something that earns SOL (funding
// launches), and always with an offer the code itself pays out automatically:
//   "share":                 X% of the backed launches' dev-buy profit, split by contribution
//   "principal_plus_share":  the backer's SOL back (minus any loss on those launches) plus X% of the profit
// If the raised SOL never backs a launch, everyone gets their SOL back. One ask at a time.
// While an ask is open, every SOL sent to the crew wallet counts towards it (the site says so).
import { pushTranscript, pushEvent } from "./state.js";
import { sendSol, solBalance, short } from "./wallet.js";
import { byId } from "../shared/roster.js";

const BASE_DEV_BUY = Number(process.env.LAUNCH_DEV_BUY_SOL ?? 0.2);
export const ASK_LIMITS = {
  minSol: 0.05, maxSol: Number(process.env.ASK_MAX_SOL || 3),
  minShare: 5, maxShare: 50, maxLaunches: 5,
  minDevBuy: BASE_DEV_BUY, maxDevBuy: Math.max(BASE_DEV_BUY, Number(process.env.ASK_MAX_DEV_BUY_SOL || 1)),
};
const OPEN_MS = Number(process.env.ASK_OPEN_HOURS || 12) * 3_600_000;     // how long holders can chip in
const BACKING_MS = Number(process.env.ASK_BACKING_HOURS || 72) * 3_600_000; // settle at the latest after this
const COOLDOWN_MS = Number(process.env.ASK_COOLDOWN_HOURS || 2) * 3_600_000; // between two asks
const PAYOUT_MIN = 0.001, RESERVE_SOL = 0.003, PAYOUTS_PER_TX = 10;
const LAUNCH_OVERHEAD_SOL = 0.015; // create cost + headroom on top of the dev buy

const r6 = (n) => Number(Number(n).toFixed(6));
const clamp = (n, a, b) => Math.min(b, Math.max(a, Number.isFinite(Number(n)) ? Number(n) : a));
const str = (s, max) => String(s || "").replace(/\s+/g, " ").trim().slice(0, max);
const agentName = (id) => byId[id]?.name || "The crew";

export function ensureAsks(world) {
  world.asks ||= { current: null, history: [], cooldownUntil: 0 };
  return world.asks;
}

/** What the backer gets, in words the code stands behind. */
export function offerSummary(ask) {
  const n = ask.launches, l = `${n} backed launch${n > 1 ? "es" : ""}`;
  return ask.offer.type === "principal_plus_share"
    ? `your SOL back (minus any loss on the ${l}) plus ${ask.offer.sharePct}% of their dev-buy profit, split by contribution`
    : `${ask.offer.sharePct}% of the dev-buy profit from the ${l}, split by contribution (your SOL funds the launches)`;
}

/** Why the crew can't open an ask right now (null = it can). */
export function askBlocked(world, live) {
  const asks = ensureAsks(world);
  if (!live) return "live launching is off";
  if (asks.current) return `an ask is already ${asks.current.status}`;
  if (Date.now() < (asks.cooldownUntil || 0)) return "cooldown after the last ask";
  return null;
}

/** Called when a scene that proposed an ask has played. Clamps every number to the hard limits. */
export function openAsk(world, p, { live }) {
  const asks = ensureAsks(world);
  if (!p || askBlocked(world, live)) return null;
  const purpose = str(p.purpose, 160), pitch = str(p.pitch, 500);
  if (purpose.length < 8 || pitch.length < 12) return null;
  const now = Date.now();
  const ask = {
    id: `ask-${now.toString(36)}`,
    by: byId[p.by] ? p.by : "nova",
    purpose, pitch, offerText: str(p.offerText, 220),
    amountSol: r6(clamp(p.amountSol, ASK_LIMITS.minSol, ASK_LIMITS.maxSol)),
    launches: Math.round(clamp(p.launches, 1, ASK_LIMITS.maxLaunches)),
    devBuySol: r6(clamp(p.devBuySol ?? BASE_DEV_BUY, ASK_LIMITS.minDevBuy, ASK_LIMITS.maxDevBuy)),
    offer: { type: p.offerType === "principal_plus_share" ? "principal_plus_share" : "share", sharePct: Math.round(clamp(p.sharePct, ASK_LIMITS.minShare, ASK_LIMITS.maxShare)) },
    status: "open", openedAt: now, closesAt: now + OPEN_MS,
    raised: 0, backers: {}, backed: [], launchesLeft: 0,
  };
  asks.current = ask;
  pushTranscript(world, { kind: "system", text: `🤝 ${agentName(ask.by)} asks holders for ${ask.amountSol} SOL: ${ask.purpose}. In return: ${offerSummary(ask)}. Paid out automatically. Tap the request on the site for the details.` });
  pushEvent(world, "ask-opened", { id: ask.id, sol: ask.amountSol });
  return ask;
}

/** An incoming transfer while an ask is open backs it (up to the target). Returns the SOL credited. */
export function creditTransfer(world, d) {
  const ask = world.asks?.current;
  if (!ask || ask.status !== "open" || (d.t && d.t < ask.openedAt)) return 0;
  const sol = Math.min(Math.max(0, ask.amountSol - ask.raised), d.sol);
  if (sol < 0.0005) return 0;
  ask.backers[d.from] = r6((ask.backers[d.from] || 0) + sol);
  ask.raised = r6(ask.raised + sol);
  return r6(sol);
}

/** The ask whose SOL the next launch runs on (bigger dev buy, credited to the backers). */
export function backingAsk(world) {
  const ask = world.asks?.current;
  return ask?.status === "backing" && ask.launchesLeft > 0 ? ask : null;
}

export function launchMinSol(devBuySol) { return LAUNCH_OVERHEAD_SOL + devBuySol; }

/** A backed launch went live. */
export function noteBackedLaunch(world, l) {
  const ask = world.asks?.current;
  if (!ask || ask.id !== l.backedBy) return;
  ask.backed.push({ ticker: l.ticker, mint: l.mint });
  ask.launchesLeft = Math.max(0, ask.launchesLeft - 1);
}

/** Every tick: close the funding window, settle when the backed launches are done, pay out. */
export async function updateAsks(world, { live }) {
  const asks = ensureAsks(world), ask = asks.current;
  if (!ask) return;
  const now = Date.now();
  if (ask.status === "open" && (ask.raised >= ask.amountSol - 1e-6 || now >= ask.closesAt)) {
    if (ask.raised <= 0) return closeAsk(world, ask, "expired", `Nobody backed ${agentName(ask.by)}'s ask (${ask.purpose}). No SOL moved; the crew carries on.`);
    ask.status = "backing"; ask.backingSince = now; ask.backingUntil = now + BACKING_MS; ask.launchesLeft = ask.launches;
    const n = Object.keys(ask.backers).length;
    pushTranscript(world, { kind: "system", text: `🤝 ${ask.raised} SOL from ${n} backer${n > 1 ? "s" : ""} is in. The next ${ask.launches} launch${ask.launches > 1 ? "es run" : " runs"} on it with a ${ask.devBuySol} SOL dev buy; payouts follow automatically.` });
  }
  if (ask.status === "backing") {
    const mine = (world.launches || []).filter((l) => l.backedBy === ask.id);
    const bagsOpen = mine.some((l) => ["holding", "scheduled", "pending"].includes(l.devSell?.status));
    const inFlight = world.launch?.backedBy === ask.id && ["proposed", "approved"].includes(world.launch.status);
    const done = ask.launchesLeft <= 0 && !bagsOpen && !inFlight;
    // without live launching nothing can use the SOL: settle (everyone gets it back)
    if (done || now >= ask.backingUntil || (!live && !mine.length)) settle(ask, mine);
  }
  if (ask.status === "settling") await payOut(world, ask);
}

/** Fix the result and who gets what. Bags still held are counted at their live quote. */
function settle(ask, mine) {
  let pnl = 0;
  for (const l of mine) {
    const ds = l.devSell || {};
    pnl += ds.pnl ?? (ds.value != null && ds.cost != null ? ds.value - ds.cost : 0);
  }
  pnl = r6(pnl);
  const R = ask.raised, s = ask.offer.sharePct / 100;
  let pool;
  if (!mine.length) pool = R; // the SOL never backed a launch: it all goes back
  else if (ask.offer.type === "principal_plus_share") pool = Math.max(0, R + Math.min(0, pnl)) + s * Math.max(0, pnl);
  else pool = s * Math.max(0, pnl);
  ask.result = { launches: mine.length, pnl, pool: r6(pool), refund: !mine.length, at: Date.now() };
  ask.payouts = Object.entries(ask.backers)
    .map(([to, c]) => ({ to, sol: r6((pool * c) / R), status: "due" }))
    .filter((p) => p.sol >= PAYOUT_MIN);
  ask.status = "settling";
}

async function payOut(world, ask) {
  const due = ask.payouts.filter((p) => p.status === "due");
  if (!due.length) {
    const paid = ask.payouts.reduce((s, p) => s + (p.status === "paid" ? p.sol : 0), 0);
    const res = ask.result;
    return closeAsk(world, ask, "settled", paid > 0
      ? `💸 Backers of "${ask.purpose}" were paid ${r6(paid)} SOL across ${ask.payouts.length} wallet${ask.payouts.length > 1 ? "s" : ""}${res.refund ? " (their SOL back: it never backed a launch)" : ` (${res.launches} launch${res.launches > 1 ? "es" : ""}, dev-buy result ${res.pnl >= 0 ? "+" : ""}${res.pnl} SOL)`}.`
      : `The backed launches for "${ask.purpose}" made no dev-buy profit (${res.pnl} SOL), so there is nothing to pay out this time.`);
  }
  let bal;
  try { bal = await solBalance(world.treasury.address); world.treasury.realSol = bal; } catch (err) { pushEvent(world, "payout-error", { error: err.message }); return; }
  const batch = due.slice(0, PAYOUTS_PER_TX);
  const total = batch.reduce((s, p) => s + p.sol, 0);
  if (bal - RESERVE_SOL < total) {
    if (!ask.waitingNoted) { ask.waitingNoted = true; pushTranscript(world, { kind: "system", text: `Backer payouts (${r6(total)} SOL) are waiting for the wallet to free up SOL (a dev buy is still held). They go out automatically.` }); }
    return;
  }
  try {
    const sig = await sendSol(batch);
    for (const p of batch) { p.status = "paid"; p.sig = sig; }
    pushEvent(world, "payout", { id: ask.id, sol: r6(total), sig });
  } catch (err) {
    pushEvent(world, "payout-error", { error: err.message });
  }
}

function closeAsk(world, ask, status, text) {
  const asks = ensureAsks(world);
  ask.status = status; ask.closedAt = Date.now();
  asks.history = [ask, ...(asks.history || [])].slice(0, 12);
  asks.current = null;
  asks.cooldownUntil = Date.now() + COOLDOWN_MS;
  pushTranscript(world, { kind: "system", text });
}

/** What the crew knows about funding, for meetings and sprints. */
export function fundingBlock(world, live) {
  const t = world.treasury, ask = world.asks?.current;
  const wallet = t.realSol != null ? `${Number(t.realSol).toFixed(4)} SOL` : "unknown";
  const lines = [`CREW WALLET (real SOL): ${wallet}. A launch needs about ${launchMinSol(BASE_DEV_BUY).toFixed(3)} SOL up front (the ${BASE_DEV_BUY} SOL dev buy comes back when it is sold). Tips land in this wallet and fund launches.`];
  if (ask) {
    const left = ask.status === "open" ? `, ${Math.max(0, Math.round((ask.closesAt - Date.now()) / 60_000))} min left` : "";
    lines.push(`OPEN BACKING ASK (${ask.status}${left}): ${agentName(ask.by)} asked ${ask.amountSol} SOL for "${ask.purpose}". Raised ${ask.raised} SOL from ${Object.keys(ask.backers).length} backers. Offer: ${offerSummary(ask)}.${ask.status === "backing" ? ` Launches left on it: ${ask.launchesLeft}.` : ""} You may mention it, thank backers, report progress. Do not open another one.`);
    return lines.join("\n");
  }
  const blocked = askBlocked(world, live);
  if (blocked) { lines.push(`BACKING ASK: not possible right now (${blocked}). Set "ask" to null.`); return lines.join("\n"); }
  lines.push(`BACKING ASK: you MAY ask holders for SOL with the "ask" field, but only when it is clearly logical: the money must fund launches that can earn more SOL (e.g. the wallet can't cover the next launch, or a strong story deserves a bigger dev buy). Never ask out of habit, never beg, never ask for SOL "to grow" or for vibes. Size it to the need (launches x (dev buy + ${LAUNCH_OVERHEAD_SOL}) minus what the wallet has), within ${ASK_LIMITS.minSol}-${ASK_LIMITS.maxSol} SOL, 1-${ASK_LIMITS.maxLaunches} launches, dev buy ${ASK_LIMITS.minDevBuy}-${ASK_LIMITS.maxDevBuy} SOL. You must offer something back, and only one of the two built-in offers (the code pays them automatically, nothing else can be promised): "share" = sharePct (${ASK_LIMITS.minShare}-${ASK_LIMITS.maxShare}) % of the backed launches' dev-buy profit, or "principal_plus_share" = backers get their SOL back minus any loss plus sharePct % of the profit. Choose terms that are fair and that the crew can afford; say in the dialogue what it is for, why it should earn, and that backers can lose. No price predictions, no guaranteed profit. Usually "ask" is null.`);
  return lines.join("\n");
}

export { short };
