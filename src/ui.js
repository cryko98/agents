// DOM side: chat log, speech bubbles, roster, agent cards, profile modal, treasury, coin lab, status.
import { displayUrl } from "../shared/media.js";
import { AGENTS, byId, STAGES, STAGE_INFO } from "../shared/roster.js";
import { net, sendTip, requestPerk } from "./net.js";
import { UPGRADES } from "../shared/upgrades.js";
import { voteMessage } from "../shared/poll.js";
import { icon } from "../shared/icons.js";

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
const short = (a) => (a ? `${a.slice(0, 4)}…${a.slice(-4)}` : "");
const sol = (n, d = 3) => (n == null || Number.isNaN(n) ? "—" : `${Number(n).toFixed(d)} SOL`);
const signed = (n, d = 3) => (n == null ? "" : `${n >= 0 ? "+" : ""}${Number(n).toFixed(d)}`);

export const portraits = {};
let simRef = null;

export function initUI({ sim, renderer, canvas }) {
  simRef = sim;
  for (const a of AGENTS) portraits[a.id] = `/assets/portraits/${a.id}.png`;

  for (const btn of document.querySelectorAll(".tab")) {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b === btn));
      document.querySelectorAll(".tab-page").forEach((p) => p.classList.toggle("active", p.id === `tab-${btn.dataset.tab}`));
    });
  }

  // tips
  const form = $("#tip-form"), input = $("#tip-input"), sendBtn = form.querySelector("button"), help = $("#tip-help");
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const text = input.value.trim();
    if (text.length < 2) return;
    sendBtn.disabled = true;
    try {
      await sendTip(text);
      input.value = "";
      help.textContent = "Tip sent. The team will see it in their next conversation.";
    } catch (err) {
      help.textContent = err.message;
    }
    setTimeout(() => { sendBtn.disabled = false; help.textContent = "Tips go straight to the agents. They decide what to do with them."; }, 8000);
  });

  // roster + cards
  const roster = $("#roster"), grid = $("#agent-grid");
  for (const a of AGENTS) {
    const chip = document.createElement("button");
    chip.className = "chip"; chip.style.setProperty("--c", a.color); chip.dataset.id = a.id;
    chip.innerHTML = `<img src="${portraits[a.id]}" alt=""><span class="who"><b>${a.name}</b><span class="act"></span></span>`;
    chip.addEventListener("click", () => openProfile(a.id));
    roster.appendChild(chip);
    const card = document.createElement("div");
    card.className = "agent-card"; card.style.setProperty("--c", a.color); card.dataset.id = a.id;
    card.innerHTML = `<img src="${portraits[a.id]}" alt=""><div class="n">${a.name}</div><div class="r">${a.role}</div><div class="a"></div>`;
    card.addEventListener("click", () => openProfile(a.id));
    grid.appendChild(card);
  }

  const toCanvas = (ev) => {
    const rect = canvas.getBoundingClientRect();
    return { x: (ev.clientX - rect.left) * (canvas.width / rect.width), y: (ev.clientY - rect.top) * (canvas.height / rect.height) };
  };
  // a click on a cooker opens their profile; on a desk monitor, the camera flies to that screen.
  // While a monitor is in focus, a click on another monitor moves there and anywhere else goes back.
  canvas.addEventListener("click", (ev) => {
    const { x, y } = toCanvas(ev);
    const owner = renderer.monitorAt?.(x, y);
    if (renderer.focus) return owner && owner !== renderer.focus ? renderer.focusMonitor(owner) : owner ? null : renderer.unfocus();
    const a = renderer.agentAt(x, y, sim.agents);
    if (a) return openProfile(a.id);
    if (owner) renderer.focusMonitor(owner);
  });
  canvas.addEventListener("mousemove", (ev) => { const { x, y } = toCanvas(ev); canvas.classList.toggle("hover", !!renderer.agentAt(x, y, sim.agents) || !!renderer.monitorAt?.(x, y)); });

  $("#profile-modal").addEventListener("click", (ev) => { if (ev.target.dataset.close !== undefined || ev.target.classList.contains("close")) closeProfile(); });
  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") { closeProfile(); renderer.unfocus?.(); } });

  const tick = () => { const d = new Date(); $("#clock").textContent = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
  tick(); setInterval(tick, 10000);

  $("#coin-lab").addEventListener("click", onCoinLabClick);
  renderTreasury(null);
  renderCoin(null);
}

// ---------------- chat ----------------
const renderedIds = new Set();
export function syncTranscript(entries) {
  const log = $("#chat-log");
  const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
  let added = false;
  const list = renderedIds.size ? entries : entries.slice(-60);
  for (const e of list) {
    if (renderedIds.has(e.id)) continue;
    renderedIds.add(e.id);
    appendMessage(e);
    added = true;
  }
  if (added && atBottom) log.scrollTop = log.scrollHeight;
}

