// POST /api/vote - a holder votes on the next coin. The vote is a message signed with the
// holder's Solana wallet (Phantom), so one wallet = one vote; crew-coin holders weigh more.
import { json, clientIp, readBody } from "../lib/http.js";
import { rateLimit } from "../lib/ratelimit.js";
import { getJSON } from "../lib/db.js";
import { WORLD_KEY } from "../lib/state.js";
import { verifySignature, voteWeight, recordVote, voteMessage } from "../lib/poll.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "POST only" });
  const rl = rateLimit(`vote:${clientIp(req)}`, 10, 10 * 60 * 1000);
  if (!rl.ok) return json(res, 429, { error: `Slow down, try again in ${rl.retryAfter}s` });
  const body = await readBody(req);
  const address = String(body.address || "").trim();
  const option = Number(body.option);
  const ts = Number(body.ts);
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return json(res, 400, { error: "Invalid wallet address" });
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > 10 * 60_000) return json(res, 400, { error: "Signature expired, try again" });

  const world = await getJSON(WORLD_KEY);
  const poll = world?.poll;
  if (!poll || poll.id !== body.pollId) return json(res, 404, { error: "This vote is no longer open" });
  if (poll.status !== "open" || Date.now() >= poll.closesAt) return json(res, 409, { error: "The vote has closed" });
  if (!Number.isInteger(option) || option < 0 || option >= poll.options.length) return json(res, 400, { error: "Invalid option" });

  const message = voteMessage(poll.id, option, address, ts);
  if (!verifySignature(address, message, String(body.signature || ""))) return json(res, 401, { error: "Signature check failed" });

  const mints = (world.launches || []).filter((l) => l.status === "launched" && l.mint).map((l) => l.mint);
  const { weight, held } = await voteWeight(address, mints);
  await recordVote(poll, address, option, weight);
  return json(res, 200, { ok: true, option, weight, held });
}
