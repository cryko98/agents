// Launching the crew's own coins on pump.fun through PumpPortal's local transaction API.
// Revenue model: creator fees, plus the dev buy. Every launch opens with a dev buy (LAUNCH_DEV_BUY_SOL,
// default 0.2 SOL). The crew holds it and sells only when the bonding-curve quote, after fees, is at
// least DEV_SELL_MIN_PROFIT_PCT (default 3) above what it cost. If nobody else has bought within
// DEV_SELL_NO_BUY_SEC (default 180), no buyers are coming and the bag is sold anyway.
// DEV_SELL_MAX_HOLD_MIN (default 0 = off) adds a hard timeout. The coin description says so.
// By default a launch goes out automatically once the plan is launch-ready
// (LAUNCH_APPROVAL=owner makes it wait for POST /api/admin action=approve-launch).
// A real launch needs LAUNCH_ENABLED=1, AGENT_WALLET_SECRET and PINATA_JWT (any trading mode).
// After a launch the coin moves to world.launches and the crew starts planning the next one.
import { loadKeypair, loadWeb3, signAndSend, publicAddress, solBalance, RPC_URL } from "./wallet.js";
import { squareLogo } from "./image.js";
import { NEWS_ONLY } from "./signals.js";
import { generateLogo, logoPrompt, falConfigured } from "./logo.js";
import { pushTranscript, pushEvent } from "./state.js";
import { setJSON, getJSON } from "./db.js";
import { emptyPlan } from "../shared/roster.js";
import { backingAsk, noteBackedLaunch, launchMinSol } from "./backing.js";

export const coinKey = (ticker) => `ah:coin:${String(ticker).toUpperCase()}`;
const coinPage = (ticker) => (process.env.SITE_URL ? `${process.env.SITE_URL.replace(/\/$/, "")}/coin/${ticker}` : "");

const PUMP_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const LAMPORTS = 1_000_000_000;
const RENT_EXEMPT_EMPTY = 890_880; // lamports kept in an empty system account
export const CLAIM_INTERVAL_MS = Number(process.env.CLAIM_INTERVAL_MS || 10 * 60_000);
const CLAIM_MIN_SOL = Number(process.env.CLAIM_MIN_SOL || 0.002);
const BLIND_CLAIM_MS = 6 * 3_600_000; // also covers fees from graduated (PumpSwap) coins
export const LAUNCH_COOLDOWN_MS = Number(process.env.LAUNCH_COOLDOWN_MIN || 5) * 60_000; // a new coin every ~5 minutes
export const DEV_BUY_SOL = Number(process.env.LAUNCH_DEV_BUY_SOL ?? 0.2);
export const DEV_SELL_MIN_PROFIT_PCT = Number(process.env.DEV_SELL_MIN_PROFIT_PCT ?? 3);
const DEV_SELL_MAX_HOLD_MS = Number(process.env.DEV_SELL_MAX_HOLD_MIN || 0) * 60_000; // 0: hold until profitable
export const DEV_SELL_NO_BUY_SEC = Number(process.env.DEV_SELL_NO_BUY_SEC ?? 180);
// pump.fun trade fees (protocol + creator), counted on both sides to stay on the safe side
const BUY_FEE = 0.0125, SELL_FEE = 0.0125, SELL_TX_SOL = 0.0006;
// a launch costs ~0.0095 SOL net (measured on $FRIED) and the dev buy comes back seconds later,
// so the wallet needs the create cost plus the dev buy up front, with a little headroom
const MIN_LAUNCH_SOL = Number(process.env.MIN_LAUNCH_SOL || 0.015 + DEV_BUY_SOL);
// A thin wallet still launches: the dev buy shrinks to what it can spare after the create cost and a
// reserve for the sell transaction, down to DEV_BUY_MIN_SOL. It comes back (minus fees) when it is sold.
export const DEV_BUY_MIN_SOL = Number(process.env.DEV_BUY_MIN_SOL || 0.02);
const LAUNCH_RESERVE_SOL = Number(process.env.LAUNCH_RESERVE_SOL || 0.01);
const CREATE_COST_SOL = 0.015;
const PUMPPORTAL = "https://pumpportal.fun/api/trade-local";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A real launch is independent of the trading mode: the crew can launch its coin from the real
// wallet while trades are still paper. Needs LAUNCH_ENABLED=1, the wallet secret and a Pinata key.
export const launchEnabled = () => process.env.LAUNCH_ENABLED === "1" && !!process.env.PINATA_JWT && !!process.env.AGENT_WALLET_SECRET;
export const launchNeedsOwner = () => process.env.LAUNCH_APPROVAL === "owner";