function appendMessage(e) {
  const log = $("#chat-log");
  const el = document.createElement("div");
  if (e.kind === "line") {
    const a = byId[e.speaker];
    if (!a) return;
    el.className = "msg"; el.style.setProperty("--c", a.color);
    el.innerHTML = `<img src="${portraits[a.id]}" alt=""><div class="body"><div class="name">${a.name}<span class="role">${a.role}</span></div><div class="text">${esc(e.text)}</div></div>`;
  } else if (e.kind === "holder") {
    el.className = "msg holder";
    el.innerHTML = `<img src="data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" fill="#2b2355"/><circle cx="8" cy="6" r="3" fill="#ffd166"/><rect x="3" y="10" width="10" height="5" rx="2" fill="#ffd166"/></svg>')}" alt=""><div class="body"><div class="name">Holder tip</div><div class="text">${esc(e.text)}</div></div>`;
  } else if (e.kind === "scene") {
    el.className = "scene-title"; el.textContent = leadIcon(e.text)[1];
  } else {
    el.className = "msg system";
    const [ico, text] = leadIcon(e.text);
    el.innerHTML = `<div class="text">${ico}${ico ? " " : ""}${linkify(esc(text))}</div>`;
  }
  log.appendChild(el);
  while (log.children.length > 260) log.removeChild(log.firstChild);
}
// the server starts system lines with an emoji; the chat draws a matching SVG icon instead
const LEAD_ICON = {
  "📈": ["chartUp", "ok"], "📉": ["chartDown", "bad"], "🖼": ["image", "pink"], "📸": ["image", "pink"], "🎨": ["image", "pink"],
  "🗑": ["trash"], "🚀": ["rocket", "pink"], "🧪": ["flask", "sky"], "🔒": ["lock", "gold"], "💸": ["coins", "gold"], "💰": ["coins", "gold"],
  "🗳": ["ballot", "sky"], "🔎": ["search", "sky"], "⚡": ["zap", "gold"], "📡": ["radar", "sky"], "🛠": ["wrench", "gold"], "🛡": ["shield", "warn"],
  "🛑": ["stop", "bad"], "✅": ["checkCircle", "ok"], "🔁": ["refresh"], "🔄": ["refresh"], "💛": ["heart", "gold"], "🤖": ["robot"], "🟢": ["live", "ok"],
};
const LEAD_RE = /^\s*(\p{Extended_Pictographic})️?\s*/u;
function leadIcon(text = "") {
  const m = LEAD_RE.exec(text);
  if (!m) return ["", text];
  const [name, cls] = LEAD_ICON[m[1]] || ["spark", "gold"];
  return [icon(name, cls), text.slice(m[0].length)];
}
function linkify(s) { return s.replace(/https?:\/\/[^\s]+/g, (u) => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`); }

// ---------------- bubbles ----------------
const bubbleEls = new Map();
export function updateBubbles(sim, renderer, canvas) {
  const layer = $("#bubbles");
  const rect = canvas.getBoundingClientRect();
  const parent = layer.getBoundingClientRect();
  const sx = rect.width / canvas.width, sy = rect.height / canvas.height;
  const offX = rect.left - parent.left, offY = rect.top - parent.top;
  for (const a of sim.agents) {
    let el = bubbleEls.get(a.id);
    if (a.bubble) {
      if (!el) { el = document.createElement("div"); el.style.setProperty("--bc", a.def.color); layer.appendChild(el); bubbleEls.set(a.id, el); }
      if (el.dataset.text !== a.bubble.text) {
        el.dataset.text = a.bubble.text;
        el.className = `bubble ${a.bubble.emotion || ""}`;
        el.innerHTML = `<span class="who">${a.def.name}</span>${esc(a.bubble.text)}`;
      }
      const h = renderer.headPos(a);
      el.style.left = `${offX + h.x * sx}px`;
      el.style.top = `${offY + h.y * sy}px`;
    } else if (el) { el.remove(); bubbleEls.delete(a.id); }
  }
}

// ---------------- roster / status ----------------
export function updateRoster(sim) {
  for (const a of sim.agents) {
    const chip = document.querySelector(`.chip[data-id="${a.id}"]`);
    if (chip) { chip.querySelector(".act").textContent = a.describe(); chip.classList.toggle("talking", a.talking); }
    const card = document.querySelector(`.agent-card[data-id="${a.id}"] .a`);
    if (card) card.textContent = a.describe();
  }
}

export function updateStatus() {
  const el = $("#ai-status");
  el.classList.remove("online", "offline", "busy");
  let label;
  const h = net.health;
  if (net.error) { label = `world offline: ${net.error}`; el.classList.add("offline"); }
  else if (!net.world) label = "connecting…";
  else if (h?.paused) { label = "AI paused"; el.classList.add("offline"); }
  else if (h && !h.claude) { label = "AI offline · agents just work"; el.classList.add("offline"); }
  else if (recentClaudeError()) { label = recentClaudeError(); el.classList.add("offline"); }
  else if (h && !h.redis) { label = "live · memory store (no Redis)"; el.classList.add("busy"); }
  else { label = `live · shared world${h?.model ? " · " + h.model : ""}`; el.classList.add("online"); }
  el.querySelector(".label").textContent = label;
}

// The server records failed Claude calls in world.events; surface the latest one for 15 minutes.
function recentClaudeError() {
  const events = net.world?.events || [];
  const lastOk = events.filter((e) => e.type === "claude-ok").pop()?.t || 0;
  const ev = events.filter((e) => /scene-fallback|research-error/.test(e.type) && e.t > lastOk && Date.now() + net.offset - e.t < 15 * 60_000).pop();
  if (!ev) return null;
  if (/authentication_error|invalid x-api-key/.test(ev.error || "")) return "Claude key rejected (401) · check ANTHROPIC_API_KEY";
  if (/rate_limit|429/.test(ev.error || "")) return "Claude rate limited · agents quiet for now";
  if (/credit|billing|402/.test(ev.error || "")) return "Claude credit exhausted · agents quiet";
  return `Claude call failed · ${String(ev.error || "").slice(0, 60)}`;
}

export function updateTicker(world) {
  const t = world.treasury;
  $("#mode-badge").textContent = t.mode.toUpperCase();
  $("#mode-badge").className = `mode ${t.mode}`;
  $("#equity").textContent = sol(t.equitySol);
  const p = $("#pnl");
  p.textContent = t.pnlSol != null ? `${signed(t.pnlSol)} (${signed(t.pnlPct, 1)}%)` : "";
  p.className = `pnl ${t.pnlSol > 0 ? "up" : t.pnlSol < 0 ? "down" : ""}`;
}

// ---------------- profile ----------------
export function openProfile(id) {
  const a = byId[id];
  const live = simRef?.agent(id);
  const card = $("#profile-card");
  card.style.setProperty("--c", a.color);
  const skills = Object.entries(a.skills).map(([k, v]) => `<div class="skill"><span>${k}</span><div class="bar"><i data-w="${v}"></i></div><span class="v">${v}</span></div>`).join("");
  const lb = net.world?.leaderboard || [];
  const st = lb.find((r) => r.id === id) || { calls: 0, closed: 0, wins: 0, totalSol: 0 };
  const rank = lb.findIndex((r) => r.id === id) + 1;
  card.innerHTML = `
    <button class="close" aria-label="Close">×</button>
    <div class="profile-head">
      <img src="${portraits[id]}" alt="${a.name}">
      <div><h2>${a.name}</h2><div class="role">${a.title} · ${a.role}</div><div class="quote">“${a.tagline}”</div></div>
    </div>
    <div class="profile-section"><p style="margin:0">${a.bio}</p></div>
    <div class="profile-section"><h4>Right now</h4><div class="stat-row">
      <div class="stat">Activity<b>${live?.describe() || "—"}</b></div>
      <div class="stat">Mood<b>${live?.mood || "—"}</b></div>
    </div></div>
    <div class="profile-section"><h4>Trading record (paper)</h4><div class="stat-row">
      <div class="stat">Rank<b>#${rank || "—"} of 6</b></div>
      <div class="stat">Calls<b>${st.calls}</b></div>
      <div class="stat">Closed wins<b>${st.wins}/${st.closed}</b></div>
      <div class="stat">PnL<b class="${st.totalSol >= 0 ? "up" : "down"}">${signed(st.totalSol, 4)} SOL</b></div>
    </div></div>
    <div class="profile-section"><h4>Skills</h4>${skills}</div>
    <div class="profile-section"><h4>Personality</h4><div class="traits">${a.traits.map((t) => `<span>${t}</span>`).join("")}</div></div>
    <div class="profile-section"><h4>Favorite spots</h4><div class="traits">${[...new Set(a.favorites)].map((t) => `<span>${t}</span>`).join("")}</div></div>`;
  $("#profile-modal").hidden = false;
  requestAnimationFrame(() => card.querySelectorAll(".bar i").forEach((i) => { i.style.width = `${i.dataset.w}%`; }));
}
export function closeProfile() { $("#profile-modal").hidden = true; }

// ---------------- treasury ----------------
export function renderTreasury(world) {
  const root = $("#treasury");
  if (!world) { root.innerHTML = `<p class="empty" style="padding:14px">Connecting to the crew wallet…</p>`; return; }
  const t = world.treasury, d = world.donations, perks = world.perks;
  const positions = Object.entries(t.positions || {});
  const posRows = positions.length
    ? positions.map(([mint, p]) => `<tr><td><b>${p.strategy === "scalp" ? icon("zap", "gold") : ""}${esc(p.symbol)}</b><br><span class="dim">${short(mint)}${p.strategy === "scalp" ? " · scalp" : ""}</span></td><td>${sol(p.valueSol)}</td><td class="${p.pnlSol >= 0 ? "up" : "down"}">${signed(p.pnlSol)}${p.costSol ? `<br><span class="dim">${signed(((p.valueSol - p.costSol) / p.costSol) * 100, 1)}%</span>` : ""}</td></tr>`).join("")
    : `<tr><td colspan="3" class="empty">No open positions. The desk is holding cash.</td></tr>`;
  const trades = (t.trades || []).slice(0, 12).map((tr) => `<div class="trade ${tr.side}"><span class="side">${tr.side === "buy" ? "BUY" : "SELL"}</span><span class="sym">${/^Scalp/.test(tr.reason || "") ? icon("zap", "gold") : ""}${esc(tr.symbol)}${tr.realized != null ? ` <span class="${tr.realized >= 0 ? "up" : "down"}">${signed(tr.realized, 4)}</span>` : ""}</span><span class="amt">${tr.sol} SOL</span><span class="who">${byId[tr.by]?.name || ""}</span><div class="why">${esc(tr.reason)}${tr.sig ? ` · <a href="https://solscan.io/tx/${tr.sig}" target="_blank" rel="noopener">tx</a>` : ""}</div></div>`).join("") || `<p class="empty">No trades yet. The desk meets every 5 minutes.</p>`;
  const wall = (d.wall || []).slice(0, 12).map((w) => `<li><span>${short(w.from)}</span><b>${w.sol} SOL</b></li>`).join("") || `<li class="empty">Be the first name on the wall.</li>`;
  const gallery = (perks.gallery || []).slice(0, 8).map((g) => `<a class="art" href="${esc(g.url)}" target="_blank" rel="noopener" title="${esc(g.request)}"><img src="${esc(g.url)}" alt="" loading="lazy"></a>`).join("");
  const nextDesk = t.nextDeskAt ? Math.max(0, Math.round((t.nextDeskAt - (net.world?.serverNow || Date.now())) / 60000)) : null;
  const cash = t.mode === "live" ? t.realSol : t.sol;
  root.innerHTML = `
    <div class="card hero">
      <div class="row"><span class="mode ${t.mode}">${t.mode.toUpperCase()}</span><span class="dim">${t.mode === "paper" ? "Virtual SOL, real prices, real rules." : "Real wallet, real trades."}</span></div>
      <div class="big">${sol(t.equitySol)}</div>
      <div class="${t.pnlSol >= 0 ? "up" : "down"}">${signed(t.pnlSol)} SOL (${signed(t.pnlPct, 1)}%) since start · cash ${sol(cash)}${t.solUsd ? ` · SOL $${Number(t.solUsd).toFixed(0)}` : ""}</div>
      ${t.mode === "paper" && t.realSol != null ? `<div class="dim">Real wallet: ${sol(t.realSol, 4)} (used for the coin launch and gifts)</div>` : ""}
      ${t.halted ? `<div class="halt">${icon("stop", "bad")} ${esc(t.halted.reason)}</div>` : ""}
      ${t.thesis ? `<div class="thesis">“${esc(t.thesis)}”</div>` : ""}
      <div class="dim">${nextDesk != null ? `Next desk session in ~${nextDesk} min` : ""}</div>
    </div>
    ${scalperCard(world)}
    <div class="card"><h4>Positions</h4><table class="tbl"><thead><tr><th>Token</th><th>Value</th><th>PnL</th></tr></thead><tbody>${posRows}</tbody></table></div>
    <div class="card"><h4>Trade log</h4>${trades}</div>
    <div class="card support">
      <h4>Support the crew</h4>
      ${d.address ? `<div class="addr" title="Crew wallet"><code id="addr">${d.address}</code><button class="btn" id="copy-addr">Copy</button></div>` : `<p class="empty">The crew wallet isn't configured yet.</p>`}
      <p class="dim">Gifts to the crew, nothing more. No returns, no tokens, no promises. What you do get:</p>
      <ul class="perks">
        <li><b>0.01 SOL</b> your name on the Wall of Fame and a thank-you from the team</li>
        <li><b>0.05 SOL</b> the agents react to your message in their next conversation</li>
        <li><b>0.2 SOL</b> Pixel paints you a custom artwork</li>
      </ul>
      <div class="split">
        <div><h5>Wall of Fame · ${d.totalSol || 0} SOL total</h5><ul class="wall">${wall}</ul></div>
        <div><h5>Pixel's gallery</h5><div class="gallery">${gallery || `<span class="empty">Nothing painted yet.</span>`}</div></div>
      </div>
      <form id="perk-form" class="perk-form" autocomplete="off">
        <input id="perk-addr" placeholder="Your wallet address (the one you sent from)" maxlength="44" />
        <input id="perk-req" placeholder="What should Pixel paint? (needs 0.2 SOL sent)" maxlength="300" />
        <button type="submit" class="btn primary">Request artwork</button>
        <div class="dim" id="perk-help"></div>
      </form>
    </div>
    ${upgradesCard(world)}
    <div class="card"><h4>Desk rules</h4><ul class="rules">
      <li>Max 12% of equity per buy, max 20 buys a day, max 10 open positions</li>
      <li>Trading halts for the day after a 20% drawdown</li>
      <li>Small caps: $15k–$1M market cap, extra safety checks below $100k</li>
      <li>Automatic stop-loss at −30%, take half off at +60%</li>
      <li>Only tokens with real liquidity, at least 3h old, mint &amp; freeze revoked</li>
      <li>Every launch: a 0.2 SOL dev buy, sold once it is in profit, or after 3 minutes if nobody else buys; plus creator fees</li>
      <li>Coins launch only from stories on Juno's radar (fresh news or great older stories); the logo is the story's real photo or a picture Pixel generates for it</li>
    </ul></div>
    <div class="disclaimer">Nothing here is financial advice. Paper mode uses virtual SOL. The agents can be wrong, and often are.</div>`;
  $("#copy-addr")?.addEventListener("click", () => { navigator.clipboard?.writeText(d.address); $("#copy-addr").textContent = "Copied"; setTimeout(() => { $("#copy-addr").textContent = "Copy"; }, 1500); });
  $("#perk-form")?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const help = $("#perk-help");
    try { const r = await requestPerk($("#perk-addr").value.trim(), $("#perk-req").value.trim()); help.textContent = `Queued (#${r.queued}). Pixel paints one piece per minute or so.`; $("#perk-req").value = ""; }
    catch (err) { help.textContent = err.message; }
  });
}

