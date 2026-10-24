// The public track record: every coin the crew ever launched and how its dev buy ended. world.launches
// only keeps the last 30, so each tick copies their summaries into a separate, permanent key.
import { getJSON, setJSON } from "./db.js";

export const RECORD_KEY = "ah:record";

function summary(l) {
  const ds = l.devSell || {};
  const pnl = ds.pnl ?? (ds.value != null && ds.cost != null ? Number((ds.value - ds.cost).toFixed(5)) : null);
  return {
    ticker: l.ticker, name: l.name, mint: l.mint, url: l.url, page: l.page || null, logoUrl: l.logoUrl || null,
    launchedAt: l.launchedAt, signature: l.signature || null, devBuySol: l.devBuySol || 0, backedBy: l.backedBy || null,
    source: l.source ? { author: l.source.author || null, title: l.source.title || null, url: l.source.url || null } : null,
    dev: { status: ds.status || "none", cost: ds.cost ?? null, solBack: ds.solBack ?? null, pnl, final: ds.status === "sold", sig: ds.sig || null, at: ds.at || null, noBuyers: !!ds.noBuyers },
  };
}

/** Every tick: upsert the recent launches into the permanent record (writes only when something changed). */
export async function syncRecord(world) {
  const launched = (world.launches || []).filter((l) => l.status === "launched" && l.mint);
  const rec = (await getJSON(RECORD_KEY)) || { coins: {} };
  let changed = false;
  for (const l of launched) {
    const s = summary(l), old = rec.coins[l.mint];
    if (!old || JSON.stringify(old) !== JSON.stringify(s)) { rec.coins[l.mint] = s; changed = true; }
  }
  const fees = { claimed: world.treasury.creatorFeesSol || 0, pending: world.treasury.pendingCreatorFeesSol || 0 };
  if (JSON.stringify(rec.fees) !== JSON.stringify(fees)) { rec.fees = fees; changed = true; }
  if (changed) { rec.updatedAt = Date.now(); await setJSON(RECORD_KEY, rec); }
}

/** The page's data: coins oldest first, plus totals the page doesn't have to trust itself to add up. */
export async function trackRecord(world) {
  const rec = (await getJSON(RECORD_KEY)) || { coins: {} };
  const coins = Object.values(rec.coins).sort((a, b) => a.launchedAt - b.launchedAt);
  const settled = coins.filter((c) => c.dev.final && c.dev.pnl != null);
  const sum = (arr, f) => Number(arr.reduce((s, c) => s + (f(c) || 0), 0).toFixed(5));
  const asks = [...(world?.asks?.current ? [world.asks.current] : []), ...(world?.asks?.history || [])];
  return {
    updatedAt: rec.updatedAt || null,
    wallet: world?.treasury?.address || null,
    coins,
    totals: {
      launched: coins.length,
      settled: settled.length,
      held: coins.filter((c) => ["holding", "pending", "scheduled"].includes(c.dev.status)).length,
      wins: settled.filter((c) => c.dev.pnl > 0).length,
      noBuyers: settled.filter((c) => c.dev.noBuyers).length,
      devBuyIn: sum(settled, (c) => c.dev.cost ?? c.devBuySol),
      devPnl: sum(settled, (c) => c.dev.pnl),
      openPnl: sum(coins.filter((c) => !c.dev.final), (c) => c.dev.pnl),
    },
    fees: rec.fees || { claimed: world?.treasury?.creatorFeesSol || 0, pending: world?.treasury?.pendingCreatorFeesSol || 0 },
    backing: {
      asks: asks.length,
      raised: sum(asks, (k) => k.raised),
      paidOut: sum(asks, (k) => (k.payouts || []).filter((p) => p.status === "paid").reduce((s, p) => s + p.sol, 0)),
    },
    trading: world?.treasury ? { mode: world.treasury.mode, pnlSol: world.treasury.pnlSol, pnlPct: world.treasury.pnlPct } : null,
  };
}
