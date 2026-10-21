// Launching the crew's own coin on pump.fun through PumpPortal's local transaction API.
// Revenue model: creator fees only. The crew never sells its own token.
// By default the launch goes out automatically once the plan is launch-ready
// (LAUNCH_APPROVAL=owner makes it wait for POST /api/admin action=approve-launch).
// A real launch needs LAUNCH_ENABLED=1, AGENT_WALLET_SECRET and PINATA_JWT (any trading mode).
import { loadKeypair, loadWeb3, signAndSend } from "./wallet.js";
import { pushTranscript, pushEvent } from "./state.js";

// A real launch is independent of the trading mode: the crew can launch its coin from the real
// wallet while trades are still paper. Needs LAUNCH_ENABLED=1, the wallet secret and a Pinata key.
export const launchEnabled = () => process.env.LAUNCH_ENABLED === "1" && !!process.env.PINATA_JWT && !!process.env.AGENT_WALLET_SECRET;

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

export const launchNeedsOwner = () => process.env.LAUNCH_APPROVAL === "owner";

/** Queue a launch from the finished plan. Auto-approved unless LAUNCH_APPROVAL=owner. */
export function proposeLaunch(world) {
  const p = world.plan;
  if (!p.name || !p.ticker || !p.concept) return false;
  const auto = !launchNeedsOwner();
  world.launch = {
    status: auto ? "approved" : "proposed",
    proposedAt: Date.now(),
    approvedAt: auto ? Date.now() : null,
    name: p.name, ticker: p.ticker, description: `${p.tagline ? p.tagline + " — " : ""}${p.concept}`.slice(0, 500),
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
    const metadata = { name: l.name, symbol: l.ticker, description: l.description, image: imageUrl || "", website: process.env.SITE_URL || "" };
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
  } catch (err) {
    l.status = "failed";
    l.error = err.message;
    pushTranscript(world, { kind: "system", text: `Launch failed: ${err.message}` });
  }
}

/** Claim accrued creator fees (live mode). pump.fun pays all coins' fees at once. */
export async function collectCreatorFees(world) {
  const l = world.launch;
  if (l.status !== "launched" || !launchEnabled()) return;
  if (Date.now() - (l.lastClaimAt || 0) < 6 * 3_600_000) return;
  l.lastClaimAt = Date.now();
  try {
    const kp = await loadKeypair();
    const r = await fetch("https://pumpportal.fun/api/trade-local", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ publicKey: kp.publicKey.toBase58(), action: "collectCreatorFee", priorityFee: 0.000001 }),
    });
    if (!r.ok) throw new Error(`PumpPortal ${r.status}`);
    const sig = await signAndSend(await r.arrayBuffer(), [kp]);
    pushTranscript(world, { kind: "system", text: `💰 Creator fees claimed (tx ${sig.slice(0, 8)}…).` });
  } catch (err) {
    pushEvent(world, "claim-error", { error: err.message });
  }
}