// Upload to IPFS through Pinata. Tries the v3 Files API first, then the legacy pinning API,
// so a key works whether it was created with V3 "Files: Write" or the legacy pinFileToIPFS scope.
export async function pinataUpload(blob, filename) {
  const jwt = String(process.env.PINATA_JWT || "").trim().replace(/^Bearer\s+/i, "");
  const auth = { authorization: `Bearer ${jwt}` };
  const errors = [];
  const why = (d, status) => { const e = d?.error; return typeof e === "string" ? e : e?.message || e?.details || e?.reason || d?.message || String(status); };

  const v3 = new FormData();
  v3.append("network", "public");
  v3.append("file", blob, filename);
  const r1 = await fetch("https://uploads.pinata.cloud/v3/files", { method: "POST", headers: auth, body: v3 });
  const d1 = await r1.json().catch(() => ({}));
  if (r1.ok && d1.data?.cid) return `https://ipfs.io/ipfs/${d1.data.cid}`;
  errors.push(`v3 ${r1.status} ${why(d1, r1.status)}`);

  const legacy = new FormData();
  legacy.append("file", blob, filename);
  legacy.append("pinataMetadata", JSON.stringify({ name: filename }));
  const r2 = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", { method: "POST", headers: auth, body: legacy });
  const d2 = await r2.json().catch(() => ({}));
  if (r2.ok && d2.IpfsHash) return `https://ipfs.io/ipfs/${d2.IpfsHash}`;
  errors.push(`legacy ${r2.status} ${why(d2, r2.status)}`);

  throw new Error(`Pinata upload failed (${errors.join("; ")}). PINATA_JWT must be the key's JWT, with V3 Files: Write or legacy pinFileToIPFS.`);
}

/** The text that goes into the coin's on-chain metadata. The autonomy statement comes first. */
export function coinDescription(plan, devBuy = DEV_BUY_SOL) {
  const page = plan.ticker ? coinPage(plan.ticker) : "";
  const head = "🤖 Launched 100% autonomously by the Cookers: six AI agents who spotted the trend, picked the idea, named it, chose the logo and launched this coin themselves. No human in the loop from A to Z.";
  const body = [plan.tagline, plan.concept].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  const src = plan.source?.author ? ` Inspired by a public post from @${plan.source.author}; not affiliated with or endorsed by them.` : "";
  const dev = devBuy > 0 ? ` Dev buy: ${devBuy} SOL at launch, sold once it is in profit, or after ${Math.round(DEV_SELL_NO_BUY_SEC / 60)} minutes if nobody else has bought; the crew also earns creator fees.` : " The crew holds none of the supply and earns creator fees only.";
  const tail = `${src}${dev}${page ? ` Birth record: ${page}` : ""}`;
  const room = 900 - head.length - tail.length - 2;
  return `${head} ${body.length > room ? body.slice(0, room - 1) + "…" : body}${tail}`;
}

