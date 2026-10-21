// Trading desk: guardrails, paper execution and live execution through Jupiter Swap V2.
import { prices, SOL_MINT, tokenInfo } from "./market.js";
import { loadKeypair, loadWeb3 } from "./wallet.js";
import { dayKey, pushTranscript, pushEvent } from "./state.js";

export const RULES = {
  maxTradeFraction: Number(process.env.MAX_TRADE_FRACTION || 0.12),   // of equity, per buy
  minTradeSol: Number(process.env.MIN_TRADE_SOL || 0.02),
  maxTradesPerDay: Number(process.env.MAX_TRADES_PER_DAY || 20),       // buys per UTC day
  maxOpenPositions: Number(process.env.MAX_OPEN_POSITIONS || 10),
  dailyDrawdownStop: Number(process.env.DAILY_DRAWDOWN_STOP || 0.20),  // halt for the day
  minLiquidityUsd: Number(process.env.MIN_LIQUIDITY_USD || 8_000),
  maxMcapUsd: Number(process.env.MAX_MCAP_USD || 1_000_000),           // the crew hunts small caps
  minMcapUsd: Number(process.env.MIN_MCAP_USD || 15_000),
  minAgeHours: Number(process.env.MIN_TOKEN_AGE_H || 3),
  minOrganicScore: Number(process.env.MIN_ORGANIC_SCORE || 30),
  maxTopHoldersPct: Number(process.env.MAX_TOP_HOLDERS_PCT || 50),
  // extra checks for micro caps (below $100k)
  microCapUsd: 100_000,
  microMinOrganic: Number(process.env.MICRO_MIN_ORGANIC || 45),
  microMinHolders: Number(process.env.MICRO_MIN_HOLDERS || 150),
  microMaxTopHoldersPct: Number(process.env.MICRO_MAX_TOP_HOLDERS_PCT || 35),
  microMinLiqRatio: 0.12,                                              // liquidity / market cap
  // automatic exits
  stopLossPct: Number(process.env.STOP_LOSS_PCT || -30),
  takeProfitPct: Number(process.env.TAKE_PROFIT_PCT || 60),
  reserveSol: Number(process.env.RESERVE_SOL || 0.05),                 // never spent (fees)
  slippageBps: Number(process.env.SLIPPAGE_BPS || 300),
  paperFee: 0.01,
};

export function rulesText() {
  const r = RULES;
  return [
    `max ${Math.round(r.maxTradeFraction * 100)}% of equity per buy, min ${r.minTradeSol} SOL`,
    `max ${r.maxTradesPerDay} buys per day, max ${r.maxOpenPositions} open positions`,
    `trading halts for the day after a ${Math.round(r.dailyDrawdownStop * 100)}% drawdown`,
    `small caps: market cap between $${(r.minMcapUsd / 1000).toFixed(0)}k and $${(r.maxMcapUsd / 1e6).toFixed(1)}M; below $100k only with organic ≥ ${r.microMinOrganic}, ≥ ${r.microMinHolders} holders, top holders ≤ ${r.microMaxTopHoldersPct}%, liquidity ≥ ${Math.round(r.microMinLiqRatio * 100)}% of mcap`,
    `only tokens with ≥ $${(r.minLiquidityUsd / 1000).toFixed(0)}k liquidity, ≥ ${r.minAgeHours}h old, organic score ≥ ${r.minOrganicScore}, mint & freeze revoked`,
    `automatic exits: stop-loss at ${r.stopLossPct}%, take half off at +${r.takeProfitPct}%`,
    `never trade the crew's own coin`,
  ];
}

/** Filter market candidates through the safety rules. */
export function eligible(token, world) {
  const r = RULES;
  const own = new Set([world.launch?.mint, ...(world.launches || []).map((l) => l.mint)].filter(Boolean));
  if (!token || own.has(token.mint) || token.mint === SOL_MINT) return false;
  if (token.sus) return false;
  if ((token.liquidity || 0) < r.minLiquidityUsd) return false;
  const mcap = token.mcap || token.fdv || 0;
  if (mcap > r.maxMcapUsd || mcap < r.minMcapUsd) return false;
  if (token.ageHours != null && token.ageHours < r.minAgeHours) return false;
  if (token.organicScore != null && token.organicScore < r.minOrganicScore) return false;
  if (token.mintDisabled === false || token.freezeDisabled === false) return false;
  if (token.topHoldersPct != null && token.topHoldersPct > r.maxTopHoldersPct) return false;
  if (!token.usdPrice) return false;
  if (mcap < r.microCapUsd) {
    if ((token.organicScore ?? 0) < r.microMinOrganic) return false;
    if ((token.holders ?? 0) < r.microMinHolders) return false;
    if (token.topHoldersPct == null || token.topHoldersPct > r.microMaxTopHoldersPct) return false;
    if ((token.liquidity || 0) / mcap < r.microMinLiqRatio) return false;
  }
  return true;
}

