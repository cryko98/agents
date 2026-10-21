// Holder vote on the next coin. Opens when the crew has 2+ candidates, closes after POLL_MINUTES.
// Votes are signed with a Solana wallet (Phantom); holders of the crew's coins get extra weight.
import crypto from "node:crypto";
import bs58 from "bs58";
import { db } from "./db.js";
import { pushTranscript } from "./state.js";
import { RPC_URL } from "./wallet.js";
import { voteMessage } from "../shared/poll.js";

export const POLL_MS = Number(process.env.POLL_MINUTES || 45) * 60_000;
// Off by default: the crew picks and launches coins on its own. POLL_ENABLED=1 brings the vote back.
export const POLL_ENABLED = process.env.POLL_ENABLED === "1";
const votesKey = (id) => `ah:poll:${id}`;

export function ensurePlanId(plan) {
  if (!plan.id) plan.id = `plan-${Date.now().toString(36)}`;
  return plan.id;
}

/** Vote first: the crew may not pick the final name until holders voted on the candidates. */
export function voteGate(world) {
  if (!POLL_ENABLED) return false;
  const p = world.plan, poll = world.poll;
  if (poll && p.id && poll.planId === p.id) return poll.status === "open";
  return Array.isArray(p.candidates) && p.candidates.length >= 2 && !p.name;
}

export function maybeOpenPoll(world) {
  const p = world.plan;
  ensurePlanId(p);
  if (!POLL_ENABLED) { world.poll = null; return; }
  if (world.poll?.planId === p.id) return;
  if (p.stage !== "concept" || p.name || !Array.isArray(p.candidates) || p.candidates.length < 2) return;
  const now = Date.now();
  world.poll = { id: `poll-${now.toString(36)}`, planId: p.id, options: p.candidates.slice(0, 4), openedAt: now, closesAt: now + POLL_MS, status: "open", tally: [], voters: 0, winner: null };
  pushTranscript(world, { kind: "system", text: `🗳️ Holder vote is open for ${Math.round(POLL_MS / 60_000)} minutes: which coin should the crew cook next? Vote in the Coin Lab.` });
}

export async function updatePoll(world) {
  const poll = world.poll;
  if (!poll || poll.status !== "open") return;
  const raw = (await db().hgetall(votesKey(poll.id))) || {};
  const tally = poll.options.map(() => ({ votes: 0, weight: 0 }));
  for (const v of Object.values(raw)) {
    try { const x = typeof v === "string" ? JSON.parse(v) : v; if (tally[x.option]) { tally[x.option].votes++; tally[x.option].weight += x.weight || 1; } } catch { /* skip bad entry */ }
  }
  poll.tally = tally;
  poll.voters = Object.keys(raw).length;
  if (Date.now() < poll.closesAt) return;
  poll.status = "closed";
  let best = -1, bestW = 0;
  tally.forEach((t, i) => { if (t.weight > bestW) { best = i; bestW = t.weight; } });
  poll.winner = best >= 0 ? best : null;
  pushTranscript(world, { kind: "system", text: poll.winner != null
    ? `🗳️ Holders voted: "${poll.options[best]}" wins (${tally[best].votes} votes, weight ${tally[best].weight}). The crew builds that one.`
    : "🗳️ The vote closed with no votes. The crew decides on its own." });
}

export function pollBlock(world) {
  const poll = world.poll;
  if (!poll || poll.planId !== world.plan.id) return "";
  const opts = poll.options.map((o, i) => `${i + 1}. ${o} — ${poll.tally?.[i]?.votes || 0} votes (weight ${poll.tally?.[i]?.weight || 0})`).join("\n");
  if (poll.status === "open") {
    const mins = Math.max(0, Math.round((poll.closesAt - Date.now()) / 60_000));
    return `HOLDER VOTE (open, closes in ${mins} min, ${poll.voters} voters):\n${opts}\nDo NOT pick the final name yet. Debate the options, campaign for favorites, remind viewers to vote.`;
  }
  return poll.winner != null
    ? `HOLDER VOTE RESULT: "${poll.options[poll.winner]}" won.\n${opts}\nBuild the coin around the winner (refine it freely) unless it breaks the rules.`
    : `HOLDER VOTE RESULT: no votes. The crew picks.\n${opts}`;
}

// ---------- vote verification ----------
const SPKI_ED25519 = Buffer.from("302a300506032b6570032100", "hex");

export function verifySignature(address, message, signatureB64) {
  try {
    const pub = Buffer.from(bs58.decode(address));
    if (pub.length !== 32) return false;
    const key = crypto.createPublicKey({ key: Buffer.concat([SPKI_ED25519, pub]), format: "der", type: "spki" });
    return crypto.verify(null, Buffer.from(message, "utf8"), key, Buffer.from(signatureB64, "base64"));
  } catch {
    return false;
  }
}

/** 1 vote for anyone, x3 for holders of any crew coin, x10 for 1M+ tokens (0.1% of supply). */
export async function voteWeight(address, mints) {
  let held = 0;
  for (const mint of mints) {
    try {
      const r = await fetch(RPC_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTokenAccountsByOwner", params: [address, { mint }, { encoding: "jsonParsed" }] }) });
      const accounts = (await r.json())?.result?.value || [];
      for (const a of accounts) held += Number(a.account?.data?.parsed?.info?.tokenAmount?.uiAmount || 0);
    } catch { /* RPC hiccup: count as not holding */ }
  }
  return { weight: held >= 1_000_000 ? 10 : held > 0 ? 3 : 1, held };
}

export async function recordVote(poll, address, option, weight) {
  await db().hset(votesKey(poll.id), { [address]: JSON.stringify({ option, weight, t: Date.now() }) });
}

export { voteMessage };