/** The dev buy the next launch can afford, and the wallet balance it needs. A holder-backed launch uses the ask's dev buy. */
export function launchBudget(world) {
  const backing = backingAsk(world);
  if (backing) return { devBuy: backing.devBuySol, minSol: launchMinSol(backing.devBuySol), backing };
  const real = world.treasury.realSol;
  if (!launchEnabled() || real == null) return { devBuy: DEV_BUY_SOL, minSol: MIN_LAUNCH_SOL, backing: null };
  const spare = Math.floor((real - CREATE_COST_SOL - LAUNCH_RESERVE_SOL) * 1000) / 1000;
  const devBuy = Math.min(DEV_BUY_SOL, spare);
  return devBuy >= DEV_BUY_MIN_SOL
    ? { devBuy: Number(devBuy.toFixed(3)), minSol: CREATE_COST_SOL + LAUNCH_RESERVE_SOL + devBuy, backing: null }
    : { devBuy: DEV_BUY_MIN_SOL, minSol: CREATE_COST_SOL + LAUNCH_RESERVE_SOL + DEV_BUY_MIN_SOL, backing: null };
}

/** Why a launch couldn't go out right now (cooldown, wallet), or null. Checked before the review spends a call. */
export function launchBlocked(world) {
  if (Date.now() - (world.launches?.[0]?.launchedAt || 0) < LAUNCH_COOLDOWN_MS) return "cooldown";
  const { minSol } = launchBudget(world);
  if (launchEnabled() && world.treasury.realSol != null && world.treasury.realSol < minSol - 1e-9) return `low funds (${world.treasury.realSol} SOL)`;
  return null;
}

/** Queue a launch from the finished plan. Auto-approved unless LAUNCH_APPROVAL=owner. */
export function proposeLaunch(world) {
  const p = world.plan;
  world.launchWait = null;
  if (!p.name || !p.ticker || !p.concept) { world.launchWait = "plan incomplete"; return false; }
  if (NEWS_ONLY && (!p.source || !p.logoUrl || !["web", "generated"].includes(p.logoSource))) { world.launchWait = "news-only: needs a radar story and a logo"; return false; }
  // every coin gets its own ticker (the birth-record pages are keyed by it)
  const used = new Set((world.launches || []).map((l) => l.ticker));
  if (used.has(p.ticker)) { let n = 2; while (used.has(`${p.ticker.slice(0, 7)}${n}`)) n++; p.ticker = `${p.ticker.slice(0, 7)}${n}`; }
  const last = world.launches?.[0]?.launchedAt || 0;
  if (Date.now() - last < LAUNCH_COOLDOWN_MS) { world.launchWait = "cooldown"; return false; } // one coin per cooldown window
  // a launch backed by holders runs on their SOL with the dev buy the ask promised; otherwise the dev buy
  // is what the wallet can spare (up to DEV_BUY_SOL)
  const { devBuy, minSol, backing } = launchBudget(world);
  if (launchEnabled() && world.treasury.realSol != null && world.treasury.realSol < minSol - 1e-9) {
    const held = (world.launches || []).filter((x) => ["holding", "pending"].includes(x.devSell?.status));
    if (!world.launchLowFundsNoted) { world.launchLowFundsNoted = true; pushTranscript(world, { kind: "system", text: `The crew is ready to launch ${p.name}, but the wallet has less than ${minSol.toFixed(3)} SOL free${held.length ? ` (${held.length} dev buy${held.length > 1 ? "s are" : " is"} held until it can be sold at a profit)` : ""}.` }); }
    world.launchWait = `low funds (${world.treasury.realSol} SOL)`;
    return false;
  }
  world.launchLowFundsNoted = false;
  const auto = !launchNeedsOwner();
  world.launch = {
    status: auto ? "approved" : "proposed",
    proposedAt: Date.now(),
    approvedAt: auto ? Date.now() : null,
    name: p.name, ticker: p.ticker, tagline: p.tagline || null,
    description: coinDescription(p, devBuy),
    logoUrl: p.logoUrl || null,
    logoSource: p.logoSource || "generated",
    source: p.source || null,
    devBuySol: devBuy,
    backedBy: backing?.id || null,
  };
  pushTranscript(world, { kind: "system", text: auto
    ? `🚀 The crew is launching ${p.name} ($${p.ticker}) on pump.fun. Byte is preparing the transaction.`
    : `🚀 The crew wants to launch ${p.name} ($${p.ticker}) on pump.fun. Waiting for the owner's approval.` });
  pushEvent(world, "launch-proposed", { auto });
  return true;
}

