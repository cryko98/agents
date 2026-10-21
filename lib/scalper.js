// The scalper: rule-based momentum trading on the highest-volume tokens, with fast exits.
// Runs every ~30 seconds (no LLM in the loop, so it reacts quickly). Positions it opens are
// tagged strategy "scalp" and only this module closes them.
//
// Entry: a liquid, high-volume token that is breaking out right now
//   - 1h volume and liquidity well above the floor, mint/freeze revoked, decent organic score
//   - 5m price up (but not already vertical), buyers clearly outpacing sellers, net buyers > 0
// Exit: whichever comes first
//   - hard stop-loss, trailing stop once in profit, big-win take-profit,
//     time stop for trades that go nowhere, momentum fade (sellers take over)
import { fastMovers, SOL_MINT } from "./market.js";
import { executeOrder, markToMarket, RULES } from "./trading.js";
import { dayKey, pushTranscript, pushEvent } from "./state.js";

const num = (k, d) => Number(process.env[k] || d);
export const SCALP = {
  enabled: process.env.SCALPER !== "0",
  runEveryMs: num("SCALP_RUN_MS", 25_000),
  scanEveryMs: num("SCALP_SCAN_MS", 90_000),
  sizeFraction: num("SCALP_SIZE", 0.08),        // of equity per scalp
  maxOpen: num("SCALP_MAX_OPEN", 5),
  maxPerDay: num("SCALP_MAX_PER_DAY", 60),
  minLiquidityUsd: num("SCALP_MIN_LIQ", 50_000),
  minVol1hUsd: num("SCALP_MIN_VOL_1H", 150_000),
  minMcapUsd: num("SCALP_MIN_MCAP", 50_000),
  maxMcapUsd: num("SCALP_MAX_MCAP", 200_000_000),
  minOrganic: num("SCALP_MIN_ORGANIC", 35),
  minAgeHours: num("SCALP_MIN_AGE_H", 1),
  minChange5m: num("SCALP_MIN_5M", 1.0),          // %
  maxChange5m: num("SCALP_MAX_5M", 15),           // % (don't buy a candle that already went vertical)
  maxChange1h: num("SCALP_MAX_1H", 80),
  minBuyRatio5m: num("SCALP_MIN_BUY_RATIO", 1.25), // buy volume / sell volume
  stopPct: num("SCALP_STOP", -5),
  trailArmPct: num("SCALP_TRAIL_ARM", 5),         // trailing stop arms at +5%
  trailPct: num("SCALP_TRAIL", 3),                // and gives back at most 3 points from the peak
  takePct: num("SCALP_TAKE", 18),                 // take the whole thing at +18%
  timeStopMin: num("SCALP_TIME_MIN", 20),
  timeStopMinGainPct: num("SCALP_TIME_GAIN", 2),
  fadeBuyRatio: num("SCALP_FADE_RATIO", 0.8),
  cooldownMs: num("SCALP_COOLDOWN_MIN", 120) * 60_000,
};

export function scalpRulesText() {
  const s = SCALP;
  return `Scalper (automatic, every ~30s): buys the highest-volume tokens breaking out (5m +${s.minChange5m}% to +${s.maxChange5m}%, buyers ≥ ${s.minBuyRatio5m}× sellers, ≥ $${s.minVol1hUsd / 1000}k 1h volume, ≥ $${s.minLiquidityUsd / 1000}k liquidity), ${Math.round(s.sizeFraction * 100)}% of equity each, max ${s.maxOpen} at once. Exits: stop ${s.stopPct}%, trailing ${s.trailPct} pts once +${s.trailArmPct}%, take all at +${s.takePct}%, time stop after ${s.timeStopMin} min under +${s.timeStopMinGainPct}%, or when sellers take over.`;
}

function signal(t) {
  const ratio = t.sellVol5m > 0 ? t.buyVol5m / t.sellVol5m : t.buyVol5m > 0 ? 9 : 0;
  return { ratio, vol5m: t.buyVol5m + t.sellVol5m };
}

