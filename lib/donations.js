// Holder support: scan the crew wallet for incoming SOL and keep a wall of fame.
// Donations are gifts. Perks are non-financial (a thank-you, a name on the wall, a Pixel artwork).
import { db } from "./db.js";
import { SEEN_SIGS_KEY, pushTranscript, pushEvent } from "./state.js";
import { incomingTransfers, transferDetails, solBalance, short } from "./wallet.js";
import { creditTransfer } from "./backing.js";
import { byId } from "../shared/roster.js";

export const PERKS = [
  { minSol: 0.01, label: "Your name on the Wall of Fame and a thank-you from the team" },
  { minSol: 0.05, label: "The agents react to your message in their next conversation" },
  { minSol: 0.2, label: "Pixel paints you a custom artwork (request it below)" },
];

export async function scanDonations(world) {
  const address = world.donations.address;
  if (!address) return;
  const now = Date.now();
  if (now - (world.donations.lastScanAt || 0) < 60_000) return;
  world.donations.lastScanAt = now;
  try {
    world.treasury.realSol = await solBalance(address); // the real wallet is shown in both modes
    const recent = await incomingTransfers(address, { limit: 12 });
    for (const r of recent) {
      if (await db().sismember(SEEN_SIGS_KEY, r.sig)) continue;
      await db().sadd(SEEN_SIGS_KEY, r.sig);
      const d = await transferDetails(r.sig, address).catch(() => null);
      if (!d || d.selfPaid || d.sol < 0.001) continue;
      // while a backing ask is open, incoming SOL backs it (up to the target); the rest is a tip
      const backed = creditTransfer(world, d);
      const entry = { sig: d.sig, from: d.from, sol: Number(d.sol.toFixed(4)), t: d.t || now, credits: Math.floor(d.sol / 0.2), backed: backed || undefined };
      world.donations.wall.unshift(entry);
      world.donations.wall.splice(60);
      world.donations.totalSol = Number((world.donations.totalSol + entry.sol).toFixed(4));
      const ask = world.asks?.current;
      pushTranscript(world, { kind: "system", text: backed > 0
        ? `🤝 ${short(d.from)} backed ${byId[ask.by]?.name || "the crew"}'s ask with ${backed} SOL (${ask.raised} / ${ask.amountSol} SOL).${entry.sol - backed >= 0.001 ? ` Plus a ${Number((entry.sol - backed).toFixed(4))} SOL tip.` : ""} Thank you!`
        : `💛 ${short(d.from)} tipped the crew ${entry.sol} SOL. It goes straight into the wallet that funds the launches. Thank you!` });
      pushEvent(world, "donation", { from: d.from, sol: entry.sol });
      world.pendingThanks = [...(world.pendingThanks || []), { from: short(d.from), sol: entry.sol }].slice(-3);
    }
  } catch (err) {
    pushEvent(world, "donation-scan-error", { error: err.message });
  }
}

/** Does this address still have an unused artwork credit? */
export function artworkCredits(world, address) {
  const earned = world.donations.wall.filter((d) => d.from === address).reduce((s, d) => s + (d.credits || 0), 0);
  const used = world.perks.gallery.filter((g) => g.by === address).length + world.perks.pending.filter((p) => p.by === address).length;
  return earned - used;
}