export async function executeLaunch(world) {
  const l = world.launch;
  if (l.status !== "approved") return;
  if (!launchEnabled()) {
    l.status = "simulated";
    l.launchedAt = Date.now();
    pushTranscript(world, { kind: "system", text: `🧪 Launch simulated (live launching is off). ${l.name} exists only on the whiteboard for now.` });
    await archiveLaunch(world);
    return;
  }
  try {
    const kp = await loadKeypair();
    const { Keypair } = await loadWeb3();
    const mintKp = Keypair.generate();
    // the logo goes up as a 1000x1000 PNG; a web image that can't be used falls back to Pixel's own logo
    let imageUrl = null;
    try {
      if (l.logoUrl) imageUrl = await pinataUpload(await squareLogo(l.logoUrl), "logo.png");
    } catch (err) {
      pushEvent(world, "logo-error", { error: `${l.logoSource} image: ${err.message}` });
      if (!falConfigured()) throw err;
      imageUrl = await pinataUpload(await squareLogo(await generateLogo(logoPrompt(world.plan), { realistic: world.plan.logoStyle === "realistic" })), "logo.png");
      l.logoSource = "generated";
    }
    if (imageUrl) { l.logoOriginal = l.logoUrl; l.logoUrl = imageUrl; }
    // website = the post or article the coin is built on (birth record otherwise); X posts also go in the twitter field
    const src = l.source?.url || null;
    const metadata = { name: l.name, symbol: l.ticker, description: l.description || coinDescription(l), image: imageUrl || "", website: src || coinPage(l.ticker) || process.env.SITE_URL || "" };
    if (src && /^https:\/\/(x|twitter)\.com\//.test(src)) metadata.twitter = src;
    const uri = await pinataUpload(new Blob([JSON.stringify(metadata)], { type: "application/json" }), "metadata.json");
    const r = await fetch(PUMPPORTAL, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        publicKey: kp.publicKey.toBase58(), action: "create",
        tokenMetadata: { name: l.name, symbol: l.ticker, uri },
        mint: mintKp.publicKey.toBase58(), denominatedInSol: "true",
        amount: l.devBuySol || 0, slippage: 10, priorityFee: 0.0005, pool: "pump",
      }),
    });
    if (!r.ok) throw new Error(`PumpPortal ${r.status}: ${await r.text()}`);
    const sig = await signAndSend(await r.arrayBuffer(), [mintKp, kp]);
    l.status = "launched";
    l.launchedAt = Date.now();
    l.mint = mintKp.publicKey.toBase58();
    l.url = `https://pump.fun/coin/${l.mint}`;
    l.signature = sig;
    pushTranscript(world, { kind: "system", text: `🚀 ${l.name} ($${l.ticker}) is live on pump.fun: ${l.url}` });
    pushEvent(world, "launched", { mint: l.mint });
    if (l.devBuySol > 0) {
      // every tick and scalper pass quotes the bag on the bonding curve and sells it once it is in profit
      l.devSell = { status: "holding", cost: Number((l.devBuySol * (1 + BUY_FEE)).toFixed(5)), since: Date.now() };
      if (l.backedBy) noteBackedLaunch(world, l);
      pushTranscript(world, { kind: "system", text: `🔒 The ${l.devBuySol} SOL dev buy of $${l.ticker}${l.backedBy ? " (backed by holders)" : ""} is held until it can be sold at a profit (+${DEV_SELL_MIN_PROFIT_PCT}% or more after fees), or sold after ${Math.round(DEV_SELL_NO_BUY_SEC / 60)} minutes if nobody else buys.` });
    }
    await archiveLaunch(world);
  } catch (err) {
    l.status = "failed";
    l.error = err.message;
    pushTranscript(world, { kind: "system", text: `Launch failed: ${err.message}` });
  }
}

