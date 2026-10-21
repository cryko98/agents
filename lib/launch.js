// Launching the crew's own coins on pump.fun through PumpPortal's local transaction API.
// Revenue model: creator fees. Every launch opens with a small dev buy (LAUNCH_DEV_BUY_SOL, default
// 0.02 SOL) that is sold automatically DEV_SELL_AFTER_SEC (default 5) seconds later; after that the
// crew holds none of the supply. The coin description says so.
// By default a launch goes out automatically once the plan is launch-ready
// (LAUNCH_APPROVAL=owner makes it wait for POST /api/admin action=approve-launch).
// A real launch needs LAUNCH_ENABLED=1, AGENT_WALLET_SECRET and PINATA_JWT (any trading mode).
// After a launch the coin moves to world.launches and the crew starts planning the next one.
import { loadKeypair, loadWeb3, signAndSend, publicAddress, solBalance, RPC_URL } from "./wallet.js";
import { squareLogo } from "./image.js";
import { generateLogo, logoPrompt, falConfigured } from "./logo.js";
import { pushTranscript, pushEvent } from "./state.js";
import { setJSON } from "./db.js";
import { emptyPlan } from "../shared/roster.js";

export const coinKey = (ticker) => `ah:coin:${String(ticker).toUpperCase()}`;
const coinPage = (ticker) => (process.env.SITE_URL ? `${process.env.SITE_URL.replace(/\/$/, "")}/coin/${ticker}` : "");

const PUMP_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const LAMPORTS = 1_000_000_000;
const RENT_EXEMPT_EMPTY = 890_880; // lamports kept in an empty system account
export const CLAIM_INTERVAL_MS = Number(process.env.CLAIM_INTERVAL_MS || 10 * 60_000);
const CLAIM_MIN_SOL = Number(process.env.CLAIM_MIN_SOL || 0.002);
const BLIND_CLAIM_MS = 6 * 3_600_000; // also covers fees from graduated (PumpSwap) coins
export const LAUNCH_COOLDOWN_MS = Number(process.env.LAUNCH_COOLDOWN_MIN || 5) * 60_000; // a new coin every ~5 minutes
export const DEV_BUY_SOL = Number(process.env.LAUNCH_DEV_BUY_SOL ?? 0.02);
const DEV_SELL_AFTER_MS = Number(process.env.DEV_SELL_AFTER_SEC ?? 5) * 1000;
// pump.fun create (~0.02 SOL rent + fees) plus the dev buy, with a little headroom
const MIN_LAUNCH_SOL = Number(process.env.MIN_LAUNCH_SOL || 0.03 + DEV_BUY_SOL);
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
export function coinDescription(plan) {
  const page = plan.ticker ? coinPage(plan.ticker) : "";
  const head = "🤖 Launched 100% autonomously by the Cookers: six AI agents who spotted the trend, picked the idea, named it, chose the logo and launched this coin themselves. No human in the loop from A to Z.";
  const body = [plan.tagline, plan.concept].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  const src = plan.source?.author ? ` Inspired by a public post from @${plan.source.author}; not affiliated with or endorsed by them.` : "";
  const dev = DEV_BUY_SOL > 0 ? ` Dev buy: ${DEV_BUY_SOL} SOL at launch, sold automatically ~${Math.round(DEV_SELL_AFTER_MS / 1000)}s later; after that the crew holds none of the supply and earns creator fees only.` : " The crew holds none of the supply and earns creator fees only.";
  const tail = `${src}${dev}${page ? ` Birth record: ${page}` : ""}`;
  const room = 900 - head.length - tail.length - 2;
  return `${head} ${body.length > room ? body.slice(0, room - 1) + "…" : body}${tail}`;
}

