// Wallet side of the site (Phantom): holders sign a login message once to chat with the crew,
// and anyone can send SOL to the crew wallet as a tip or to back an open ask.
import { holderLoginMessage } from "../shared/holders.js";

const KEY = "cookers.holder";
const WEB3 = "https://cdn.jsdelivr.net/npm/@solana/web3.js@1.98.0/+esm"; // loaded only when someone sends SOL

export const phantom = () => (window.phantom?.solana?.isPhantom ? window.phantom.solana : window.solana?.isPhantom ? window.solana : null);

function load() {
  try {
    const h = JSON.parse(localStorage.getItem(KEY) || "null");
    if (h?.session && Number(h.session.split(".")[1]) > Date.now()) return h;
  } catch { /* private mode */ }
  return null;
}
let current = load();
export const currentHolder = () => current;

function save(h) {
  current = h;
  try { h ? localStorage.setItem(KEY, JSON.stringify(h)) : localStorage.removeItem(KEY); } catch { /* private mode */ }
}
export const holderLogout = () => save(null);

async function post(url, body) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const err = new Error(data.error || `request failed (${res.status})`); err.relogin = !!data.relogin; throw err; }
  return data;
}

/** Connect Phantom, sign the login message, let the API check the token balance. */
export async function holderLogin() {
  const p = phantom();
  if (!p) throw new Error("Install Phantom to connect your wallet");
  const { publicKey } = await p.connect();
  const address = publicKey.toString(), ts = Date.now();
  const signed = await p.signMessage(new TextEncoder().encode(holderLoginMessage(address, ts)), "utf8");
  const signature = btoa(String.fromCharCode(...(signed.signature || signed)));
  const data = await post("/api/holder", { address, ts, signature });
  save({ address, session: data.session, held: data.held });
  return current;
}

export async function sendHolderMessage(text) {
  if (!current) throw new Error("Connect your wallet first");
  try { return await post("/api/tip", { text, session: current.session }); }
  catch (err) { if (err.relogin) save(null); throw err; }
}

let web3 = null;
/** Build a plain SOL transfer to the crew wallet and let Phantom sign and send it. Returns the signature. */
export async function sendSol(to, sol) {
  const p = phantom();
  if (!p) throw new Error("Install Phantom to send SOL, or copy the address into your wallet");
  if (!(sol > 0)) throw new Error("Enter an amount");
  const { publicKey } = await p.connect();
  web3 ||= await import(WEB3);
  const { Transaction, SystemProgram, PublicKey, LAMPORTS_PER_SOL } = web3;
  const { blockhash } = await (await fetch("/api/holder")).json();
  if (!blockhash) throw new Error("Couldn't reach Solana, try again");
  const from = new PublicKey(publicKey.toString());
  const tx = new Transaction({ feePayer: from, recentBlockhash: blockhash })
    .add(SystemProgram.transfer({ fromPubkey: from, toPubkey: new PublicKey(to), lamports: Math.round(sol * LAMPORTS_PER_SOL) }));
  const { signature } = await p.signAndSendTransaction(tx);
  return signature;
}