/** Sell the whole dev buy back into the bonding curve. Retries a few times (the token account can lag). */
async function sellDevBag(world, l, kp, attempts, { migrated = false, timedOut = false, noBuyers = false } = {}) {
  let lastErr;
  const cost = l.devSell?.cost ?? null;
  for (let i = 0; i < attempts; i++) {
    try {
      const before = await solBalance(kp.publicKey.toBase58());
      const r = await fetch(PUMPPORTAL, {
        method: "POST", headers: { "content-type": "application/json" },
        // tight slippage: the quote said "profit", don't hand it back on the way out
        body: JSON.stringify({ publicKey: kp.publicKey.toBase58(), action: "sell", mint: l.mint, amount: "100%", denominatedInSol: "false", slippage: 5, priorityFee: 0.0005, pool: migrated ? "auto" : "pump" }),
      });
      if (!r.ok) throw new Error(`PumpPortal ${r.status}: ${(await r.text()).slice(0, 160)}`);
      const sig = await signAndSend(await r.arrayBuffer(), [kp]);
      const after = await solBalance(kp.publicKey.toBase58()).catch(() => null);
      const back = before != null && after != null ? Number((after - before).toFixed(5)) : null;
      const pnl = back != null && cost != null ? Number((back - cost).toFixed(5)) : null;
      l.devSell = { status: "sold", sig, at: Date.now(), afterMs: l.launchedAt ? Date.now() - l.launchedAt : null, solBack: back, cost, pnl, timedOut: timedOut || undefined, noBuyers: noBuyers || undefined };
      const mins = l.devSell.afterMs ? Math.round(l.devSell.afterMs / 60_000) : null;
      pushTranscript(world, { kind: "system", text: `💸 Dev buy of $${l.ticker} sold${mins != null ? ` ${mins < 1 ? "under a minute" : `${mins} min`} after launch` : ""}${back != null ? `: ${back} SOL back` : ""}${pnl != null ? ` (${pnl >= 0 ? "+" : ""}${pnl} SOL, ${pnl >= 0 ? "+" : ""}${((pnl / cost) * 100).toFixed(1)}%)` : ""}${noBuyers ? " because nobody else bought" : timedOut ? " after the max hold time" : ""} (tx ${sig.slice(0, 8)}…).` });
      pushEvent(world, "dev-sold", { mint: l.mint, solBack: back });
      // keep the birth record in step (it was saved when the coin launched)
      try { const rec = await getJSON(coinKey(l.ticker)); if (rec) await setJSON(coinKey(l.ticker), { ...rec, devSell: l.devSell }); } catch { /* the record catches up on its own later */ }
      return true;
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) await sleep(2500);
    }
  }
  l.devSell = { ...(l.devSell || {}), status: "pending", error: lastErr?.message, tries: (l.devSell?.tries || 0) + attempts };
  pushEvent(world, "dev-sell-error", { mint: l.mint, error: lastErr?.message });
  return false;
}

