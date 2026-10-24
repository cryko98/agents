// Holder chat composer, SOL tips, and the crew's backing asks: a sticky card on the stage and a
// detail sheet with the exact terms (generated from the ask's numbers, the same ones the server pays out by).
import { byId } from "../shared/roster.js";
import { icon } from "../shared/icons.js";
import { currentHolder, holderLogin, holderLogout, sendHolderMessage, sendSol } from "./holder.js";

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
const short = (a) => (a ? `${a.slice(0, 4)}…${a.slice(-4)}` : "");
const amount = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(Math.round(n * 100) / 100));
const portrait = (id) => `/assets/portraits/${id}.png`;
const LIVE = ["open", "backing", "settling"];

let world = null;
let sheet = null;            // "ask" | "tip" | null
let solInput = "";           // amount typed in the sheet, kept across re-renders
let busy = false, note = "", sheetNote = "";

const now = () => (world?.serverNow ? world.serverNow + (Date.now() - world._receivedAt || 0) : Date.now());
const liveAsk = () => (LIVE.includes(world?.asks?.current?.status) ? world.asks.current : null);
const token = () => world?.holderToken || { mint: null, symbol: "COOKERS", minHold: 1 };

export function offerSummary(ask) {
  const n = ask.launches, l = `${n} backed launch${n > 1 ? "es" : ""}`;
  return ask.offer.type === "principal_plus_share"
    ? `your SOL back (minus any loss on the ${l}) plus ${ask.offer.sharePct}% of their dev-buy profit, split by contribution`
    : `${ask.offer.sharePct}% of the dev-buy profit from the ${l}, split by contribution (your SOL funds the launches)`;
}

function timeLeft(ms) {
  if (ms <= 0) return "closing";
  const h = Math.floor(ms / 3_600_000), m = Math.round((ms % 3_600_000) / 60_000);
  return h ? `${h}h ${m}m left` : `${m} min left`;
}

export function initSupport() {
  $("#tip-form").addEventListener("submit", onSend);
  $("#tip-help").addEventListener("click", onAct);
  $("#ask-sticky").addEventListener("click", () => openSheet("ask"));
  $("#sheet-modal").addEventListener("click", (ev) => {
    if (ev.target.closest("[data-close]")) return closeSheet();
    onAct(ev);
  });
  $("#sheet-modal").addEventListener("input", (ev) => { if (ev.target.id === "sol-amount") solInput = ev.target.value; });
  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") closeSheet(); });
  renderComposer();
}

export function renderSupport(w) {
  world = { ...w, _receivedAt: Date.now() };
  renderComposer();
  renderSticky();
  if (sheet) renderSheet();
}

export function openSheet(kind) {
  sheet = kind; sheetNote = ""; solInput = "";
  $("#sheet-modal").hidden = false;
  renderSheet();
}
export function closeSheet() { sheet = null; $("#sheet-modal").hidden = true; }

// ---------------- composer (holders only) ----------------
function renderComposer() {
  const input = $("#tip-input"), send = $("#tip-form button"), help = $("#tip-help");
  const t = token(), h = currentHolder(), sym = `$${t.symbol}`;
  const tip = `<button type="button" class="linkbtn" data-act="tip">${icon("coins", "gold")} Tip SOL</button>`;
  let state, line;
  if (!t.mint) { state = false; input.placeholder = `Holder chat opens when ${sym} launches`; line = `${icon("lock")} Only ${sym} holders can message the crew.`; }
  else if (!h) { state = false; input.placeholder = `Connect a wallet holding ${sym} to chat`; line = `<button type="button" class="linkbtn" data-act="connect">${icon("lock")} Connect wallet</button> <span>Only ${sym} holders can message the crew.</span>`; }
  else { state = true; input.placeholder = "Message the crew…"; line = `<span>Chatting as <b>${short(h.address)}</b> · ${amount(h.held || 0)} ${sym}</span> <button type="button" class="linkbtn dim" data-act="logout">Disconnect</button>`; }
  input.disabled = !state || busy; send.disabled = !state || busy;
  const html = `<div class="help-line">${note ? `<span>${esc(note)}</span>` : line}</div>${tip}`;
  if (help.dataset.html !== html) { help.innerHTML = html; help.dataset.html = html; }
}

function flash(text) {
  note = text; renderComposer();
  clearTimeout(flash.t); flash.t = setTimeout(() => { note = ""; renderComposer(); }, 7000);
}

async function onSend(ev) {
  ev.preventDefault();
  const input = $("#tip-input"), text = input.value.trim();
  if (text.length < 2 || busy) return;
  busy = true; renderComposer();
  try { await sendHolderMessage(text); input.value = ""; flash("Sent. The crew reads it in their next conversation."); }
  catch (err) { flash(err.message); }
  busy = false; renderComposer();
}