/** Queue a launch from the finished plan. Auto-approved unless LAUNCH_APPROVAL=owner. */
export function proposeLaunch(world) {
  const p = world.plan;
  world.launchWait = null;
  if (!p.name || !p.ticker || !p.concept) { world.launchWait = "plan incomplete"; return false; }
  // every coin gets its own ticker (the birth-record pages are keyed by it)
  const used = new Set((world.launches || []).map((l) => l.ticker));
  if (used.has(p.ticker)) { let n = 2; while (used.has(`${p.ticker.slice(0, 7)}${n}`)) n++; p.ticker = `${p.ticker.slice(0, 7)}${n}`; }
  const last = world.launches?.[0]?.launchedAt || 0;
  if (Date.now() - last < LAUNCH_COOLDOWN_MS) { world.launchWait = "cooldown"; return false; } // one coin per cooldown window
  if (launchEnabled() && world.treasury.realSol != null && world.treasury.realSol < MIN_LAUNCH_SOL) {
    if (!world.launchLowFundsNoted) { world.launchLowFundsNoted = true; pushTranscript(world, { kind: "system", text: `The crew is ready to launch ${p.name}, but the wallet has less than ${MIN_LAUNCH_SOL} SOL for fees.` }); }
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
    description: coinDescription(p),
    logoUrl: p.logoUrl || null,
    logoSource: p.logoSource || "generated",
    source: p.source || null,
    devBuySol: DEV_BUY_SOL,
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
      imageUrl = await pinataUpload(await squareLogo(await generateLogo(logoPrompt(world.plan))), "logo.png");
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
    pushTranscript(world, { kind: "system", text: `🚀 ${l.name} (${l.ticker}) is live on pump.fun: ${l.url}` });
    pushEvent(world, "launched", { mint: l.mint });
    if (l.devBuySol > 0) {
      await sleep(DEV_SELL_AFTER_MS);
      await sellDevBag(world, l, kp, 3);
    }
    await archiveLaunch(world);
  } catch (err) {
    l.status = "failed";
    l.error = err.message;
    pushTranscript(world, { kind: "system", text: `Launch failed: ${err.message}` });
  }
}

/** Sell the whole dev buy back into the bonding curve. Retries a few times (the token account can lag). */
async function sellDevBag(world, l, kp, attempts) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const before = await solBalance(kp.publicKey.toBase58());
      const r = await fetch(PUMPPORTAL, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ publicKey: kp.publicKey.toBase58(), action: "sell", mint: l.mint, amount: "100%", denominatedInSol: "false", slippage: 25, priorityFee: 0.0005, pool: "pump" }),
      });
      if (!r.ok) throw new Error(`PumpPortal ${r.status}: ${(await r.text()).slice(0, 160)}`);
      const sig = await signAndSend(await r.arrayBuffer(), [kp]);
      const after = await solBalance(kp.publicKey.toBase58()).catch(() => null);
      const back = before != null && after != null ? Number((after - before).toFixed(5)) : null;
      l.devSell = { status: "sold", sig, at: Date.now(), afterMs: l.launchedAt ? Date.now() - l.launchedAt : null, solBack: back };
      pushTranscript(world, { kind: "system", text: `💸 Dev buy of ${l.ticker} sold${l.devSell.afterMs ? ` ${Math.round(l.devSell.afterMs / 1000)}s after launch` : ""}${back != null ? `: ${back >= 0 ? "+" : ""}${back} SOL back` : ""} (tx ${sig.slice(0, 8)}…). The crew now holds none of it.` });
      pushEvent(world, "dev-sold", { mint: l.mint, solBack: back });
      return true;
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) await sleep(2500);
    }
  }
  l.devSell = { status: "pending", error: lastErr?.message, tries: (l.devSell?.tries || 0) + attempts };
  pushEvent(world, "dev-sell-error", { mint: l.mint, error: lastErr?.message });
  return false;
}

/** Retry dev-buy sells that failed at launch time (one attempt per tick, up to 10 tries). */
export async function retryDevSells(world) {
  if (!launchEnabled()) return;
  const open = (world.launches || []).filter((l) => l.devSell?.status === "pending" && (l.devSell.tries || 0) < 10);
  if (!open.length) return;
  const kp = await loadKeypair();
  for (const l of open.slice(0, 2)) await sellDevBag(world, l, kp, 1);
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
  pushTranscript(world, { kind: "system", text: `Back to the whiteboard: the crew starts planning coin #${next}. Next launch in about ${mins} minutes.` });
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
