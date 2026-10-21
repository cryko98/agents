// The house wallet. The secret key never leaves the server; the public address is shown on the site.
// Live mode needs AGENT_WALLET_SECRET (base58). Paper mode only needs AGENT_WALLET_PUBLIC for donations.
// @solana/web3.js is loaded lazily: paper mode and the read-only RPC helpers never need it.
import bs58 from "bs58";

export const RPC_URL = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
const LAMPORTS = 1_000_000_000;

let web3 = null;
export async function loadWeb3() {
  if (!web3) web3 = await import("@solana/web3.js");
  return web3;
}

let keypair = null;
export async function loadKeypair() {
  if (keypair) return keypair;
  const secret = process.env.AGENT_WALLET_SECRET;
  if (!secret) return null;
  try {
    const { Keypair } = await loadWeb3();
    const bytes = secret.trim().startsWith("[") ? Uint8Array.from(JSON.parse(secret)) : bs58.decode(secret.trim());
    keypair = Keypair.fromSecretKey(bytes);
    return keypair;
  } catch (err) {
    console.error("AGENT_WALLET_SECRET is not a valid key:", err.message);
    return null;
  }
}

/** Public address without touching web3: derived from AGENT_WALLET_PUBLIC, or from the secret's last 32 bytes. */
export function publicAddress() {
  if (process.env.AGENT_WALLET_PUBLIC) return process.env.AGENT_WALLET_PUBLIC.trim();
  const secret = process.env.AGENT_WALLET_SECRET;
  if (!secret) return null;
  try {
    const bytes = secret.trim().startsWith("[") ? Uint8Array.from(JSON.parse(secret)) : bs58.decode(secret.trim());
    return bytes.length === 64 ? bs58.encode(bytes.slice(32)) : null;
  } catch { return null; }
}

export async function connection() {
  const { Connection } = await loadWeb3();
  return new Connection(RPC_URL, "confirmed");
}

async function rpc(method, params) {
  const r = await fetch(RPC_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const data = await r.json();
  if (data.error) throw new Error(`${method}: ${data.error.message}`);
  return data.result;
}

export async function solBalance(address) {
  const res = await rpc("getBalance", [address, { commitment: "confirmed" }]);
  return (res?.value ?? 0) / LAMPORTS;
}

/** Recent transaction signatures involving `address`, newest first. */
export async function incomingTransfers(address, { limit = 15 } = {}) {
  const sigs = await rpc("getSignaturesForAddress", [address, { limit }]);
  return (sigs || []).filter((s) => !s.err).map((s) => ({ sig: s.signature, t: (s.blockTime || 0) * 1000 }));
}

export async function transferDetails(sig, address) {
  const tx = await rpc("getTransaction", [sig, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" }]);
  if (!tx?.meta || !tx.transaction?.message) return null;
  const keys = tx.transaction.message.accountKeys.map((k) => (typeof k === "string" ? k : k.pubkey));
  const idx = keys.indexOf(address);
  if (idx < 0) return null;
  const delta = (tx.meta.postBalances[idx] - tx.meta.preBalances[idx]) / LAMPORTS;
  const payer = keys[0];
  return { sig, from: payer, sol: delta, t: (tx.blockTime || 0) * 1000, selfPaid: payer === address };
}

/** Deserialize, sign and send a transaction (base64 or raw bytes). Returns the signature. */
export async function signAndSend(serialized, signers) {
  const { VersionedTransaction } = await loadWeb3();
  const bytes = typeof serialized === "string" ? Buffer.from(serialized, "base64") : new Uint8Array(serialized);
  const tx = VersionedTransaction.deserialize(bytes);
  tx.sign(signers);
  const conn = await connection();
  const sig = await conn.sendRawTransaction(tx.serialize(), { maxRetries: 2, skipPreflight: false });
  await conn.confirmTransaction(sig, "confirmed");
  return sig;
}

export function short(addr) {
  return addr ? `${addr.slice(0, 4)}…${addr.slice(-4)}` : "";
}