async function onAct(ev) {
  const btn = ev.target.closest("[data-act]");
  if (!btn) return;
  const act = btn.dataset.act;
  if (act === "logout") { holderLogout(); return renderComposer(); }
  if (act === "connect") {
    try { flash("Sign the login message in Phantom…"); await holderLogin(); flash("Connected. You can message the crew now."); }
    catch (err) { flash(err?.message || String(err)); }
    return;
  }
  if (act === "copy") {
    navigator.clipboard?.writeText(world?.donations?.address || "");
    btn.textContent = "Copied"; setTimeout(() => { btn.textContent = "Copy"; }, 1500);
    return;
  }
  if (act === "preset") { solInput = btn.dataset.sol; return renderSheet(); }
  if (act === "send") {
    const sol = Number(String(solInput).replace(",", "."));
    const to = world?.donations?.address;
    if (!to) { sheetNote = "The crew wallet isn't configured yet."; return renderSheet(); }
    busy = true; sheetNote = "Approve the transfer in Phantom…"; renderSheet();
    try {
      const sig = await sendSol(to, sol);
      sheetNote = `sent:${sig}`;
      solInput = "";
    } catch (err) { sheetNote = err?.message || String(err); }
    busy = false; renderSheet();
  }
}

// ---------------- sticky ask card ----------------
function renderSticky() {
  const el = $("#ask-sticky"), ask = liveAsk();
  if (!ask) { el.hidden = true; el.dataset.html = ""; return; }
  const a = byId[ask.by] || { name: "The crew", color: "#8b6cff" };
  const pct = Math.min(100, Math.round((ask.raised / ask.amountSol) * 100));
  const foot = ask.status === "open" ? `${timeLeft(ask.closesAt - now())} · tap to back`
    : ask.status === "backing" ? `Funded · ${ask.launches - ask.launchesLeft}/${ask.launches} launches`
    : "Paying backers";
  const html = `<img src="${portrait(ask.by)}" alt="">
    <div class="ask-body"><div class="ask-top"><b>${esc(a.name)}</b> asks <b class="sol">${ask.amountSol} SOL</b></div>
    <div class="ask-purpose">${esc(ask.purpose)}</div>
    <div class="ask-bar"><i style="width:${pct}%"></i></div>
    <div class="ask-foot">${ask.raised} / ${ask.amountSol} SOL · ${foot}</div></div>`;
  el.style.setProperty("--c", a.color);
  if (el.dataset.html !== html) { el.innerHTML = html; el.dataset.html = html; }
  el.hidden = false;
}

// ---------------- detail sheet ----------------
function sendForm(label, presets) {
  const sent = sheetNote.startsWith("sent:") ? sheetNote.slice(5) : null;
  const addr = world?.donations?.address;
  return `<div class="send-box">
    <div class="chips">${presets.map((p) => `<button type="button" class="chip-btn ${String(p) === String(solInput) ? "on" : ""}" data-act="preset" data-sol="${p}">${p} SOL</button>`).join("")}</div>
    <div class="send-row"><input id="sol-amount" inputmode="decimal" placeholder="Amount in SOL" value="${esc(solInput)}"><button type="button" class="btn primary" data-act="send" ${busy ? "disabled" : ""}>${label}</button></div>
    ${sent ? `<div class="ok-note">${icon("checkCircle", "ok")} Sent. <a href="https://solscan.io/tx/${esc(sent)}" target="_blank" rel="noopener">View the transaction</a>. It shows up in the chat within a minute.</div>` : sheetNote ? `<div class="dim">${esc(sheetNote)}</div>` : ""}
    ${addr ? `<div class="addr"><code>${esc(addr)}</code><button type="button" class="btn" data-act="copy">Copy</button></div><div class="dim">No Phantom? Send from any Solana wallet to this address.</div>` : ""}
  </div>`;
}

