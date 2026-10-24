// The party shop (paid fun interactions) and the garden billboard (ad details, renting a slot).
// Ordering gives an exact SOL amount; paying it with Phantom (or any wallet) unlocks the order.
import { AGENTS, byId } from "../shared/roster.js";
import { icon } from "../shared/icons.js";
import { displayUrl } from "../shared/media.js";
import { INTERACTIONS, interactionById, BILLBOARD_PLANS, BILLBOARD_LIMITS, cleanHandle, cleanLink } from "../shared/shop.js";
import { sendSol } from "./holder.js";
import { drawBillboard, BOARD_W, BOARD_H } from "./billboard.js";

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
const short = (a) => (a ? `${a.slice(0, 4)}…${a.slice(-4)}` : "");
const portrait = (id) => `/assets/portraits/${id}.png`;
const until = (ms) => { if (ms <= 0) return "now"; const t = Math.round(ms / 60_000), h = Math.floor(t / 60), m = t % 60; return h ? `${h}h ${m}m` : `${m} min`; };
const clock = (t) => new Date(t).toLocaleString([], { hour: "2-digit", minute: "2-digit", ...(t - Date.now() > 20 * 3_600_000 ? { weekday: "short" } : {}) });

let world = null, receivedAt = Date.now();
let view = null;   // { screen: "menu" | "item" | "pay" | "board" | "rent", ... }
let pollTimer = null;
const now = () => (world?.serverNow ? world.serverNow + (Date.now() - receivedAt) : Date.now());

export function renderShop(w) {
  world = w; receivedAt = Date.now();
  // forms keep their inputs; everything else follows the world
  if (view && !["item", "rent"].includes(view.screen)) render();
}

export function openShop(kind) {
  view = kind && interactionById[kind] ? itemView(kind) : { screen: "menu" };
  $("#shop-modal").hidden = false;
  render();
}
export function openBillboard() {
  view = world?.billboard?.current ? { screen: "board" } : rentView();
  $("#shop-modal").hidden = false;
  render();
}
function close() { view = null; clearInterval(pollTimer); pollTimer = null; $("#shop-modal").hidden = true; }

const itemView = (kind) => ({ screen: "item", kind, agent: null, agents: [], text: "", err: "" });
const rentView = () => ({ screen: "rent", type: "x", handle: "", headline: "", description: "", link: "", image: null, hours: BILLBOARD_PLANS[0].hours, err: "", busy: false });

// ---------------- rendering ----------------
function render() {
  const card = $("#shop-card");
  if (!view || !card) return;
  const html = { menu: menuHtml, item: itemHtml, pay: payHtml, board: boardHtml, rent: rentHtml }[view.screen]();
  card.innerHTML = `<button class="close" data-close aria-label="Close">×</button>${html}`;
  if (view.screen === "rent" || view.screen === "board") drawPreview();
}

function menuHtml() {
  const q = world?.shop?.queue || [], sc = world?.scene;
  const live = sc?.type === "show" ? `<div class="notice">${icon("live", "ok")} Happening now: <b>${esc(sc.title)}</b></div>` : "";
  const line = q.length ? `<div class="dim">Up next: ${q.slice(0, 3).map((i) => `${esc(i.label)} (${short(i.by)})`).join(" · ")}</div>` : "";
  return `<h3 class="sheet-title">${icon("party", "pink")} Party shop</h3>
    <p>Make something happen in the house. Every order plays out live for everyone watching, written on the spot by the crew.</p>
    ${live}${line}
    <div class="shop-grid">${INTERACTIONS.map((i) => `<button type="button" class="shop-item" data-act="item" data-kind="${i.id}">
      <span class="shop-ico">${icon(i.icon)}</span><b>${esc(i.label)}</b><span class="price">${i.price} SOL</span><span class="dim">${esc(i.blurb)}</span></button>`).join("")}</div>
    <button type="button" class="shop-item wide" data-act="board-open"><span class="shop-ico">${icon("megaphone")}</span><b>Garden billboard</b><span class="price">from ${BILLBOARD_PLANS[0].price} SOL/h</span><span class="dim">Rent the big board in the garden: your X profile, any text or a picture, with a link.</span></button>`;
}

function agentPicker(multi) {
  const sel = multi ? view.agents : [view.agent];
  return `<div class="agent-pick">${AGENTS.map((a) => `<button type="button" class="pick ${sel.includes(a.id) ? "on" : ""}" style="--c:${a.color}" data-act="pick" data-id="${a.id}"><img src="${portrait(a.id)}" alt=""><span>${esc(a.name)}</span></button>`).join("")}</div>`;
}

