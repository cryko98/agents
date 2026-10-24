// Holder chat: only holders of the project token (PROJECT_TOKEN_MINT) can message the crew.
// A holder signs a login message once; the API checks the signature and the token balance and hands
// back a session (HMAC, 24h). Every message re-checks the balance, so selling the token ends the chat.
import crypto from "node:crypto";
import { RPC_URL } from "./wallet.js";

export const HOLDER_TOKEN = {
  mint: (process.env.PROJECT_TOKEN_MINT || "").trim() || null,
  symbol: (process.env.PROJECT_TOKEN_SYMBOL || "COOKERS").trim().replace(/^\$/, ""),
  minHold: Number(process.env.PROJECT_TOKEN_MIN_HOLD || 1),
};
const SECRET = process.env.SESSION_SECRET || process.env.ADMIN_TOKEN || process.env.TICK_SECRET || "";
const SESSION_MS = 24 * 3_600_000;

export const isAddress = (a) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(a || ""));

/** UI amount of `mint` the wallet holds (all its token accounts for that mint). */
export async function tokenBalance(address, mint) {
  const r = await fetch(RPC_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTokenAccountsByOwner", params: [address, { mint }, { encoding: "jsonParsed", commitment: "confirmed" }] }) });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return (j.result?.value || []).reduce((s, a) => s + Number(a.account?.data?.parsed?.info?.tokenAmount?.uiAmount || 0), 0);
}

const mac = (s) => crypto.createHmac("sha256", SECRET).update(s).digest("base64url");

export function makeSession(address) {
  if (!SECRET) throw new Error("SESSION_SECRET is not configured");
  const exp = Date.now() + SESSION_MS;
  return `${address}.${exp}.${mac(`${address}.${exp}`)}`;
}

/** The wallet address a valid session belongs to, else null. */
export function readSession(token) {
  if (!SECRET || typeof token !== "string") return null;
  const [address, exp, sig] = token.split(".");
  if (!isAddress(address) || !(Number(exp) > Date.now()) || !sig) return null;
  const want = Buffer.from(mac(`${address}.${exp}`)), got = Buffer.from(sig);
  return want.length === got.length && crypto.timingSafeEqual(want, got) ? address : null;
}
