// The scalper: rule-based fast trading, no LLM in the loop, runs every ~15 seconds.
// Positions it opens are tagged strategy "scalp" (with a setup) and only this module closes them.
//
// Setup "migration" (main): coins that graduated from a launchpad (pump.fun etc.) in the last
//   few hours and are pulling real 5-minute volume right now. These move 10-50% in minutes.
//   Bigger size; take half at +10%, the rest rides a trailing stop, everything out at +20%.
// Setup "breakout" (secondary): established high-volume tokens with a strong 5m move.
//
// Lessons from the first version: +1-3% moves cannot beat ~2% round-trip costs, and slow
// time stops just bleed fees. So entries now need bigger, faster moves.
import { fastMovers, SOL_MINT } from "./market.js";
import { executeOrder, markToMarket, RULES } from "./trading.js";
import { dayKey, pushTranscript, pushEvent } from "./state.js";

const num = (k, d) => Number(process.env[k] || d);

export const SCALP = {
  enabled: process.env.SCALPER !== "0",
  runEveryMs: num("SCALP_RUN_MS", 12_000),
  scanEveryMs: num("SCALP_SCAN_MS", 40_000),
  maxOpen: num("SCALP_MAX_OPEN", 5),
  maxPerDay: num("SCALP_MAX_PER_DAY", 80),
  cooldownMs: num("SCALP_COOLDOWN_MIN", 180) * 60_000,
};

export const SETUPS = {
  migration: {
    label: "fresh migration",
    size: num("MIG_SIZE", 0.15),                 // of equity
    maxOpen: num("MIG_MAX_OPEN", 4),
    maxAgeMin: num("MIG_MAX_AGE_MIN", 240),      // graduated within the last 4 hours
    minLiq: num("MIG_MIN_LIQ", 25_000),
    minVol5m: num("MIG_MIN_VOL_5M", 40_000),
    minHolders: num("MIG_MIN_HOLDERS", 250),
    maxTopHolders: num("MIG_MAX_TOP_HOLDERS", 40),
    minOrganic: num("MIG_MIN_ORGANIC", 10),
    min5m: num("MIG_MIN_5M", 3), max5m: num("MIG_MAX_5M", 60),
    minRatio: num("MIG_MIN_RATIO", 1.1),
    stop: num("MIG_STOP", -10), half: num("MIG_HALF", 10), take: num("MIG_TAKE", 20),
    trailArm: num("MIG_TRAIL_ARM", 10), trail: num("MIG_TRAIL", 5),
    timeMin: num("MIG_TIME_MIN", 12), timeGain: num("MIG_TIME_GAIN", 3),
    paperFee: 0.015,                             // fresh pools slip more than majors
  },
  breakout: {
    label: "breakout",
    size: num("BRK_SIZE", 0.10),
    maxOpen: num("BRK_MAX_OPEN", 2),
    minLiq: num("BRK_MIN_LIQ", 75_000),
    minVol5m: num("BRK_MIN_VOL_5M", 60_000),
    minMcap: 100_000, maxMcap: num("BRK_MAX_MCAP", 200_000_000),
    minOrganic: num("BRK_MIN_ORGANIC", 35),
    min5m: num("BRK_MIN_5M", 4), max5m: num("BRK_MAX_5M", 25),
    minRatio: num("BRK_MIN_RATIO", 1.4),
    stop: num("BRK_STOP", -6), half: num("BRK_HALF", 8), take: num("BRK_TAKE", 15),
    trailArm: num("BRK_TRAIL_ARM", 8), trail: num("BRK_TRAIL", 4),
    timeMin: num("BRK_TIME_MIN", 10), timeGain: num("BRK_TIME_GAIN", 2),
    paperFee: 0.01,
  },
};

export function scalpRulesText() {
  const m = SETUPS.migration, b = SETUPS.breakout;
  return `Scalper (automatic, every ~15s). Main setup "fresh migration": coins that graduated from pump.fun/other launchpads in the last ${m.maxAgeMin / 60}h, ≥ $${m.minVol5m / 1000}k 5m volume, 5m +${m.min5m}% to +${m.max5m}%, buyers ≥ ${m.minRatio}× sellers; ${Math.round(m.size * 100)}% of equity per trade; sells half at +${m.half}%, everything at +${m.take}%, trailing ${m.trail} pts once +${m.trailArm}%, stop ${m.stop}%, out after ${m.timeMin} min if under +${m.timeGain}%. Second setup "breakout" on established high-volume coins with a 5m move of +${b.min5m}% or more (smaller size, take +${b.take}%).`;
}

