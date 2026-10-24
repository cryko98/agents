// /api/shop - fun interactions and garden billboard time, paid in SOL.
//   POST {op:"order", kind, ...}  -> an order with the exact SOL amount to pay (billboard ads are reviewed first)
//   POST {op:"confirm", id, sig}  -> the browser paid: check the transaction, mark the order paid
//   GET ?id=<order>               -> order status (payments from other wallets are matched by the scanner)
import { json, clientIp, readBody } from "../lib/http.js";
import { rateLimit } from "../lib/ratelimit.js";
import { getJSON } from "../lib/db.js";
import { WORLD_KEY } from "../lib/state.js";
import { publicAddress } from "../lib/wallet.js";
import { createOrder, confirmOrder, getOrder, billboardFull, billboardFreeAt } from "../lib/shop.js";
import { moderateAd } from "../lib/moderate.js";
import { pinataUpload } from "../lib/launch.js";
import { AGENT_IDS } from "../shared/roster.js";
import { interactionById, BILLBOARD_PLANS, BILLBOARD_LIMITS, cleanHandle, cleanLink } from "../shared/shop.js";

const clip = (s, n) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n);
let sharpLib;
const sharp = async () => (sharpLib ||= (await import("sharp")).default);

/** Any picture -> a clean JPEG (no metadata), longest side 1024. */
async function toJpeg(buf) {
  const s = await sharp();
  const out = await s(buf).rotate().resize(1024, 1024, { fit: "inside", withoutEnlargement: true }).flatten({ background: "#ffffff" }).jpeg({ quality: 84 }).toBuffer();
  const meta = await s(out).metadata();
  if (!meta.width || Math.min(meta.width, meta.height) < 64) throw new Error("The picture is too small");
  return out;
}

async function xAvatar(handle) {
  try {
    const r = await fetch(`https://unavatar.io/x/${handle}?fallback=false`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok || !/^image\//.test(r.headers.get("content-type") || "")) return null;
    return await toJpeg(Buffer.from(await r.arrayBuffer()));
  } catch { return null; }
}

export default async function handler(req, res) {
  const wallet = publicAddress();
  if (req.method === "GET") {
    const id = new URL(req.url, "http://x").searchParams.get("id");
    const o = id ? await getOrder(id) : null;
    return o ? json(res, 200, { id: o.id, status: o.status, amount: o.amount, expiresAt: o.expiresAt }) : json(res, 404, { error: "Unknown order" });
  }
  if (req.method !== "POST") return json(res, 405, { error: "GET or POST" });
  if (!wallet) return json(res, 503, { error: "The crew wallet isn't configured" });
  const body = await readBody(req);

  if (body.op === "confirm") {
    const rl = rateLimit(`shop-confirm:${clientIp(req)}`, 20, 10 * 60 * 1000);
    if (!rl.ok) return json(res, 429, { error: `Slow down, try again in ${rl.retryAfter}s` });
    try { const o = await confirmOrder(String(body.id || ""), String(body.sig || ""), wallet); return json(res, 200, { ok: true, status: o.status }); }
    catch (err) { return json(res, 400, { error: err.message }); }
  }
  if (body.op !== "order") return json(res, 400, { error: "Unknown op" });
  const rl = rateLimit(`shop-order:${clientIp(req)}`, 8, 10 * 60 * 1000);
  if (!rl.ok) return json(res, 429, { error: `Slow down, try again in ${rl.retryAfter}s` });

  // ---- fun interactions ----
  const item = interactionById[body.kind];
  if (item) {
    const params = {};
    if (item.pick === 1) { if (!AGENT_IDS.includes(body.agent)) return json(res, 400, { error: "Pick a cooker" }); params.agent = body.agent; }
    if (item.pick === 2) {
      const pair = [...new Set(Array.isArray(body.agents) ? body.agents : [])].filter((a) => AGENT_IDS.includes(a));
      if (pair.length !== 2) return json(res, 400, { error: "Pick two cookers" });
      params.agents = pair;
    }
    if (item.text) { params.text = clip(body.text, 140); if (params.text.length < 3) return json(res, 400, { error: `${item.text} is missing` }); }
    const o = await createOrder(item.id, params, item.price);
    return json(res, 200, { order: { id: o.id, amount: o.amount, expiresAt: o.expiresAt, label: item.label }, wallet });
  }

  // ---- billboard ----
  if (body.kind !== "billboard") return json(res, 400, { error: "Unknown item" });
  const plan = BILLBOARD_PLANS.find((p) => p.hours === Number(body.hours));
  if (!plan) return json(res, 400, { error: "Pick a duration" });
  const world = await getJSON(WORLD_KEY);
  if (world && billboardFull(world)) return json(res, 409, { error: "The billboard is booked out for the next few days" });
  const a = body.ad || {};
  const type = ["x", "text", "image"].includes(a.type) ? a.type : null;
  if (!type) return json(res, 400, { error: "Pick what to show" });
  const ad = { type, headline: clip(a.headline, BILLBOARD_LIMITS.headline), description: clip(a.description, BILLBOARD_LIMITS.description) };
  if (type === "x") { ad.handle = cleanHandle(a.handle); if (!ad.handle) return json(res, 400, { error: "Enter a valid X handle" }); ad.link = `https://x.com/${ad.handle}`; }
  else if (a.link) { ad.link = cleanLink(a.link); if (!ad.link) return json(res, 400, { error: "The link must start with https://" }); }
  if (type === "text" && ad.headline.length < 2) return json(res, 400, { error: "Write a headline" });
  let imageJpeg = null, avatarJpeg = null;
  if (a.image) {
    const m = /^data:image\/(png|jpe?g|webp|gif);base64,(.+)$/.exec(String(a.image));
    if (!m) return json(res, 400, { error: "Unsupported picture" });
    try { imageJpeg = await toJpeg(Buffer.from(m[2], "base64")); } catch (err) { return json(res, 400, { error: err.message || "Unreadable picture" }); }
  }
  if (type === "image" && !imageJpeg) return json(res, 400, { error: "Upload a picture" });
  if (type === "x") avatarJpeg = await xAvatar(ad.handle);

  const verdict = await moderateAd({ ad, imageJpeg, avatarJpeg });
  if (!verdict.approved) return json(res, 422, { error: `Not approved: ${verdict.reason}` });
  try {
    if (imageJpeg) ad.image = await pinataUpload(new Blob([imageJpeg], { type: "image/jpeg" }), "billboard.jpg");
    if (avatarJpeg) ad.avatar = await pinataUpload(new Blob([avatarJpeg], { type: "image/jpeg" }), "avatar.jpg");
  } catch (err) { return json(res, 502, { error: `Image upload failed: ${err.message.slice(0, 100)}` }); }
  const o = await createOrder("billboard", { hours: plan.hours, ad }, plan.price);
  const startsAt = world ? billboardFreeAt(world) : Date.now();
  return json(res, 200, { order: { id: o.id, amount: o.amount, expiresAt: o.expiresAt, label: `Billboard ${plan.hours}h`, startsAt }, wallet, review: verdict.reason });
}
