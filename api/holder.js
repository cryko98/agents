// POST /api/holder - holder login: a message signed with the wallet (Phantom) proves the address and
// a balance check proves it holds the project token. Returns a session for /api/tip.
// GET /api/holder - a recent blockhash, so the browser can build a SOL tip for Phantom to sign.
import { json, clientIp, readBody } from "../lib/http.js";
import { rateLimit } from "../lib/ratelimit.js";
import { verifySignature } from "../lib/poll.js";
import { HOLDER_TOKEN, tokenBalance, makeSession, isAddress } from "../lib/holders.js";
import { latestBlockhash } from "../lib/wallet.js";
import { holderLoginMessage } from "../shared/holders.js";

export default async function handler(req, res) {
  if (req.method === "GET") {
    try { return json(res, 200, { blockhash: (await latestBlockhash())?.blockhash || null }); }
    catch (err) { return json(res, 502, { error: err.message }); }
  }
  if (req.method !== "POST") return json(res, 405, { error: "GET or POST" });
  const rl = rateLimit(`holder:${clientIp(req)}`, 10, 10 * 60 * 1000);
  if (!rl.ok) return json(res, 429, { error: `Slow down, try again in ${rl.retryAfter}s` });
  if (!HOLDER_TOKEN.mint) return json(res, 403, { error: `Holder chat opens once $${HOLDER_TOKEN.symbol} is live` });
  const body = await readBody(req);
  const address = String(body.address || "").trim(), ts = Number(body.ts);
  if (!isAddress(address)) return json(res, 400, { error: "Invalid wallet address" });
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > 10 * 60_000) return json(res, 400, { error: "Signature expired, try again" });
  if (!verifySignature(address, holderLoginMessage(address, ts), String(body.signature || ""))) return json(res, 401, { error: "Signature check failed" });
  let held;
  try { held = await tokenBalance(address, HOLDER_TOKEN.mint); } catch (err) { return json(res, 502, { error: `Balance check failed: ${err.message}` }); }
  if (held < HOLDER_TOKEN.minHold) return json(res, 403, { error: `Only $${HOLDER_TOKEN.symbol} holders can message the crew (this wallet holds ${held}).`, held });
  try { return json(res, 200, { ok: true, session: makeSession(address), address, held }); }
  catch (err) { return json(res, 503, { error: err.message }); }
}
