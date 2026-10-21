// Launching the house's own coin on pump.fun through PumpPortal's local transaction API.
// Revenue model: creator fees only. The house never sells its own token.
// A launch needs the owner's approval (POST /api/admin action=approve-launch) and
// LAUNCH_ENABLED=1, TRADING_MODE=live, AGENT_WALLET_SECRET and PINATA_JWT.
import { loadKeypair, loadWeb3, signAndSend } from "./wallet.js";
import { pushTranscript, pushEvent } from "./state.js";

export const launchEnabled = () => process.env.LAUNCH_ENABLED === "1" && process.env.TRADING_MODE === "live" && !!process.env.PINATA_JWT && !!process.env.AGENT_WALLET_SECRET;

async function pinataUpload(blob, filename) {
  const form = new FormData();
  form.append("network", "public");
  form.append("file", blob, filename);
  const r = await fetch("https://uploads.pinata.cloud/v3/files", { method: "POST", headers: { authorization: `Bearer ${process.env.PINATA_JWT}` }, body: form });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.data?.cid) throw new Error(`Pinata upload failed: ${data.error?.message || r.status}`);
  return `https://ipfs.io/ipfs/${data.data.cid}`;
}

/** Propose a launch from the finished plan. The owner approves it afterwards. */
export function proposeLaunch(world) {
  const p = world.plan;
  if (!p.name || !p.ticker || !p.concept) return false;
  world.launch = {
    status: "proposed",
    proposedAt: Date.now(),
    name: p.name, ticker: p.ticker, description: `${p.tagline ? p.tagline + " — " : ""}${p.concept}`.slice(0, 500),
    logoUrl: p.logoUrl || null,
    devBuySol: Number(process.env.LAUNCH_DEV_BUY_SOL || 0),
  };
  pushTranscript(world, { kind: "system", text: `🚀 The team wants to launch ${p.name} ($${p.ticker}) on pump.fun. Waiting for the owner's approval.` });
  pushEvent(world, "launch-proposed");
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
