// Launching the crew's own coins on pump.fun through PumpPortal's local transaction API.
// Revenue model: creator fees only. The crew never sells its own tokens.
// By default a launch goes out automatically once the plan is launch-ready
// (LAUNCH_APPROVAL=owner makes it wait for POST /api/admin action=approve-launch).
// A real launch needs LAUNCH_ENABLED=1, AGENT_WALLET_SECRET and PINATA_JWT (any trading mode).
// After a launch the coin moves to world.launches and the crew starts planning the next one.
import { loadKeypair, loadWeb3, signAndSend, publicAddress, RPC_URL } from "./wallet.js";
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
export const LAUNCH_COOLDOWN_MS = Number(process.env.LAUNCH_COOLDOWN_MIN || 12) * 60_000; // a new coin every ~12 minutes
const MIN_LAUNCH_SOL = Number(process.env.MIN_LAUNCH_SOL || 0.03);

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
  const head = "🤖 Launched 100% autonomously by the Cookers: six AI agents who browsed the web for the trend, picked the idea, named it, drew the logo and launched this coin themselves. No human in the loop from A to Z.";
  const body = [plan.tagline, plan.concept].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  const tail = page ? ` The full birth record (research, meetings, holder vote): ${page}` : "";
  const room = 900 - head.length - tail.length - 2;
  return `${head} ${body.length > room ? body.slice(0, room - 1) + "…" : body}${tail}`;
}

/** Queue a launch from the finished plan. Auto-approved unless LAUNCH_APPROVAL=owner. */
export function proposeLaunch(world) {
  const p = world.plan;
  if (!p.name || !p.ticker || !p.concept) return false;
  // every coin gets its own ticker (the birth-record pages are keyed by it)
  const used = new Set((world.launches || []).map((l) => l.ticker));
  if (used.has(p.ticker)) { let n = 2; while (used.has(`${p.ticker.slice(0, 7)}${n}`)) n++; p.ticker = `${p.ticker.slice(0, 7)}${n}`; }
  const last = world.launches?.[0]?.launchedAt || 0;
  if (Date.now() - last < LAUNCH_COOLDOWN_MS) return false; // one coin per cooldown window
  if (launchEnabled() && world.treasury.realSol != null && world.treasury.realSol < MIN_LAUNCH_SOL) {
    if (!world.launchLowFundsNoted) { world.launchLowFundsNoted = true; pushTranscript(world, { kind: "system", text: `The crew is ready to launch ${p.name}, but the wallet has less than ${MIN_LAUNCH_SOL} SOL for fees.` }); }
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
    devBuySol: Number(process.env.LAUNCH_DEV_BUY_SOL || 0),
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
    let imageUrl = l.logoUrl;
    if (imageUrl) {
      const img = await fetch(imageUrl);
      imageUrl = await pinataUpload(await img.blob(), "logo.png");
    }
    const metadata = { name: l.name, symbol: l.ticker, description: l.description || coinDescription(l), image: imageUrl || "", website: coinPage(l.ticker) || process.env.SITE_URL || "" };
    const uri = await pinataUpload(new Blob([JSON.stringify(metadata)], { type: "application/json" }), "metadata.json");
    const r = await fetch("https://pumpportal.fun/api/trade-local", {
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
    await archiveLaunch(world);
  } catch (err) {
    l.status = "failed";
    l.error = err.message;
    pushTranscript(world, { kind: "system", text: `Launch failed: ${err.message}` });
  }
}

/** Move a finished launch into the history, save its birth record and send the crew back to the whiteboard. */
export async function archiveLaunch(world) {
  const l = world.launch;
  if (!["launched", "simulated"].includes(l.status)) return;
  const p = world.plan, poll = world.poll?.planId && world.poll.planId === p.id ? world.poll : null;
  const record = {
    ...l,
    page: coinPage(l.ticker) || null,
    plan: { theme: p.theme, candidates: p.candidates, tagline: p.tagline, concept: p.concept, tokenomics: p.tokenomics, roadmap: p.roadmap, notes: p.notes, logoPrompt: p.logoPrompt },
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
    const r = await fetch("https://pumpportal.fun/api/trade-local", {
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