/** Stop-loss / take-profit on open positions. Runs every tick after markToMarket. */
export async function autoExits(world) {
  const t = world.treasury, done = [];
  for (const [mint, p] of Object.entries(t.positions)) {
    if (!p.costSol || p.valueSol == null) continue;
    const pct = ((p.valueSol - p.costSol) / p.costSol) * 100;
    let fraction = 0, reason = "";
    if (pct <= RULES.stopLossPct) { fraction = 1; reason = `Automatic stop-loss at ${pct.toFixed(0)}%.`; }
    else if (pct >= RULES.takeProfitPct && !p.tookProfit) { fraction = 0.5; reason = `Automatic take-profit at +${pct.toFixed(0)}%: half off the table.`; }
    if (!fraction) continue;
    try {
      const trade = await executeOrder({ side: "sell", mint, symbol: p.symbol, fraction, reason, proposedBy: "byte" }, { ok: true, fraction, token: { mint, symbol: p.symbol, decimals: p.decimals } }, world);
      if (t.positions[mint]) t.positions[mint].tookProfit = true;
      done.push(trade);
      pushTranscript(world, { kind: "system", text: `${trade.realized >= 0 ? "💰" : "🛡️"} ${reason} ${trade.symbol} → ${trade.sol} SOL (${trade.realized >= 0 ? "+" : ""}${trade.realized} SOL).` });
    } catch (err) {
      pushEvent(world, "auto-exit-error", { mint, error: err.message });
    }
  }
  return done;
}

/** Recompute equity/PnL from current prices. Mutates world.treasury. */
export async function markToMarket(world) {
  const t = world.treasury;
  const mints = Object.keys(t.positions);
  let px = {};
  try { px = await prices([SOL_MINT, ...mints]); } catch (err) { pushEvent(world, "price-error", { error: err.message }); return; }
  const solUsd = px[SOL_MINT]?.usd || t.solUsd;
  if (!solUsd) return;
  t.solUsd = solUsd;
  let posValue = 0;
  for (const [mint, p] of Object.entries(t.positions)) {
    const usd = px[mint]?.usd;
    if (usd) p.lastPriceSol = usd / solUsd;
    p.valueSol = p.amount * (p.lastPriceSol || 0);
    p.pnlSol = p.valueSol - p.costSol;
    posValue += p.valueSol;
  }
  t.equitySol = Number(((t.mode === "live" ? (t.realSol ?? t.sol) : t.sol) + posValue).toFixed(6));
  t.pnlSol = Number((t.equitySol - t.startSol).toFixed(6));
  t.pnlPct = t.startSol ? Number(((t.pnlSol / t.startSol) * 100).toFixed(2)) : 0;
  // daily bookkeeping
  const today = dayKey();
  if (t.dayKey !== today) { t.dayKey = today; t.dayStartEquity = t.equitySol; t.tradesToday = 0; if (t.halted?.day !== today) t.halted = null; }
  if (t.dayStartEquity && t.equitySol < t.dayStartEquity * (1 - RULES.dailyDrawdownStop) && !t.halted) {
    t.halted = { day: today, reason: `Daily drawdown limit hit (${Math.round(RULES.dailyDrawdownStop * 100)}%). No more trades today.` };
    pushTranscript(world, { kind: "system", text: `🛑 ${t.halted.reason}` });
  }
}

/** Validate an order against the rules. Returns { ok, reason, sizedSol }. */
export function validateOrder(order, world, candidates) {
  const t = world.treasury;
  const r = RULES;
  if (!order || !["buy", "sell"].includes(order.side)) return { ok: false, reason: "not an order" };
  if (t.halted) return { ok: false, reason: t.halted.reason };
  if (order.side === "sell") {
    const p = t.positions[order.mint];
    if (!p) return { ok: false, reason: "no such position" };
    const frac = Math.max(0.05, Math.min(1, Number(order.fraction) || 1));
    return { ok: true, fraction: frac, token: { mint: order.mint, symbol: p.symbol, decimals: p.decimals } };
  }
  // buy
  if (t.tradesToday >= r.maxTradesPerDay) return { ok: false, reason: "daily buy limit reached" };
  if (Object.keys(t.positions).length >= r.maxOpenPositions && !t.positions[order.mint]) return { ok: false, reason: "too many open positions" };
  const token = candidates.find((c) => c.mint === order.mint);
  if (!token) return { ok: false, reason: "token not on the vetted list" };
  if (!eligible(token, world)) return { ok: false, reason: "token fails the safety rules" };
  const cash = (t.mode === "live" ? (t.realSol ?? 0) : t.sol) - r.reserveSol;
  const cap = t.equitySol * r.maxTradeFraction;
  const sized = Math.min(Number(order.solAmount) || 0, cap, cash);
  if (sized < r.minTradeSol) return { ok: false, reason: `trade too small after sizing (${sized.toFixed(3)} SOL)` };
  return { ok: true, sizedSol: Number(sized.toFixed(4)), token };
}

