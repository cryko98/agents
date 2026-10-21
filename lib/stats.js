// Derived numbers: the trader leaderboard and the office upgrades.
import { AGENT_IDS, byId } from "../shared/roster.js";
import { UPGRADES } from "../shared/upgrades.js";
import { pushTranscript } from "./state.js";

/** Per-agent results. A sell is credited to whoever opened the position. */
export function leaderboard(world) {
  const t = world.treasury, stats = {}, opener = {};
  for (const id of AGENT_IDS) stats[id] = { id, calls: 0, closed: 0, wins: 0, realizedSol: 0, openPnlSol: 0 };
  for (const tr of [...(t.trades || [])].reverse()) { // oldest first
    if (tr.side === "buy") {
      if (!opener[tr.mint]) opener[tr.mint] = tr.by;
      if (stats[tr.by]) stats[tr.by].calls++;
    } else {
      const s = stats[tr.openedBy || opener[tr.mint] || tr.by];
      if (s) { s.closed++; s.realizedSol += tr.realized || 0; if ((tr.realized || 0) > 0) s.wins++; }
    }
  }
  for (const [mint, p] of Object.entries(t.positions || {})) {
    const s = stats[p.by || opener[mint]];
    if (s) s.openPnlSol += p.pnlSol || 0;
  }
  return Object.values(stats)
    .map((s) => ({ ...s, realizedSol: +s.realizedSol.toFixed(4), openPnlSol: +s.openPnlSol.toFixed(4), totalSol: +(s.realizedSol + s.openPnlSol).toFixed(4) }))
    .sort((a, b) => b.totalSol - a.totalSol || b.calls - a.calls);
}

export function leaderboardLine(world) {
  const rows = leaderboard(world).filter((r) => r.calls || r.closed);
  if (!rows.length) return "TRADER LEADERBOARD: no calls yet.";
  return `TRADER LEADERBOARD (whose calls made money, paper): ${rows.map((r) => `${byId[r.id].name} ${r.totalSol >= 0 ? "+" : ""}${r.totalSol} SOL (${r.calls} calls, ${r.wins}/${r.closed} closed wins)`).join("; ")}`;
}

export function upgradeMetrics(world) {
  const feesSol = world.treasury.creatorFeesSol || 0, donationsSol = world.donations?.totalSol || 0;
  return {
    launched: (world.launches || []).filter((l) => l.status === "launched").length,
    feesSol, donors: (world.donations?.wall || []).length,
    pnlSol: world.treasury.pnlSol || 0, supportSol: +(feesSol + donationsSol).toFixed(6),
  };
}

/** Unlock any upgrade whose milestone is reached. Unlocks are permanent. */
export function updateUpgrades(world) {
  const m = upgradeMetrics(world);
  world.upgradeMetrics = m;
  world.upgrades = world.upgrades || [];
  for (const u of UPGRADES) {
    if (world.upgrades.includes(u.id) || (m[u.metric] || 0) < u.target) continue;
    world.upgrades.push(u.id);
    pushTranscript(world, { kind: "system", text: `🛠️ Office upgrade unlocked: ${u.name} (${u.label.toLowerCase()}). ${u.desc}` });
  }
}

export function upgradesLine(world) {
  const owned = UPGRADES.filter((u) => (world.upgrades || []).includes(u.id)).map((u) => u.name);
  const next = UPGRADES.find((u) => !(world.upgrades || []).includes(u.id));
  return `OFFICE UPGRADES OWNED: ${owned.join(", ") || "none yet"}${next ? `. Next unlock: ${next.name} (${next.label}).` : "."}`;
}
