// Paid orders: a viewer picks something in the shop and gets an exact SOL amount to pay (the price
// plus a few millionths that tag the order), payable from any wallet. The payment is matched by that
// exact amount: right away when the browser sends the transaction signature, or later by the wallet
// scanner. Paid orders become fun interactions (a scene + an effect in the house) or billboard time.
import { db } from "./db.js";
import { pushTranscript, pushEvent, SEEN_SIGS_KEY } from "./state.js";
import { transferDetails, sendSol, short } from "./wallet.js";
import { interactionById, BILLBOARD_MAX_AHEAD_H } from "../shared/shop.js";

const ORDERS_KEY = "ah:shop:orders", PAID_KEY = "ah:shop:paid", USED_KEY = "ah:shop:sigs";
export const ORDER_MS = 30 * 60_000; // pay within 30 minutes
const LAMPORTS = 1_000_000_000;
const MAX_TRIES = 3;                 // an interaction whose scene can't be written is refunded after this

const parse = (v) => { try { return typeof v === "string" ? JSON.parse(v) : v; } catch { return null; } };

export function ensureShop(world) {
  world.shop ||= { queue: [], recent: [] };
  world.billboard ||= { current: null, queue: [], history: [] };
  world.effects ||= [];
  return world.shop;
}

/** Pending orders; expired ones are dropped on the way. */
async function pendingOrders() {
  const raw = (await db().hgetall(ORDERS_KEY)) || {};
  const now = Date.now(), out = [], dead = [];
  for (const [id, v] of Object.entries(raw)) {
    const o = parse(v);
    if (!o || (o.status === "pending" && now > o.expiresAt + 10 * 60_000) || (o.status !== "pending" && now - o.createdAt > 24 * 3_600_000)) dead.push(id);
    else if (o.status === "pending") out.push(o);
  }
  if (dead.length) await db().hdel(ORDERS_KEY, ...dead);
  return out;
}

export async function getOrder(id) { return parse(await db().hget(ORDERS_KEY, String(id))); }
const saveOrder = (o) => db().hset(ORDERS_KEY, { [o.id]: JSON.stringify(o) });

/** A new order with its exact, unique amount. */
export async function createOrder(kind, params, price) {
  const used = new Set((await pendingOrders()).map((o) => o.tag));
  let tag = null;
  for (let i = 0; i < 60 && !tag; i++) { const t = 1 + Math.floor(Math.random() * 999); if (!used.has(t)) tag = t; }
  if (!tag) throw new Error("The shop is busy, try again in a minute");
  const lamports = Math.round(price * LAMPORTS) + tag * 1000;
  const now = Date.now();
  const order = { id: `o${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`, kind, params, price, tag, lamports, amount: lamports / LAMPORTS, createdAt: now, expiresAt: now + ORDER_MS, status: "pending" };
  await saveOrder(order);
  return order;
}

async function markPaid(order, d) {
  if (!(await db().sadd(USED_KEY, d.sig))) return null; // this transaction already paid for something
  await db().sadd(SEEN_SIGS_KEY, d.sig);                 // and it isn't a tip
  Object.assign(order, { status: "paid", payer: d.from, sig: d.sig, paidAt: Date.now() });
  await saveOrder(order);
  await db().rpush(PAID_KEY, JSON.stringify(order));
  return order;
}

/** The browser paid with Phantom and sends the signature: check it and mark the order paid. */
export async function confirmOrder(id, sig, wallet) {
  const order = await getOrder(id);
  if (!order) throw new Error("Unknown order");
  if (order.status === "paid") return order;
  if (!wallet) throw new Error("The crew wallet isn't configured");
  let d = null;
  for (let i = 0; i < 4 && !d; i++) { // the RPC may need a moment to see the transaction
    d = await transferDetails(sig, wallet).catch(() => null);
    if (!d) await new Promise((r) => setTimeout(r, 2500));
  }
  if (!d) throw new Error("The payment isn't visible on Solana yet. It is matched automatically within a few minutes.");
  if (d.lamports !== order.lamports) throw new Error(`That transaction sent ${d.sol} SOL, the order needs exactly ${order.amount} SOL`);
  if (d.t && (d.t < order.createdAt - 60_000 || d.t > order.expiresAt)) throw new Error("That transaction is outside the order's time window");
  const paid = await markPaid(order, d);
  if (!paid) throw new Error("That transaction was already used");
  return paid;
}

/** Wallet scanner: an incoming transfer with an order's exact amount pays that order. */
export async function claimTransfer(d) {
  if (!d?.lamports) return null;
  const order = (await pendingOrders()).find((o) => o.lamports === d.lamports && (!d.t || (d.t >= o.createdAt - 60_000 && d.t <= o.expiresAt)));
  return order ? markPaid(order, d) : null;
}