function itemHtml() {
  const i = interactionById[view.kind];
  return `<button type="button" class="linkbtn back" data-act="menu">${icon("back")} Party shop</button>
    <h3 class="sheet-title">${icon(i.icon, "pink")} ${esc(i.label)} <span class="price">${i.price} SOL</span></h3>
    <p>${esc(i.blurb)}</p>
    ${i.pick === 1 ? `<h4>${view.kind === "whoopee" ? "Pick the victim" : "Pick a cooker"}</h4>${agentPicker(false)}` : ""}
    ${i.pick === 2 ? `<h4>Pick two cookers</h4>${agentPicker(true)}` : ""}
    ${i.text ? `<h4>${esc(i.text)}</h4><input class="field" id="shop-text" maxlength="140" placeholder="${esc(i.text)}…" value="${esc(view.text)}">` : ""}
    ${view.err ? `<div class="err">${esc(view.err)}</div>` : ""}
    <button type="button" class="btn primary big" data-act="order" ${view.busy ? "disabled" : ""}>${view.busy ? "One sec…" : `Order for ${i.price} SOL`}</button>
    <div class="dim">The crew writes it live, so it is never the same twice. If it can't happen, you get the SOL back.</div>`;
}

function payHtml() {
  const o = view.order, left = o.expiresAt - Date.now();
  const st = view.status;
  const done = st === "paid";
  const after = view.kind === "billboard"
    ? `Your ad goes up ${o.startsAt && o.startsAt > Date.now() + 60_000 ? `at ${clock(o.startsAt)}` : "within a couple of minutes"}. Click the board in the garden to see it.`
    : "It starts within about two minutes, the camera follows the crew. Keep watching!";
  return `<h3 class="sheet-title">${icon(done ? "checkCircle" : "coins", done ? "ok" : "gold")} ${done ? "Paid, thank you!" : `Pay ${o.amount} SOL`}</h3>
    <p><b>${esc(o.label)}</b>${done ? "" : " · the amount is exact: the last digits tell the crew it is your order."}</p>
    ${done ? `<div class="notice ok">${after}</div>` : `
    <button type="button" class="btn primary big" data-act="pay" ${view.busy ? "disabled" : ""}>${view.busy ? "Waiting for Phantom…" : `Pay ${o.amount} SOL with Phantom`}</button>
    <div class="send-box">
      <div class="dim">Any other wallet: send <b>exactly ${o.amount} SOL</b> to the crew wallet within ${until(left)}.</div>
      <div class="addr"><code>${esc(view.wallet)}</code><button type="button" class="btn" data-act="copy-wallet">Copy</button></div>
      <div class="addr"><code>${o.amount}</code><button type="button" class="btn" data-act="copy-amount">Copy amount</button></div>
    </div>`}
    ${view.msg ? `<div class="${st === "error" ? "err" : "dim"}">${view.msg}</div>` : ""}
    ${done ? `<button type="button" class="btn" data-act="menu">Back to the shop</button>` : ""}`;
}

function boardHtml() {
  const ad = world?.billboard?.current;
  if (!ad) { view = rentView(); return rentHtml(); }
  const link = ad.link ? `<a class="btn primary big" href="${esc(ad.link)}" target="_blank" rel="sponsored nofollow noopener">${ad.type === "x" ? `${icon("xlogo")} Follow @${esc(ad.handle)} on X` : `${icon("link")} Visit ${esc(new URL(ad.link).hostname.replace(/^www\./, ""))}`}</a>` : "";
  const pic = ad.type === "x" ? ad.avatar : ad.image;
  return `<h3 class="sheet-title">${icon("megaphone", "gold")} Garden billboard <span class="pill">Sponsored</span></h3>
    <canvas class="board-preview" id="board-canvas" width="${BOARD_W}" height="${BOARD_H}"></canvas>
    <div class="ad-detail">
      ${pic ? `<img src="${esc(displayUrl(pic))}" alt="" class="ad-pic">` : ""}
      <div>${ad.type === "x" ? `<h4>@${esc(ad.handle)}</h4>` : ad.headline ? `<h4>${esc(ad.headline)}</h4>` : ""}
      ${ad.type === "x" && ad.headline ? `<p>${esc(ad.headline)}</p>` : ""}${ad.description ? `<p>${esc(ad.description)}</p>` : ""}</div>
    </div>
    ${link}
    <div class="dim">Sponsored by ${short(ad.by)} · up for another ${until(ad.until - now())}. Ads are reviewed before they go up, but the crew doesn't vouch for what they promote. Do your own research.</div>
    <button type="button" class="btn" data-act="rent">${icon("megaphone")} Rent the next slot</button>`;
}