const ratioOf = (t) => (t.sellVol5m > 0 ? t.buyVol5m / t.sellVol5m : t.buyVol5m > 0 ? 9 : 0);
const vol5mOf = (t) => (t.buyVol5m || 0) + (t.sellVol5m || 0);
const BLOCK_TAGS = ["stocks", "xstocks", "equities", "rwa", "lst", "stable", "stablecoin"];

function baseOk(t, world) {
  const own = new Set((world.launches || []).map((l) => l.mint).concat(world.launch?.mint || []));
  if (!t || own.has(t.mint) || t.mint === SOL_MINT || t.sus || !t.usdPrice) return false;
  if (t.mintDisabled === false || t.freezeDisabled === false) return false;
  if ((t.tags || []).some((g) => BLOCK_TAGS.includes(g))) return false;
  if (/^(cb|w)(BTC|ETH|NEAR|SOL)$|^(USDC|USDT|PYUSD|USDS|USDe)$/i.test(t.symbol || "")) return false;
  return (t.netBuyers5m ?? 0) > 0 && t.change5m != null;
}

/** Which setup (if any) a token qualifies for right now. */
export function classify(t, world, now = Date.now()) {
  if (!baseOk(t, world)) return null;
  const m = SETUPS.migration;
  const gradMin = t.graduatedAt ? (now - t.graduatedAt) / 60_000 : null;
  if (gradMin != null && gradMin >= 0 && gradMin <= m.maxAgeMin
    && (t.liquidity || 0) >= m.minLiq && vol5mOf(t) >= m.minVol5m
    && (t.holders ?? 0) >= m.minHolders && (t.topHoldersPct == null || t.topHoldersPct <= m.maxTopHolders)
    && (t.organicScore == null || t.organicScore >= m.minOrganic)
    && t.change5m >= m.min5m && t.change5m <= m.max5m && ratioOf(t) >= m.minRatio) return "migration";
  const b = SETUPS.breakout, mcap = t.mcap || t.fdv || 0;
  if ((gradMin == null || gradMin > m.maxAgeMin)
    && (t.liquidity || 0) >= b.minLiq && vol5mOf(t) >= b.minVol5m && mcap >= b.minMcap && mcap <= b.maxMcap
    && (t.organicScore == null || t.organicScore >= b.minOrganic)
    && (t.topHoldersPct == null || t.topHoldersPct <= RULES.maxTopHoldersPct)
    && t.change5m >= b.min5m && t.change5m <= b.max5m && ratioOf(t) >= b.minRatio) return "breakout";
  return null;
}

function score(t, setup) {
  // real 5m flow x buying pressure, migrations first; fresher graduations score higher
  const fresh = t.graduatedAt ? Math.max(0.5, 2 - (Date.now() - t.graduatedAt) / 3_600_000 / 2) : 1;
  return (setup === "migration" ? 2 : 1) * fresh * Math.log10(1 + vol5mOf(t)) * Math.min(ratioOf(t), 4) * (1 + Math.min(t.change5m, 30) / 30);
}

function state(world) {
  const today = dayKey();
  world.scalper = world.scalper || { lastRunAt: 0, lastScanAt: 0, candidates: [], cooldown: {}, stats: {} };
  const s = world.scalper;
  if (s.stats.day !== today) s.stats = { day: today, entries: 0, exits: 0, wins: 0, realizedSol: 0 };
  s.allTime = s.allTime || { entries: 0, exits: 0, wins: 0, realizedSol: 0 };
  s.bySetup = s.bySetup || {};
  return s;
}

const fmtPct = (x) => `${x >= 0 ? "+" : ""}${x.toFixed(1)}%`;