/** Every tick: move paid orders into the world (interaction queue / billboard slots). */
export async function drainPaid(world) {
  const shop = ensureShop(world);
  const raw = await db().lrange(PAID_KEY, 0, -1);
  if (!raw?.length) return;
  await db().del(PAID_KEY);
  for (const v of raw) {
    const o = parse(v);
    if (!o) continue;
    if (o.kind === "billboard") { bookBillboard(world, o); continue; }
    const item = interactionById[o.kind];
    if (!item) continue;
    shop.queue.push({ id: o.id, kind: o.kind, label: item.label, by: o.payer, params: o.params, price: o.amount, sig: o.sig, paidAt: o.paidAt, tries: 0 });
    pushTranscript(world, { kind: "system", text: `🎉 ${short(o.payer)} bought a ${item.label.toLowerCase()} for the crew${shop.queue.length > 1 ? ` (#${shop.queue.length} in line)` : ""}. Coming up!` });
    pushEvent(world, "shop", { kind: o.kind, sol: o.amount });
  }
}

/** The next interaction to play, if any. */
export function nextInteraction(world) { return ensureShop(world).queue[0] || null; }

/** It played: remember it for the shop's "recently" strip. */
export function finishInteraction(world, item) {
  const shop = ensureShop(world);
  shop.queue = shop.queue.filter((q) => q.id !== item.id);
  shop.recent = [{ kind: item.kind, label: item.label, by: item.by, at: Date.now() }, ...shop.recent].slice(0, 8);
}

/** Claude couldn't write the scene: try again later, refund after a few attempts. */
export async function failInteraction(world, item, error) {
  item.tries = (item.tries || 0) + 1;
  item.error = String(error || "").slice(0, 120);
  if (item.tries < MAX_TRIES) return;
  const shop = ensureShop(world);
  shop.queue = shop.queue.filter((q) => q.id !== item.id);
  try {
    const sig = await sendSol([{ to: item.by, sol: item.price }]);
    pushTranscript(world, { kind: "system", text: `The crew couldn't pull off the ${item.label.toLowerCase()} for ${short(item.by)}, so the ${item.price} SOL went back (tx ${sig.slice(0, 8)}…).` });
  } catch (err) {
    pushEvent(world, "refund-error", { id: item.id, error: err.message });
    pushTranscript(world, { kind: "system", text: `The ${item.label.toLowerCase()} for ${short(item.by)} failed and the refund is pending; the owner will send it back.` });
  }
}

// ---------------- billboard ----------------
function bookBillboard(world, o) {
  const b = world.billboard;
  const now = Date.now();
  const lastEnd = Math.max(now, b.current?.until || 0, ...b.queue.map((q) => q.until));
  const ms = o.params.hours * 3_600_000;
  const ad = { id: o.id, by: o.payer, ...o.params.ad, hours: o.params.hours, price: o.amount, startsAt: lastEnd, until: lastEnd + ms, sig: o.sig };
  b.queue.push(ad);
  const wait = Math.round((ad.startsAt - now) / 60_000);
  pushTranscript(world, { kind: "system", text: `📣 ${short(o.payer)} rented the garden billboard for ${o.params.hours}h${wait > 1 ? `, it goes up in ${wait >= 90 ? `${Math.round(wait / 60)}h` : `${wait} min`}` : ""}.` });
}

/** When the next free slot starts (for the rent form). */
export function billboardFreeAt(world) {
  const b = world.billboard || { queue: [] };
  return Math.max(Date.now(), b.current?.until || 0, ...(b.queue || []).map((q) => q.until));
}
export const billboardFull = (world) => billboardFreeAt(world) - Date.now() > BILLBOARD_MAX_AHEAD_H * 3_600_000;

/** Every tick: rotate the board. */
export function updateBillboard(world) {
  const b = ensureShop(world) && world.billboard, now = Date.now();
  if (b.current && now >= b.current.until) { b.history = [b.current, ...b.history].slice(0, 10); b.current = null; }
  if (!b.current && b.queue[0] && b.queue[0].startsAt <= now + 5000) {
    b.current = b.queue.shift();
    const a = b.current;
    const what = a.type === "x" ? `@${a.handle}` : a.headline ? `"${a.headline}"` : "an image";
    pushTranscript(world, { kind: "system", text: `📣 New on the garden billboard: ${what} (sponsored by ${short(a.by)}, ${a.hours}h). Click the board for details.` });
  }
  world.effects = (world.effects || []).filter((e) => e.until > now);
}

/** Owner removes the current ad (admin). */
export function removeBillboardAd(world, id) {
  const b = world.billboard;
  if (!b) return false;
  if (b.current?.id === id || (!id && b.current)) { b.history = [{ ...b.current, removed: true }, ...b.history].slice(0, 10); b.current = null; return true; }
  const n = b.queue.length;
  b.queue = b.queue.filter((q) => q.id !== id);
  return b.queue.length !== n;
}