export function scalpEligible(t, world) {
  const s = SCALP, own = new Set((world.launches || []).map((l) => l.mint).concat(world.launch?.mint || []));
  if (!t || own.has(t.mint) || t.mint === SOL_MINT || t.sus || !t.usdPrice) return false;
  if (t.mintDisabled === false || t.freezeDisabled === false) return false;
  // memecoins and other volatile tokens only: no tokenized stocks, RWAs, LSTs, wrapped majors or stablecoins
  if ((t.tags || []).some((g) => ["stocks", "xstocks", "equities", "rwa", "lst", "stable", "stablecoin"].includes(g))) return false;
  if (/^(cb|w)(BTC|ETH|NEAR|SOL)$|^(USDC|USDT|PYUSD|USDS|USDe)$/i.test(t.symbol || "") || (t.usdPrice > 0.97 && t.usdPrice < 1.03 && (t.change1h ?? 0) === 0)) return false;
  const mcap = t.mcap || t.fdv || 0;
  if (mcap < s.minMcapUsd || mcap > s.maxMcapUsd) return false;
  if ((t.liquidity || 0) < s.minLiquidityUsd || (t.vol1h || 0) < s.minVol1hUsd) return false;
  if (t.organicScore != null && t.organicScore < s.minOrganic) return false;
  if (t.ageHours != null && t.ageHours < s.minAgeHours) return false;
  if (t.topHoldersPct != null && t.topHoldersPct > RULES.maxTopHoldersPct) return false;
  if (t.change5m == null || t.change5m < s.minChange5m || t.change5m > s.maxChange5m) return false;
  if ((t.change1h ?? 0) > s.maxChange1h) return false;
  if ((t.netBuyers5m ?? 0) <= 0) return false;
  return signal(t).ratio >= s.minBuyRatio5m;
}

function score(t) {
  const { ratio, vol5m } = signal(t);
  // reward real flow and buying pressure, penalise candles that already ran far
  return Math.log10(1 + vol5m) * Math.min(ratio, 4) * (1 + Math.min(t.change5m, 8) / 10) / (1 + Math.max(0, (t.change1h || 0) - 30) / 50);
}

function state(world) {
  const today = dayKey();
  world.scalper = world.scalper || { lastRunAt: 0, lastScanAt: 0, candidates: [], cooldown: {}, stats: {} };
  const s = world.scalper;
  if (s.stats.day !== today) s.stats = { day: today, entries: 0, exits: 0, wins: 0, realizedSol: 0 };
  s.allTime = s.allTime || { entries: 0, exits: 0, wins: 0, realizedSol: 0 };
  return s;
}

const fmtPct = (x) => `${x >= 0 ? "+" : ""}${x.toFixed(1)}%`;