async function sell(world, st, mint, p, fraction, why) {
  const cfg = SETUPS[p.setup] || SETUPS.breakout;
  const trade = await executeOrder({ side: "sell", mint, symbol: p.symbol, fraction, reason: `Scalp exit (${cfg.label}): ${why}.`, proposedBy: p.by || "max", paperFee: cfg.paperFee },
    { ok: true, fraction, token: { mint, symbol: p.symbol, decimals: p.decimals } }, world);
  trade.strategy = "scalp";
  const bs = (st.bySetup[p.setup || "breakout"] ||= { exits: 0, wins: 0, realizedSol: 0 });
  st.stats.realizedSol = +(st.stats.realizedSol + trade.realized).toFixed(6);
  st.allTime.realizedSol = +(st.allTime.realizedSol + trade.realized).toFixed(6);
  bs.realizedSol = +(bs.realizedSol + trade.realized).toFixed(6);
  if (fraction >= 0.999) {
    st.stats.exits++; st.allTime.exits++; bs.exits++;
    const total = (p.partialRealized || 0) + trade.realized;
    if (total > 0) { st.stats.wins++; st.allTime.wins++; bs.wins++; }
  } else if (world.treasury.positions[mint]) {
    world.treasury.positions[mint].partialRealized = (p.partialRealized || 0) + trade.realized;
  }
  pushTranscript(world, { kind: "system", text: `⚡ Scalp ${fraction >= 0.999 ? "out" : "half out"}: ${p.symbol} ${trade.realized >= 0 ? "+" : ""}${trade.realized} SOL · ${why}` });
  return trade;
}