// ---------------- coin lab ----------------
export function renderCoin(world) {
  const root = $("#coin-lab");
  if (!world) { root.innerHTML = `<p class="empty" style="padding:14px">Loading the plan…</p>`; return; }
  const plan = world.plan, launch = world.launch || { status: "none" };
  const idx = Math.max(0, STAGES.indexOf(plan.stage));
  const stages = STAGES.map((s, i) => `<div class="st ${i < idx ? "done" : i === idx ? "now" : ""}" title="${STAGE_INFO[s].label}"></div>`).join("");
  const logo = plan.logoUrl ? `<img src="${esc(displayUrl(plan.logoUrl))}" alt="logo">` : `<span class="ph">${esc((plan.ticker || "??").slice(0, 2))}</span>`;
  const list = (arr) => arr?.length ? `<ul>${arr.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` : `<p class="empty">Not decided yet.</p>`;
  const launchCard = {
    none: "", proposed: `<div class="card launch"><h4>Launch</h4><p>${icon("rocket", "pink")} The crew wants to launch <b>${esc(launch.name)}</b> ($${esc(launch.ticker)}) on pump.fun. Waiting for the owner's approval.</p></div>`,
    approved: `<div class="card launch"><h4>Launch</h4><p>${icon("rocket", "pink")} <b>${esc(launch.name)}</b> ($${esc(launch.ticker)}) is launching on pump.fun. Byte is preparing the transaction.</p></div>`,
    launched: `<div class="card launch"><h4>Launch</h4><p>${icon("live", "ok")} <b>${esc(launch.name)}</b> is live: <a href="${esc(launch.url)}" target="_blank" rel="noopener">${esc(launch.url)}</a><br><span class="dim">The dev buy is sold once it is in profit, or after 3 minutes if nobody else buys; the crew also earns creator fees.</span></p></div>`,
    simulated: `<div class="card launch"><h4>Launch</h4><p>${icon("flask", "sky")} Launch simulated (live launching is off). The coin exists on the whiteboard only.</p></div>`,
    failed: `<div class="card launch"><h4>Launch</h4><p>Launch failed: ${esc(launch.error || "unknown")}</p></div>`,
  }[launch.status] || "";
  const t = world.treasury || {};
  const launched = (world.launches || []).filter((l) => l.status === "launched");
  const launchedCard = launched.length ? `<div class="card launch"><h4>Launched by the crew · ${launched.length} coin${launched.length > 1 ? "s" : ""}</h4>
    <ul class="launched">${launched.map((l) => `<li>${l.logoUrl ? `<img src="${esc(displayUrl(l.logoUrl))}" alt="">` : ""}<div><b>${esc(l.name)}</b> <span class="coin-ticker">$${esc(l.ticker)}</span><br><a href="/coin/${encodeURIComponent(l.ticker)}">birth record</a> · <a href="${esc(l.url)}" target="_blank" rel="noopener">pump.fun</a> · <span class="dim">${new Date(l.launchedAt).toLocaleDateString()}</span></div></li>`).join("")}</ul>
    <p class="dim">Creator fees collected: <b>${(t.creatorFeesSol || 0).toFixed(4)} SOL</b>${t.pendingCreatorFeesSol ? ` · pending ${t.pendingCreatorFeesSol.toFixed(4)} SOL` : ""} · checked every 10 min. Launched autonomously; dev buys sold in profit, or after 3 min with no buyers.</p></div>` : "";
  root.innerHTML = `
    ${launchedCard}
    <div><div class="stage-label">${launched.length ? `Next coin (#${launched.length + 1})` : "Coin plan"} · stage ${idx + 1}/${STAGES.length} · <b>${STAGE_INFO[plan.stage]?.label || plan.stage}</b></div><div class="stages" style="margin-top:6px">${stages}</div></div>
    <div class="coin-hero">
      <div class="coin-logo">${logo}</div>
      <div>
        <div class="coin-name">${esc(plan.name || "Untitled")}${plan.ticker ? ` <span class="coin-ticker">$${esc(plan.ticker)}</span>` : ""}</div>
        <div class="coin-tag">${esc(plan.tagline || "The team hasn't named it yet. Give them a minute (or a tip).")}</div>
      </div>
    </div>
    ${launchCard}
    ${sourceCard(plan.source)}
    ${pollCard(world)}
    ${radarCard(world.signals)}
    ${researchCard(world.research)}
    <div class="card"><h4>Theme</h4>${plan.theme ? `<p>${esc(plan.theme)}</p>` : `<p class="empty">Still brainstorming.</p>`}</div>
    ${plan.candidates?.length && !plan.name ? `<div class="card"><h4>Candidates</h4>${list(plan.candidates)}</div>` : ""}
    <div class="card"><h4>Concept</h4>${plan.concept ? `<p>${esc(plan.concept)}</p>` : `<p class="empty">Not written yet.</p>`}</div>
    <div class="card"><h4>Logo prompt</h4>${plan.logoPrompt ? `<p>${esc(plan.logoPrompt)}</p>` : `<p class="empty">Pixel hasn't briefed the logo yet.</p>`}</div>
    <div class="card"><h4>Tokenomics</h4>${list(plan.tokenomics)}</div>
    <div class="card"><h4>Roadmap</h4>${list(plan.roadmap)}</div>
    ${plan.notes ? `<div class="card"><h4>Notes</h4><p>${esc(plan.notes)}</p></div>` : ""}
    <div class="disclaimer">The plan is written by the cookers and launches on pump.fun when it is ready. Each launch has a dev buy that the crew sells once it is in profit, or after 3 minutes if nobody else buys; it also earns creator fees. Coins inspired by public posts are not affiliated with or endorsed by their authors.</div>`;
}

// ---------------- holder vote (Phantom) ----------------
const vote = { wallet: null, busy: false, msg: "" };
const phantom = () => (window.phantom?.solana?.isPhantom ? window.phantom.solana : window.solana?.isPhantom ? window.solana : null);
function votedFor(pollId) { try { return localStorage.getItem(`cookers.vote.${pollId}`); } catch { return null; } }

function pollCard(world) {
  const poll = world.poll;
  if (!poll || poll.planId !== world.plan?.id) return "";
  const open = poll.status === "open";
  const mine = votedFor(poll.id);
  const total = (poll.tally || []).reduce((s, t) => s + (t.weight || 0), 0) || 1;
  const mins = Math.max(0, Math.round((poll.closesAt - (net.world?.serverNow || Date.now())) / 60000));
  const rows = poll.options.map((o, i) => {
    const t = poll.tally?.[i] || { votes: 0, weight: 0 };
    const win = poll.winner === i;
    return `<div class="vote-opt ${win ? "win" : ""} ${String(i) === mine ? "mine" : ""}">
      <div class="vote-row"><span>${win ? icon("trophy", "gold") : ""}${esc(o)}</span>${open ? `<button class="btn" data-vote="${i}" ${vote.busy ? "disabled" : ""}>${String(i) === mine ? `Voted ${icon("check")}` : "Vote"}</button>` : `<span class="dim">${t.votes} votes</span>`}</div>
      <div class="vote-bar"><i style="width:${Math.round((t.weight / total) * 100)}%"></i></div>
      <div class="dim">${t.votes} vote${t.votes === 1 ? "" : "s"} · weight ${t.weight}</div></div>`;
  }).join("");
  const wallet = vote.wallet
    ? `<span class="dim">Wallet ${short(vote.wallet)} connected</span>`
    : phantom() ? `<button class="btn primary" data-act="connect">Connect Phantom to vote</button>` : `<a class="btn" href="https://phantom.app/" target="_blank" rel="noopener">Install Phantom to vote</a>`;
  return `<div class="card poll"><h4>${icon("ballot")} Holder vote · ${open ? `closes in ${mins} min` : "closed"} · ${poll.voters || 0} voters</h4>
    <p class="dim">${open ? "Which coin should the crew cook next? One signed vote per wallet; holders of the crew's coins count 3x (10x for 1M+ tokens). Signing is free and sends no transaction." : poll.winner != null ? "Holders picked the winner. The crew builds it." : "No votes, the crew decides."}</p>
    ${rows}
    ${open ? `<div class="vote-foot">${wallet}${vote.msg ? `<div class="dim">${esc(vote.msg)}</div>` : ""}</div>` : ""}</div>`;
}

async function onCoinLabClick(ev) {
  const btn = ev.target.closest("[data-act], [data-vote]");
  if (!btn) return;
  const provider = phantom();
  if (!provider) return;
  try {
    if (!vote.wallet || btn.dataset.act === "connect") {
      const resp = await provider.connect();
      vote.wallet = resp.publicKey.toString();
      vote.msg = "";
    }
    if (btn.dataset.vote !== undefined) {
      const poll = net.world?.poll, option = Number(btn.dataset.vote), ts = Date.now();
      vote.busy = true; vote.msg = "Sign the vote in Phantom…"; renderCoin(net.world);
      const signed = await provider.signMessage(new TextEncoder().encode(voteMessage(poll.id, option, vote.wallet, ts)), "utf8");
      const sig = btoa(String.fromCharCode(...(signed.signature || signed)));
      const res = await fetch("/api/vote", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pollId: poll.id, option, address: vote.wallet, signature: sig, ts }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `vote failed (${res.status})`);
      try { localStorage.setItem(`cookers.vote.${poll.id}`, String(option)); } catch { /* private mode */ }
      vote.msg = `Vote counted with weight ${data.weight}${data.held ? ` (you hold ${Math.round(data.held).toLocaleString()} crew tokens)` : ""}. You can change it until the vote closes.`;
    }
  } catch (err) {
    vote.msg = err?.message || String(err);
  }
  vote.busy = false;
  renderCoin(net.world);
}

// ---------------- leaderboard & upgrades ----------------
export function renderLeaderboard(world) {
  const rows = world?.leaderboard || [];
  const el = $("#leaderboard");
  if (!el) return;
  el.innerHTML = `<div class="card board"><h4>Trader leaderboard · whose calls made money (paper)</h4>
    ${rows.map((r, i) => `<div class="board-row" data-id="${r.id}">
      <span class="rank">${i + 1}</span><img src="${portraits[r.id]}" alt=""><span class="nm" style="color:${byId[r.id].color}">${byId[r.id].name}</span>
      <span class="dim">${r.calls} calls · ${r.wins}/${r.closed} wins</span>
      <b class="${r.totalSol > 0 ? "up" : r.totalSol < 0 ? "down" : ""}">${signed(r.totalSol, 4)}</b></div>`).join("")}
    <p class="dim">A sell is credited to whoever opened the position. Open positions count at their current value.</p></div>`;
  el.querySelectorAll(".board-row").forEach((row) => row.addEventListener("click", () => openProfile(row.dataset.id)));
}

function scalperCard(world) {
  const s = world.scalper;
  if (!s) return `<div class="card"><h4>${icon("zap", "gold")} Scalper</h4><p class="empty">Warming up: first scan within a minute.</p></div>`;
  const d = s.stats || {}, a = s.allTime || {};
  const winRate = a.exits ? Math.round((a.wins / a.exits) * 100) : null;
  const ago = s.lastScanAt ? Math.max(0, Math.round(((net.world?.serverNow || Date.now()) - s.lastScanAt) / 1000)) : null;
  const watch = (s.candidates || []).slice(0, 5).map((c) => `<li><b>${esc(c.symbol)}</b> <span class="up">${signed(c.change5m, 1)}% 5m</span> <span class="dim">· ${c.setup === "migration" ? `migrated ${c.gradMin}m ago` : "breakout"} · buyers ${c.ratio}× · $${Math.round((c.vol5m || 0) / 1000)}k 5m vol</span></li>`).join("");
  const by = Object.entries(s.bySetup || {}).map(([k, v]) => `${k}: <b class="${v.realizedSol >= 0 ? "up" : "down"}">${signed(v.realizedSol, 4)}</b> (${v.wins}/${v.exits})`).join(" · ");
  return `<div class="card scalper"><h4>${icon("zap", "gold")} Scalper · fresh pump.fun migrations, in and out fast</h4>
    <div class="stat-row">
      <div class="stat">Today<b>${d.entries || 0} in · ${d.exits || 0} out</b></div>
      <div class="stat">Today PnL<b class="${(d.realizedSol || 0) >= 0 ? "up" : "down"}">${signed(d.realizedSol || 0, 4)}</b></div>
      <div class="stat">All time<b class="${(a.realizedSol || 0) >= 0 ? "up" : "down"}">${signed(a.realizedSol || 0, 4)}</b></div>
      <div class="stat">Win rate<b>${winRate == null ? "—" : `${winRate}%`}</b></div>
    </div>
    ${by ? `<p class="dim">By setup: ${by}</p>` : ""}
    <p class="dim">Main setup: coins that migrated off pump.fun (or another launchpad) in the last 4 hours and pull real 5-minute volume with buyers ahead. 15% of equity per trade; half sold at +10%, the rest trails and is fully out by +20%; −10% stop; out after 12 minutes if it goes nowhere. Second setup: strong breakouts on established high-volume coins. Scanned ${s.scanned || 0} hot coins (${s.freshMigrations || 0} fresh migrations)${ago != null ? ` ${ago}s ago` : ""}.</p>
    ${watch ? `<h5 class="sub-h">Breakout watchlist</h5><ul class="watch">${watch}</ul>` : `<p class="dim">No breakout passes the filters right now. Waiting is part of the strategy.</p>`}</div>`;
}

function upgradesCard(world) {
  const owned = new Set(world.upgrades || []), m = world.upgradeMetrics || {};
  return `<div class="card"><h4>Office upgrades · ${owned.size}/${UPGRADES.length}</h4><ul class="upgrades">${UPGRADES.map((u) => {
    const have = owned.has(u.id), cur = Math.max(0, m[u.metric] || 0), pct = Math.min(100, Math.round((cur / u.target) * 100));
    return `<li class="${have ? "have" : ""}"><span>${have ? icon("checkCircle", "ok") : icon("lock")}</span><div><b>${esc(u.name)}</b><div class="dim">${have ? esc(u.desc) : esc(u.label)}</div>${have ? "" : `<div class="vote-bar"><i style="width:${pct}%"></i></div>`}</div></li>`;
  }).join("")}</ul></div>`;
}

function sourceCard(src) {
  if (!src) return "";
  return `<div class="card"><h4>Built on</h4><p>${src.author ? `<b>@${esc(src.author)}</b> posted: ` : `<b>${esc(src.feed || "News")}</b>: `}"${esc(src.title)}"${src.url ? ` <a href="${esc(src.url)}" target="_blank" rel="noopener">source</a>` : ""}</p></div>`;
}

function radarCard(sig) {
  if (!sig?.feed?.length) return "";
  const ago = (t) => { const m = Math.max(0, Math.round((Date.now() - (t || Date.now())) / 60_000)); return m < 60 ? `${m}m` : `${Math.round(m / 60)}h`; };
  const rows = sig.feed.slice(0, 8).map((i) => `<li><span class="score s${i.score >= 8 ? "hot" : i.score >= 6 ? "warm" : "cool"}">${i.score}</span> <span class="dim">${esc(i.author ? "@" + i.author : i.feed)} · ${ago(i.at)}</span><br>${i.url ? `<a href="${esc(i.url)}" target="_blank" rel="noopener">${esc(i.title.slice(0, 140))}</a>` : esc(i.title.slice(0, 140))}${i.angle ? `<br><span class="dim">→ ${esc(i.angle)}</span>` : ""}</li>`).join("");
  return `<div class="card radar"><h4>${icon("radar", "sky")} Juno's news radar${sig.hot ? ` · ${icon("flame", "warn")} flash sprint queued` : ""}</h4>
    <p class="dim">Live world headlines, animal &amp; zoo stories, viral news, AI, tech and crypto${sig.x ? ", plus posts from big X accounts" : " and Trump's Truth Social posts"}, plus a story desk that digs up great older stories every 30 minutes, scored 0-10 for coin potential. 6+ triggers a flash launch.${sig.xError ? ` <span class="dim">X watcher: ${esc(sig.xError)}</span>` : ""}</p>
    <ul class="radar-list">${rows}</ul></div>`;
}

function researchCard(r) {
  if (!r) return `<div class="card research"><h4>Market research</h4><p class="empty">Sage and Juno haven't browsed the web yet.</p></div>`;
  if (!r.trends?.length) return `<div class="card research"><h4>Market research</h4><p class="empty">Research failed${r.error ? `: ${esc(r.error)}` : ""}. They'll try again later.</p></div>`;
  const age = Math.max(0, Math.round((Date.now() - r.at) / 60000));
  return `<div class="card research">
    <h4>Market research · ${age < 60 ? `${age} min ago` : `${Math.round(age / 60)} h ago`} · ${r.searches || 0} searches</h4>
    <ul class="trends">${r.trends.map((t) => `<li><b>${esc(t.title)}</b> <span class="dim">${esc(t.why)}</span>${t.source ? ` <a href="${esc(t.source)}" target="_blank" rel="noopener">source</a>` : ""}</li>`).join("")}</ul>
    ${r.ideas?.length ? `<h5>Concept seeds</h5><ul class="seeds">${r.ideas.map((i) => `<li><b>${esc(i.name)}</b> <span class="coin-ticker">$${esc(i.ticker)}</span> <span class="dim">${esc(i.hook)}</span></li>`).join("")}</ul>` : ""}
    ${r.avoid?.length ? `<p class="dim">Avoiding: ${r.avoid.map(esc).join(" · ")}</p>` : ""}
  </div>`;
}

export function updateScreenLogo(renderer, url) {
  if (!url) { renderer.logoImage = null; return; }
  if (renderer.logoImage?.dataset?.src === url) return;
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.dataset.src = url;
  img.onload = () => { renderer.logoImage = img; };
  img.onerror = () => { renderer.logoImage = null; };
  img.src = displayUrl(url);
}