/** One scalper pass. Call with the world loaded under the lock. */
export async function runScalper(world, { force = false } = {}) {
  if (!SCALP.enabled) return { skipped: "disabled" };
  const st = state(world), now = Date.now();
  if (!force && now - st.lastRunAt < SCALP.runEveryMs) return { skipped: "fresh" };
  st.lastRunAt = now;
  const t = world.treasury;
  await markToMarket(world);
  const log = [];

  // fresh 5m flow (also used for the momentum-fade exit)
  let flow = null;
  if (now - st.lastScanAt >= SCALP.scanEveryMs) {
    try {
      const movers = await fastMovers({ limit: 50 });
      st.lastScanAt = now;
      flow = new Map(movers.map((m) => [m.mint, m]));
      st.candidates = movers.filter((m) => scalpEligible(m, world)).sort((a, b) => score(b) - score(a)).slice(0, 8)
        .map((m) => ({ mint: m.mint, symbol: m.symbol, usdPrice: m.usdPrice, decimals: m.decimals, icon: m.icon, change5m: +m.change5m.toFixed(2), ratio: +signal(m).ratio.toFixed(2), vol1h: Math.round(m.vol1h), liquidity: Math.round(m.liquidity), mcap: Math.round(m.mcap || m.fdv || 0), score: +score(m).toFixed(2) }));
      st.scanned = movers.length;
    } catch (err) { pushEvent(world, "scalp-scan-error", { error: err.message }); }
  }

  // ---- exits ----
  for (const [mint, p] of Object.entries(t.positions)) {
    if (p.strategy !== "scalp" || !p.costSol || p.valueSol == null) continue;
    const pct = ((p.valueSol - p.costSol) / p.costSol) * 100;
    p.peakPct = Math.max(p.peakPct ?? 0, pct);
    const ageMin = (now - p.openedAt) / 60_000;
    const f = flow?.get(mint);
    let why = null;
    if (pct <= SCALP.stopPct) why = `stop-loss ${fmtPct(pct)}`;
    else if (pct >= SCALP.takePct) why = `take-profit ${fmtPct(pct)}`;
    else if (p.peakPct >= SCALP.trailArmPct && pct <= p.peakPct - SCALP.trailPct) why = `trailing stop ${fmtPct(pct)} (peak ${fmtPct(p.peakPct)})`;
    else if (ageMin >= SCALP.timeStopMin && pct < SCALP.timeStopMinGainPct) why = `time stop after ${Math.round(ageMin)} min at ${fmtPct(pct)}`;
    else if (f && pct > 0.5 && signal(f).ratio < SCALP.fadeBuyRatio) why = `momentum fading (sellers ${(1 / Math.max(signal(f).ratio, 0.01)).toFixed(1)}× buyers) at ${fmtPct(pct)}`;
    if (!why) continue;
    try {
      const trade = await executeOrder({ side: "sell", mint, symbol: p.symbol, fraction: 1, reason: `Scalp exit: ${why}.`, proposedBy: p.by || "max" },
        { ok: true, fraction: 1, token: { mint, symbol: p.symbol, decimals: p.decimals } }, world);
      trade.strategy = "scalp";
      st.stats.exits++; st.allTime.exits++;
      st.stats.realizedSol = +(st.stats.realizedSol + trade.realized).toFixed(6);
      st.allTime.realizedSol = +(st.allTime.realizedSol + trade.realized).toFixed(6);
      if (trade.realized > 0) { st.stats.wins++; st.allTime.wins++; }
      st.cooldown[mint] = now;
      pushTranscript(world, { kind: "system", text: `⚡ Scalp out: ${p.symbol} ${trade.realized >= 0 ? "+" : ""}${trade.realized} SOL · ${why}` });
      log.push(`exit ${p.symbol} ${why}`);
    } catch (err) { pushEvent(world, "scalp-exit-error", { mint, error: err.message }); }
  }

  // ---- entries ----
  if (!t.halted && st.stats.entries < SCALP.maxPerDay) {
    const open = Object.values(t.positions).filter((p) => p.strategy === "scalp").length;
    let slots = SCALP.maxOpen - open;
    for (const c of st.candidates || []) {
      if (slots <= 0) break;
      if (t.positions[c.mint] || now - (st.cooldown[c.mint] || 0) < SCALP.cooldownMs) continue;
      if (now - st.lastScanAt > SCALP.scanEveryMs * 1.5) break; // only act on a fresh scan
      const cash = (t.mode === "live" ? (t.realSol ?? 0) : t.sol) - RULES.reserveSol;
      const size = Math.min(t.equitySol * SCALP.sizeFraction, cash);
      if (size < RULES.minTradeSol) break;
      const reason = `Scalp in: 5m ${fmtPct(c.change5m)}, buyers ${c.ratio}× sellers, $${Math.round(c.vol1h / 1000)}k 1h volume.`;
      try {
        await executeOrder({ side: "buy", mint: c.mint, symbol: c.symbol, solAmount: size, reason, proposedBy: "max" },
          { ok: true, sizedSol: +size.toFixed(4), token: { mint: c.mint, symbol: c.symbol, usdPrice: c.usdPrice, decimals: c.decimals, icon: c.icon } }, world);
        const p = t.positions[c.mint];
        if (p) { p.strategy = "scalp"; p.peakPct = 0; }
        st.stats.entries++; st.allTime.entries++;
        st.cooldown[c.mint] = now;
        slots--;
        pushTranscript(world, { kind: "system", text: `⚡ Scalp in: ${size.toFixed(3)} SOL → ${c.symbol} (5m ${fmtPct(c.change5m)}, buyers ${c.ratio}× sellers, $${Math.round(c.vol1h / 1000)}k 1h vol)` });
        log.push(`entry ${c.symbol}`);
      } catch (err) { pushEvent(world, "scalp-entry-error", { mint: c.mint, error: err.message }); }
    }
  }
  for (const [m, at] of Object.entries(st.cooldown)) if (now - at > SCALP.cooldownMs) delete st.cooldown[m];
  if (log.length) await markToMarket(world);
  return { ok: true, log, candidates: (st.candidates || []).length };
}

export function scalperLine(world) {
  const s = world.scalper;
  if (!s) return "SCALPER: warming up.";
  const a = s.allTime || {}, d = s.stats || {};
  return `SCALPER (Max's automatic momentum bot): today ${d.entries || 0} in / ${d.exits || 0} out, ${d.wins || 0} wins, ${(d.realizedSol || 0) >= 0 ? "+" : ""}${(d.realizedSol || 0).toFixed(4)} SOL; all time ${(a.realizedSol || 0) >= 0 ? "+" : ""}${(a.realizedSol || 0).toFixed(4)} SOL over ${a.exits || 0} closed scalps.`;
}