/** One scalper pass. Call with the world loaded under the lock. */
export async function runScalper(world, { force = false } = {}) {
  if (!SCALP.enabled) return { skipped: "disabled" };
  const st = state(world), now = Date.now();
  if (!force && now - st.lastRunAt < SCALP.runEveryMs) return { skipped: "fresh" };
  st.lastRunAt = now;
  const t = world.treasury;
  await markToMarket(world);
  const log = [];

  let flow = null;
  if (now - st.lastScanAt >= SCALP.scanEveryMs) {
    try {
      const movers = await fastMovers({ limit: 100 });
      st.lastScanAt = now;
      st.scanned = movers.length;
      st.freshMigrations = movers.filter((m) => m.graduatedAt && now - m.graduatedAt <= SETUPS.migration.maxAgeMin * 60_000).length;
      flow = new Map(movers.map((m) => [m.mint, m]));
      st.candidates = movers.map((m) => ({ m, setup: classify(m, world, now) })).filter((x) => x.setup)
        .sort((a, b) => score(b.m, b.setup) - score(a.m, a.setup)).slice(0, 8)
        .map(({ m, setup }) => ({ setup, mint: m.mint, symbol: m.symbol, usdPrice: m.usdPrice, decimals: m.decimals, icon: m.icon, change5m: +m.change5m.toFixed(1), ratio: +ratioOf(m).toFixed(2), vol5m: Math.round(vol5mOf(m)), liquidity: Math.round(m.liquidity || 0), mcap: Math.round(m.mcap || m.fdv || 0), gradMin: m.graduatedAt ? Math.round((now - m.graduatedAt) / 60_000) : null, launchpad: m.launchpad }));
    } catch (err) { pushEvent(world, "scalp-scan-error", { error: err.message }); }
  }

  // ---- exits ----
  for (const [mint, p] of Object.entries(t.positions)) {
    if (p.strategy !== "scalp" || !p.costSol || p.valueSol == null) continue;
    const cfg = SETUPS[p.setup] || SETUPS.breakout;
    const pct = ((p.valueSol - p.costSol) / p.costSol) * 100;
    p.peakPct = Math.max(p.peakPct ?? 0, pct);
    const ageMin = (now - p.openedAt) / 60_000;
    const f = flow?.get(mint);
    let why = null, fraction = 1;
    if (pct <= cfg.stop) why = `stop-loss ${fmtPct(pct)}`;
    else if (pct >= cfg.take) why = `take-profit ${fmtPct(pct)}`;
    else if (!p.halfTaken && pct >= cfg.half) { why = `locked half at ${fmtPct(pct)}`; fraction = 0.5; }
    else if (p.peakPct >= cfg.trailArm && pct <= p.peakPct - cfg.trail) why = `trailing stop ${fmtPct(pct)} (peak ${fmtPct(p.peakPct)})`;
    else if (ageMin >= cfg.timeMin && pct < cfg.timeGain && !p.halfTaken) why = `time stop after ${Math.round(ageMin)} min at ${fmtPct(pct)}`;
    else if (f && pct > 1 && ratioOf(f) < 0.7) why = `sellers took over (${(1 / Math.max(ratioOf(f), 0.01)).toFixed(1)}× buyers) at ${fmtPct(pct)}`;
    if (!why) continue;
    try {
      await sell(world, st, mint, p, fraction, why);
      if (fraction < 1 && t.positions[mint]) t.positions[mint].halfTaken = true;
      if (fraction >= 1) st.cooldown[mint] = now;
      log.push(`exit ${p.symbol} ${why}`);
    } catch (err) { pushEvent(world, "scalp-exit-error", { mint, error: err.message }); }
  }

  // ---- entries (only on a fresh scan) ----
  if (!t.halted && st.stats.entries < SCALP.maxPerDay && now - st.lastScanAt <= SCALP.scanEveryMs * 1.5) {
    const open = Object.values(t.positions).filter((p) => p.strategy === "scalp");
    for (const c of st.candidates || []) {
      if (open.length >= SCALP.maxOpen) break;
      const cfg = SETUPS[c.setup];
      if (open.filter((p) => p.setup === c.setup).length >= cfg.maxOpen) continue;
      if (t.positions[c.mint] || now - (st.cooldown[c.mint] || 0) < SCALP.cooldownMs) continue;
      const cash = (t.mode === "live" ? (t.realSol ?? 0) : t.sol) - RULES.reserveSol;
      const size = Math.min(t.equitySol * cfg.size, cash);
      if (size < RULES.minTradeSol) break;
      const what = c.setup === "migration" ? `graduated ${c.gradMin} min ago${c.launchpad ? ` from ${c.launchpad}` : ""}` : "breakout";
      const reason = `Scalp in (${cfg.label}): ${what}, 5m ${fmtPct(c.change5m)}, buyers ${c.ratio}× sellers, $${Math.round(c.vol5m / 1000)}k 5m volume.`;
      try {
        await executeOrder({ side: "buy", mint: c.mint, symbol: c.symbol, solAmount: size, reason, proposedBy: "max", paperFee: cfg.paperFee },
          { ok: true, sizedSol: +size.toFixed(4), token: { mint: c.mint, symbol: c.symbol, usdPrice: c.usdPrice, decimals: c.decimals, icon: c.icon } }, world);
        const p = t.positions[c.mint];
        if (p) { p.strategy = "scalp"; p.setup = c.setup; p.peakPct = 0; open.push(p); }
        st.stats.entries++; st.allTime.entries++;
        st.cooldown[c.mint] = now;
        pushTranscript(world, { kind: "system", text: `⚡ Scalp in: ${size.toFixed(3)} SOL → ${c.symbol} (${what}, 5m ${fmtPct(c.change5m)}, buyers ${c.ratio}×, $${Math.round(c.vol5m / 1000)}k 5m vol)` });
        log.push(`entry ${c.symbol} ${c.setup}`);
      } catch (err) { pushEvent(world, "scalp-entry-error", { mint: c.mint, error: err.message }); }
    }
  }
  for (const [m, at] of Object.entries(st.cooldown)) if (now - at > SCALP.cooldownMs) delete st.cooldown[m];
  if (log.length) await markToMarket(world);
  return { ok: true, log, candidates: (st.candidates || []).length, freshMigrations: st.freshMigrations || 0 };
}

export function scalperLine(world) {
  const s = world.scalper;
  if (!s) return "SCALPER: warming up.";
  const a = s.allTime || {}, d = s.stats || {};
  const by = Object.entries(s.bySetup || {}).map(([k, v]) => `${k} ${v.realizedSol >= 0 ? "+" : ""}${v.realizedSol.toFixed(4)} SOL (${v.wins}/${v.exits} wins)`).join(", ");
  return `SCALPER (Max's automatic bot, mostly fresh pump.fun migrations): today ${d.entries || 0} in / ${d.exits || 0} out, ${d.wins || 0} wins, ${(d.realizedSol || 0) >= 0 ? "+" : ""}${(d.realizedSol || 0).toFixed(4)} SOL; all time ${(a.realizedSol || 0) >= 0 ? "+" : ""}${(a.realizedSol || 0).toFixed(4)} SOL${by ? `; by setup: ${by}` : ""}.`;
}