async function rpcCall(method, params) {
  const r = await fetch(RPC_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result;
}

/** What the dev bag would sell for right now on the bonding curve, after fees. */
async function quoteDevBag(l, owner) {
  const { PublicKey } = await loadWeb3();
  const accounts = await rpcCall("getTokenAccountsByOwner", [owner, { mint: l.mint }, { encoding: "jsonParsed", commitment: "confirmed" }]);
  const tokens = (accounts?.value || []).reduce((s, a) => s + BigInt(a.account.data.parsed.info.tokenAmount.amount || "0"), 0n);
  if (tokens === 0n) return { tokens, sol: 0 };
  const mint = new PublicKey(l.mint);
  const [curve] = PublicKey.findProgramAddressSync([Buffer.from("bonding-curve"), mint.toBuffer()], new PublicKey(PUMP_PROGRAM));
  const info = await rpcCall("getAccountInfo", [curve.toBase58(), { encoding: "base64", commitment: "confirmed" }]);
  if (!info?.value) return null;
  const data = Buffer.from(info.value.data[0], "base64");
  // layout: 8-byte discriminator, then u64 virtual token reserves, u64 virtual SOL reserves, ..., bool complete at 48
  if (data[48] === 1) return { tokens, sol: Infinity, migrated: true }; // graduated: the curve filled far above our entry
  const vTok = data.readBigUInt64LE(8), vSol = data.readBigUInt64LE(16);
  const out = Number((tokens * vSol) / (vTok + tokens)) / LAMPORTS;
  return { tokens, sol: out * (1 - SELL_FEE) - SELL_TX_SOL };
}

/** Trades on the mint by anyone else. Until the dev bag is sold the crew's only transaction on it is
 * the launch, so every other successful signature is an outside trade (the first one has to be a buy). */
async function outsideTrades(l) {
  const sigs = await rpcCall("getSignaturesForAddress", [l.mint, { limit: 20, commitment: "confirmed" }]);
  return (sigs || []).filter((s) => !s.err && s.signature !== l.signature).length;
}

/** Quote every held dev bag and sell the ones that are in profit (or past the optional max hold).
 * Runs on every tick and scalper pass. Returns how many bags it looked at. */
export async function retryDevSells(world) {
  if (!launchEnabled()) return 0;
  const bags = (world.launches || []).filter((l) => ["holding", "scheduled", "pending"].includes(l.devSell?.status) && l.mint).slice(0, 5);
  if (!bags.length) return 0;
  const kp = await loadKeypair();
  const owner = kp.publicKey.toBase58();
  for (const l of bags) {
    const ds = l.devSell;
    ds.cost ??= Number(((l.devBuySol || 0) * (1 + BUY_FEE)).toFixed(5));
    let q;
    try { q = await quoteDevBag(l, owner); } catch (err) { pushEvent(world, "dev-quote-error", { ticker: l.ticker, error: err.message }); continue; }
    if (!q) continue;
    if (q.tokens === 0n) { l.devSell = { ...ds, status: "gone", note: "no tokens left in the wallet" }; continue; }
    ds.value = Number.isFinite(q.sol) ? Number(q.sol.toFixed(5)) : null;
    ds.pnlPct = ds.value != null && ds.cost ? Number((((ds.value - ds.cost) / ds.cost) * 100).toFixed(1)) : null;
    ds.checkedAt = Date.now();
    const inProfit = q.sol >= ds.cost * (1 + DEV_SELL_MIN_PROFIT_PCT / 100);
    const age = Date.now() - (l.launchedAt || 0);
    const timedOut = DEV_SELL_MAX_HOLD_MS > 0 && age > DEV_SELL_MAX_HOLD_MS;
    // nobody else bought within DEV_SELL_NO_BUY_SEC: no buyers are coming, take the bag back out
    let noBuyers = false;
    if (!inProfit && DEV_SELL_NO_BUY_SEC > 0 && age > DEV_SELL_NO_BUY_SEC * 1000 && !ds.outsideTrades) {
      try { ds.outsideTrades = await outsideTrades(l); noBuyers = ds.outsideTrades === 0; }
      catch (err) { pushEvent(world, "dev-quote-error", { ticker: l.ticker, error: err.message }); }
    }
    if (inProfit || timedOut || noBuyers) await sellDevBag(world, l, kp, 1, { migrated: !!q.migrated, timedOut: !inProfit && timedOut, noBuyers: !inProfit && noBuyers });
  }
  return bags.length;
}

/** Move a finished launch into the history, save its birth record and send the crew back to the whiteboard. */
export async function archiveLaunch(world) {
  const l = world.launch;
  if (!["launched", "simulated"].includes(l.status)) return;
  const p = world.plan, poll = world.poll?.planId && world.poll.planId === p.id ? world.poll : null;
  const record = {
    ...l,
    page: coinPage(l.ticker) || null,
    plan: { theme: p.theme, candidates: p.candidates, tagline: p.tagline, concept: p.concept, tokenomics: p.tokenomics, roadmap: p.roadmap, notes: p.notes, logoPrompt: p.logoPrompt, source: p.source || null, logoSource: l.logoSource || null },
    research: p.research || null,
    story: p.story || [],
    poll: poll ? { options: poll.options, tally: poll.tally, voters: poll.voters, winner: poll.winner, closesAt: poll.closesAt } : null,
    archivedAt: Date.now(),
  };
  try { await setJSON(coinKey(l.ticker), record); } catch (err) { pushEvent(world, "coin-record-error", { error: err.message }); }
  world.launches = [{ ...l, page: record.page }, ...(world.launches || [])].slice(0, 30);
  world.plan = emptyPlan();
  world.research = null;
  world.poll = null;
  world.launch = { status: "none" };
  const next = world.launches.length + 1;
  const mins = Math.round(LAUNCH_COOLDOWN_MS / 60_000);
  pushTranscript(world, { kind: "system", text: NEWS_ONLY
    ? `Coin #${next} comes from the next big story on Juno's radar (earliest in ${mins} minutes).`
    : `Back to the whiteboard: the crew starts planning coin #${next}. Next launch in about ${mins} minutes.` });
}

/** Lamports in the pump.fun bonding-curve creator vault for our wallet (claimable part). */
async function creatorVaultClaimable() {
  const owner = publicAddress();
  if (!owner) return 0;
  const { PublicKey } = await loadWeb3();
  const [vault] = PublicKey.findProgramAddressSync([Buffer.from("creator-vault"), new PublicKey(owner).toBuffer()], new PublicKey(PUMP_PROGRAM));
  const r = await fetch(RPC_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getBalance", params: [vault.toBase58(), { commitment: "confirmed" }] }) });
  const lamports = (await r.json())?.result?.value || 0;
  return Math.max(0, lamports - RENT_EXEMPT_EMPTY) / LAMPORTS;
}

/** Every 10 minutes: claim accrued creator fees when there is something worth claiming. */
export async function collectCreatorFees(world) {
  if (!(world.launches || []).some((l) => l.status === "launched") || !launchEnabled()) return;
  const t = world.treasury, now = Date.now();
  if (now - (t.lastFeeCheckAt || 0) < CLAIM_INTERVAL_MS) return;
  t.lastFeeCheckAt = now;
  try {
    const claimable = await creatorVaultClaimable();
    t.pendingCreatorFeesSol = Number(claimable.toFixed(6));
    const blind = now - (t.lastClaimAt || 0) > BLIND_CLAIM_MS;
    if (claimable < CLAIM_MIN_SOL && !blind) return;
    const kp = await loadKeypair();
    const r = await fetch(PUMPPORTAL, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ publicKey: kp.publicKey.toBase58(), action: "collectCreatorFee", priorityFee: 0.000001 }),
    });
    if (!r.ok) throw new Error(`PumpPortal ${r.status}: ${(await r.text()).slice(0, 160)}`);
    const sig = await signAndSend(await r.arrayBuffer(), [kp]);
    t.lastClaimAt = now;
    if (claimable >= CLAIM_MIN_SOL) {
      t.creatorFeesSol = Number(((t.creatorFeesSol || 0) + claimable).toFixed(6));
      t.pendingCreatorFeesSol = 0;
      pushTranscript(world, { kind: "system", text: `💰 Collected ${claimable.toFixed(4)} SOL in creator fees (tx ${sig.slice(0, 8)}…). Total so far: ${t.creatorFeesSol.toFixed(4)} SOL.` });
    }
    pushEvent(world, "fees-claimed", { sol: claimable, sig });
  } catch (err) {
    pushEvent(world, "claim-error", { error: err.message });
  }
}