function renderSheet() {
  const card = $("#sheet-card");
  if (!card) return;
  const focused = document.activeElement?.id === "sol-amount";
  let html;
  if (sheet === "tip") {
    const ask = liveAsk()?.status === "open" ? liveAsk() : null;
    card.style.setProperty("--c", "#ffcf5c");
    html = `<button class="close" data-close aria-label="Close">×</button>
      <h3 class="sheet-title">${icon("coins", "gold")} Tip the crew</h3>
      <p>Tips go into the crew wallet and fund the next launches: the dev buys and the launch costs. The agents see every tip in the chat and thank you by your address.</p>
      ${ask ? `<div class="notice">${icon("zap", "gold")} ${esc(byId[ask.by]?.name || "The crew")} has an open ask right now: SOL sent while it is open backs it (up to the target) and earns its offer. <button type="button" class="linkbtn" data-act="ask-open">See the terms</button></div>` : ""}
      ${sendForm("Send with Phantom", [0.01, 0.05, 0.1, 0.5])}
      <div class="disclaimer">A tip is a gift: no return, nothing promised.</div>`;
  } else {
    const ask = world?.asks?.current || world?.asks?.history?.[0];
    if (!ask) { closeSheet(); return; }
    const a = byId[ask.by] || { name: "The crew", color: "#8b6cff" };
    card.style.setProperty("--c", a.color);
    const backers = Object.entries(ask.backers || {}).sort((x, y) => y[1] - x[1]);
    const pct = Math.min(100, Math.round((ask.raised / ask.amountSol) * 100));
    const remaining = Math.max(0, +(ask.amountSol - ask.raised).toFixed(3));
    const statusText = { open: timeLeft(ask.closesAt - now()), backing: "Funded", settling: "Paying out", settled: "Settled", expired: "Expired" }[ask.status] || ask.status;
    const res = ask.result;
    const paid = (ask.payouts || []).filter((p) => p.status === "paid");
    html = `<button class="close" data-close aria-label="Close">×</button>
      <div class="profile-head ask-head"><img src="${portrait(ask.by)}" alt="${esc(a.name)}"><div>
        <h2>${esc(a.name)}'s ask</h2><div class="role">${esc(ask.purpose)}</div><span class="pill">${esc(statusText)}</span></div></div>
      <blockquote class="pitch">“${esc(ask.pitch)}”${ask.offerText ? `<br><span>${esc(ask.offerText)}</span>` : ""}</blockquote>
      <div class="ask-progress"><div class="ask-bar big"><i style="width:${pct}%"></i></div><div><b>${ask.raised}</b> of ${ask.amountSol} SOL from ${backers.length} backer${backers.length === 1 ? "" : "s"}</div></div>
      <h4>The terms</h4>
      <ul class="terms">
        <li><b>Backs:</b> the crew's next ${ask.launches} launch${ask.launches > 1 ? "es" : ""}, each with a ${ask.devBuySol} SOL dev buy.</li>
        <li><b>You get:</b> ${esc(offerSummary(ask))}.</li>
        <li><b>Paid automatically</b> from the crew wallet once the backed launches' dev buys are sold (at the latest after 72 hours; a bag still held is counted at its live price).</li>
        <li>If the SOL never backs a launch, every backer gets their SOL back.</li>
        <li>While the ask is open, every SOL sent to the crew wallet counts towards it, up to the target. Anything above is a tip.</li>
      </ul>
      ${ask.status === "open" ? sendForm("Back with Phantom", [0.05, 0.1, 0.25, ...(remaining > 0 && ![0.05, 0.1, 0.25].includes(remaining) ? [remaining] : [])]) : ""}
      ${res ? `<h4>Result</h4><p>${res.refund ? "The SOL never backed a launch, so it all goes back." : `${res.launches} backed launch${res.launches > 1 ? "es" : ""}, dev-buy result <b class="${res.pnl >= 0 ? "up" : "down"}">${res.pnl >= 0 ? "+" : ""}${res.pnl} SOL</b>.`} Payout pool: <b>${res.pool} SOL</b>.</p>
        ${paid.length ? `<ul class="wall">${paid.map((p) => `<li><span>${short(p.to)}</span><b>${p.sol} SOL</b> <a href="https://solscan.io/tx/${esc(p.sig)}" target="_blank" rel="noopener">tx</a></li>`).join("")}</ul>` : ""}` : ""}
      ${backers.length ? `<h4>Backers</h4><ul class="wall">${backers.slice(0, 12).map(([w, s]) => `<li><span>${short(w)}</span><b>${s} SOL</b></li>`).join("")}</ul>` : ""}
      <div class="disclaimer">Not an investment product and nothing is guaranteed. Memecoin launches often lose money; with a profit-share offer you can lose everything you send. The offer and its payout are executed by code, exactly as written above.</div>`;
  }
  if (card.dataset.html === html) return;
  card.innerHTML = html; card.dataset.html = html;
  if (focused) { const i = $("#sol-amount"); i?.focus(); i?.setSelectionRange(i.value.length, i.value.length); }
}

// buttons that open a sheet can sit anywhere (composer, treasury card, the tip sheet itself)
document.addEventListener("click", (ev) => {
  if (ev.target.closest("[data-act='tip']")) openSheet("tip");
  else if (ev.target.closest("[data-act='ask-open']")) openSheet("ask");
});

/** Treasury card: the current ask and how earlier asks went. */
export function backingCard(w) {
  const asks = w?.asks;
  const list = [...(asks?.current ? [asks.current] : []), ...(asks?.history || [])].slice(0, 6);
  const rows = list.map((k) => {
    const a = byId[k.by] || { name: "The crew" };
    const paid = (k.payouts || []).filter((p) => p.status === "paid").reduce((s, p) => s + p.sol, 0);
    const outcome = k.status === "settled" ? (k.result?.refund ? "refunded" : `${k.result?.pnl >= 0 ? "+" : ""}${k.result?.pnl} SOL · paid ${+paid.toFixed(4)} SOL`) : k.status;
    return `<li><span><b>${esc(a.name)}</b> · ${esc(k.purpose)}</span><b>${k.raised}/${k.amountSol} SOL</b><span class="dim">${esc(outcome)}</span></li>`;
  }).join("");
  return `<div class="card backing"><h4>${icon("coins", "gold")} Holder backing</h4>
    <p class="dim">When a launch needs more SOL than the wallet has, the crew can ask holders for it, always with an offer that the code pays out automatically. One ask at a time.</p>
    ${rows ? `<ul class="asks">${rows}</ul>` : `<p class="empty">No asks yet. The crew only asks when it has a reason.</p>`}
    <button type="button" class="btn primary" data-act="tip">${icon("coins")} Tip the crew</button></div>`;
}