/** Execute a validated order in paper or live mode. Returns a trade record or throws. */
export async function executeOrder(order, check, world) {
  const t = world.treasury;
  const solUsd = t.solUsd;
  if (!solUsd) throw new Error("no SOL price");
  const now = Date.now();
  const base = { id: `tr-${now}-${Math.random().toString(36).slice(2, 6)}`, t: now, side: order.side, mint: check.token.mint, symbol: check.token.symbol, reason: String(order.reason || "").slice(0, 200), by: order.proposedBy || "max", mode: t.mode };

  if (order.side === "buy") {
    const priceSol = check.token.usdPrice / solUsd;
    let tokens, spentSol, sig = null;
    if (t.mode === "live") {
      const res = await liveSwap({ inputMint: SOL_MINT, outputMint: check.token.mint, amountRaw: Math.floor(check.sizedSol * 1e9) });
      sig = res.signature;
      spentSol = res.inputAmount / 1e9;
      tokens = res.outputAmount / 10 ** (check.token.decimals ?? 6);
      t.realSol = Math.max(0, (t.realSol ?? 0) - spentSol);
    } else {
      spentSol = check.sizedSol;
      tokens = (spentSol * (1 - RULES.paperFee)) / priceSol;
      t.sol = Number((t.sol - spentSol).toFixed(6));
    }
    const p = t.positions[check.token.mint] || { symbol: check.token.symbol, name: check.token.name, decimals: check.token.decimals ?? 6, amount: 0, costSol: 0, openedAt: now, icon: check.token.icon || null, by: base.by };
    p.amount += tokens; p.costSol += spentSol; p.avgSolPerToken = p.costSol / p.amount; p.lastPriceSol = priceSol;
    t.positions[check.token.mint] = p;
    t.tradesToday += 1;
    const trade = { ...base, sol: Number(spentSol.toFixed(4)), tokens, priceUsd: check.token.usdPrice, sig };
    t.trades.unshift(trade); t.trades.splice(100);
    return trade;
  }

  // sell
  const p = t.positions[check.token.mint];
  const px = (await prices([check.token.mint]).catch(() => ({})))[check.token.mint]?.usd;
  const priceSol = px ? px / solUsd : p.lastPriceSol;
  const tokens = p.amount * check.fraction;
  let gotSol, sig = null;
  if (t.mode === "live") {
    const res = await liveSwap({ inputMint: check.token.mint, outputMint: SOL_MINT, amountRaw: Math.floor(tokens * 10 ** (p.decimals ?? 6)) });
    sig = res.signature;
    gotSol = res.outputAmount / 1e9;
    t.realSol = (t.realSol ?? 0) + gotSol;
  } else {
    gotSol = tokens * priceSol * (1 - RULES.paperFee);
    t.sol = Number((t.sol + gotSol).toFixed(6));
  }
  const costPart = p.costSol * check.fraction;
  p.amount -= tokens; p.costSol -= costPart;
  if (p.amount <= 1e-9 || check.fraction >= 0.999) delete t.positions[check.token.mint];
  const trade = { ...base, openedBy: p.by || null, sol: Number(gotSol.toFixed(4)), tokens, priceUsd: px || null, realized: Number((gotSol - costPart).toFixed(4)), sig };
  t.trades.unshift(trade); t.trades.splice(100);
  return trade;
}

/** Jupiter Swap V2: order -> sign -> execute. Only used in live mode. */
async function liveSwap({ inputMint, outputMint, amountRaw }) {
  const kp = await loadKeypair();
  if (!kp) throw new Error("live mode without AGENT_WALLET_SECRET");
  const h = { accept: "application/json", ...(process.env.JUPITER_API_KEY ? { "x-api-key": process.env.JUPITER_API_KEY } : {}) };
  const q = new URLSearchParams({ inputMint, outputMint, amount: String(amountRaw), taker: kp.publicKey.toBase58(), slippageBps: String(RULES.slippageBps) });
  const order = await (await fetch(`https://api.jup.ag/swap/v2/order?${q}`, { headers: h })).json();
  if (!order?.transaction) throw new Error(`Jupiter order failed: ${order?.errorMessage || order?.error || "no transaction"}`);
  const { VersionedTransaction } = await loadWeb3();
  const tx = VersionedTransaction.deserialize(Buffer.from(order.transaction, "base64"));
  tx.sign([kp]);
  const signedTransaction = Buffer.from(tx.serialize()).toString("base64");
  const exec = await (await fetch("https://api.jup.ag/swap/v2/execute", { method: "POST", headers: { ...h, "content-type": "application/json" }, body: JSON.stringify({ signedTransaction, requestId: order.requestId }) })).json();
  if (exec?.status !== "Success") throw new Error(`Jupiter execute failed: ${exec?.error || exec?.code}`);
  return { signature: exec.signature, inputAmount: Number(exec.totalInputAmount || amountRaw), outputAmount: Number(exec.totalOutputAmount || order.outAmount) };
}

export { tokenInfo };