function freeAt() {
  const b = world?.billboard || {};
  return Math.max(now(), b.current?.until || 0, ...(b.queue || []).map((q) => q.until));
}

function rentHtml() {
  const v = view, tabs = [["x", "X profile"], ["text", "Text"], ["image", "Picture"]];
  const start = freeAt();
  return `${world?.billboard?.current ? `<button type="button" class="linkbtn back" data-act="board">${icon("back")} Current ad</button>` : ""}
    <h3 class="sheet-title">${icon("megaphone", "gold")} Rent the garden billboard</h3>
    <p>Everyone watching the house sees it, and a click opens your details and link.</p>
    <div class="seg">${tabs.map(([k, l]) => `<button type="button" class="${v.type === k ? "on" : ""}" data-act="type" data-type="${k}">${l}</button>`).join("")}</div>
    <div class="rent-form">
      ${v.type === "x" ? `<label>X handle<input class="field" data-f="handle" maxlength="20" placeholder="@yourname" value="${esc(v.handle)}"></label>` : ""}
      <label>${v.type === "x" ? "Line under your name (optional)" : v.type === "image" ? "Caption (optional)" : "Headline"}<input class="field" data-f="headline" maxlength="${BILLBOARD_LIMITS.headline}" value="${esc(v.headline)}"></label>
      <label>Details shown when someone clicks (optional)<textarea class="field" data-f="description" maxlength="${BILLBOARD_LIMITS.description}" rows="3">${esc(v.description)}</textarea></label>
      ${v.type !== "x" ? `<label>Link (optional, https)<input class="field" data-f="link" placeholder="https://" value="${esc(v.link)}"></label>` : ""}
      ${v.type !== "x" ? `<label class="file">${v.type === "image" ? "Picture" : "Picture (optional)"}<input type="file" accept="image/*" data-act="file"><span class="btn">${icon("image")} ${v.image ? "Change picture" : "Choose picture"}</span></label>` : ""}
    </div>
    <h4>Preview</h4>
    <canvas class="board-preview" id="board-canvas" width="${BOARD_W}" height="${BOARD_H}"></canvas>
    <h4>How long</h4>
    <div class="chips">${BILLBOARD_PLANS.map((p) => `<button type="button" class="chip-btn ${p.hours === v.hours ? "on" : ""}" data-act="hours" data-h="${p.hours}">${p.hours}h · ${p.price} SOL</button>`).join("")}</div>
    <div class="dim">${start - now() < 60_000 ? "The board is free: it goes up right after payment." : `Next free slot starts ${clock(start)}.`}</div>
    ${v.err ? `<div class="err">${esc(v.err)}</div>` : ""}
    <button type="button" class="btn primary big" data-act="rent-order" ${v.busy ? "disabled" : ""}>${v.busy ? "Reviewing your ad…" : "Submit for review & pay"}</button>
    <div class="dim">A quick automatic review checks every ad before payment (no scams, no adult content, no impersonation).</div>`;
}

function previewAd() {
  if (view.screen === "board") return world?.billboard?.current || null;
  const v = view, handle = cleanHandle(v.handle);
  if (v.type === "x") return { type: "x", handle: handle || "yourname", headline: v.headline, avatar: null };
  return { type: v.type, headline: v.headline || (v.type === "text" ? "Your headline" : ""), description: v.description, link: cleanLink(v.link), image: v.image };
}

function drawPreview() {
  const cv = $("#board-canvas");
  if (!cv) return;
  drawBillboard(cv.getContext("2d"), previewAd(), { price: BILLBOARD_PLANS[0].price, onImage: () => drawPreview() });
}

// ---------------- actions ----------------
async function post(body) {
  const res = await fetch("/api/shop", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `request failed (${res.status})`);
  return data;
}

function toPay(kind, data) {
  view = { screen: "pay", kind, order: data.order, wallet: data.wallet, status: "pending", msg: data.review ? `Review: ${esc(data.review)}` : "" };
  clearInterval(pollTimer);
  pollTimer = setInterval(checkStatus, 5000);
  render();
}

async function checkStatus() {
  if (view?.screen !== "pay" || view.status === "paid") { clearInterval(pollTimer); return; }
  try {
    const r = await (await fetch(`/api/shop?id=${encodeURIComponent(view.order.id)}`)).json();
    if (r.status === "paid") { view.status = "paid"; view.msg = ""; render(); }
    else if (Date.now() > view.order.expiresAt) { view.status = "error"; view.msg = "This order expired. Start a new one if you still want it."; render(); }
  } catch { /* try again next round */ }
}

async function fileToJpeg(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("That file isn't a picture")); i.src = url; });
    const s = Math.min(1, 1024 / Math.max(img.width, img.height));
    const c = document.createElement("canvas"); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
    const ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.85);
  } finally { URL.revokeObjectURL(url); }
}

async function onClick(ev) {
  if (ev.target.closest("[data-close]")) return close();
  const btn = ev.target.closest("[data-act]");
  if (!btn || !view) return;
  const act = btn.dataset.act;
  if (act === "menu") { view = { screen: "menu" }; return render(); }
  if (act === "item") { view = itemView(btn.dataset.kind); return render(); }
  if (act === "board-open") { view = world?.billboard?.current ? { screen: "board" } : rentView(); return render(); }
  if (act === "board") { view = { screen: "board" }; return render(); }
  if (act === "rent") { view = rentView(); return render(); }
  if (act === "pick") {
    const id = btn.dataset.id, i = interactionById[view.kind];
    if (i.pick === 1) view.agent = id;
    else view.agents = view.agents.includes(id) ? view.agents.filter((a) => a !== id) : [...view.agents, id].slice(-2);
    view.text = $("#shop-text")?.value ?? view.text;
    return render();
  }
  if (act === "type") { view.type = btn.dataset.type; view.err = ""; return render(); }
  if (act === "hours") { view.hours = Number(btn.dataset.h); return render(); }
  if (act === "copy-wallet" || act === "copy-amount") {
    navigator.clipboard?.writeText(act === "copy-wallet" ? view.wallet : String(view.order.amount));
    btn.textContent = "Copied"; setTimeout(() => { btn.textContent = act === "copy-wallet" ? "Copy" : "Copy amount"; }, 1500);
    return;
  }
  if (act === "order") {
    const i = interactionById[view.kind];
    view.text = $("#shop-text")?.value.trim() ?? "";
    if (i.pick === 1 && !view.agent) { view.err = "Pick a cooker first"; return render(); }
    if (i.pick === 2 && view.agents.length !== 2) { view.err = "Pick two cookers"; return render(); }
    if (i.text && view.text.length < 3) { view.err = `${i.text} is missing`; return render(); }
    view.busy = true; view.err = ""; render();
    try { toPay(view.kind, await post({ op: "order", kind: view.kind, agent: view.agent, agents: view.agents, text: view.text })); }
    catch (err) { view.busy = false; view.err = err.message; render(); }
    return;
  }
  if (act === "rent-order") {
    const v = view;
    v.busy = true; v.err = ""; render();
    try {
      const ad = { type: v.type, handle: v.handle, headline: v.headline, description: v.description, link: v.link, image: v.image };
      toPay("billboard", await post({ op: "order", kind: "billboard", hours: v.hours, ad }));
    } catch (err) { v.busy = false; v.err = err.message; render(); }
    return;
  }
  if (act === "pay") {
    view.busy = true; view.msg = ""; render();
    try {
      const sig = await sendSol(view.wallet, view.order.amount);
      view.msg = `Sent (<a href="https://solscan.io/tx/${esc(sig)}" target="_blank" rel="noopener">tx</a>). Confirming…`; render();
      try { await post({ op: "confirm", id: view.order.id, sig }); view.status = "paid"; view.msg = ""; }
      catch (err) { view.msg = esc(err.message); }
    } catch (err) { view.status = "error"; view.msg = esc(err?.message || String(err)); }
    view.busy = false; render();
  }
}

function onInput(ev) {
  const f = ev.target.dataset?.f;
  if (!f || view?.screen !== "rent") return;
  view[f] = ev.target.value;
  drawPreview();
}

async function onChange(ev) {
  if (ev.target.dataset?.act !== "file" || view?.screen !== "rent") return;
  const file = ev.target.files?.[0];
  if (!file) return;
  try { view.image = await fileToJpeg(file); view.err = ""; } catch (err) { view.err = err.message; }
  render();
}

export function initShop() {
  const modal = $("#shop-modal");
  modal.addEventListener("click", onClick);
  modal.addEventListener("input", onInput);
  modal.addEventListener("change", onChange);
  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && view) close(); });
  // shop buttons can sit anywhere on the page
  document.addEventListener("click", (ev) => {
    if (ev.target.closest("[data-act='shop']")) openShop();
    else if (ev.target.closest("[data-act='billboard']")) openBillboard();
  });
}
