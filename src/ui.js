// DOM side: chat log, speech bubbles, roster, agent cards, profile modal, coin lab, status.
import { AGENTS, byId, STAGES, STAGE_INFO } from "../shared/roster.js";
import { portraitDataURL } from "./sprites.js";
import { transcript, tips, aiState, addTip } from "./dialogue.js";
import { plan, logoState, stageIndex, generateLogo, resetPlan, briefText, onPlanChange } from "./coin.js";

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));

export const portraits = {};

export function initUI({ sim, renderer, canvas, onTip }) {
  for (const a of AGENTS) portraits[a.id] = portraitDataURL(a.look);

  // ---- tabs ----
  for (const btn of document.querySelectorAll(".tab")) {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b === btn));
      document.querySelectorAll(".tab-page").forEach((p) => p.classList.toggle("active", p.id === `tab-${btn.dataset.tab}`));
    });
  }

  // ---- chat log ----
  const log = $("#chat-log");
  for (const e of transcript.slice(-60)) appendMessage(e, false);
  log.scrollTop = log.scrollHeight;

  // ---- tips ----
  const form = $("#tip-form"), input = $("#tip-input"), sendBtn = form.querySelector("button");
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const tip = addTip(input.value);
    if (!tip) return;
    input.value = "";
    sendBtn.disabled = true;
    setTimeout(() => { sendBtn.disabled = false; }, 8000);
    onTip?.(tip);
  });

  // ---- roster chips + agent cards ----
  const roster = $("#roster"), grid = $("#agent-grid");
  for (const a of AGENTS) {
    const chip = document.createElement("button");
    chip.className = "chip"; chip.style.setProperty("--c", a.color); chip.dataset.id = a.id;
    chip.innerHTML = `<img src="${portraits[a.id]}" alt=""><span><b>${a.name}</b> <span class="act"></span></span>`;
    chip.addEventListener("click", () => openProfile(a.id, sim));
    roster.appendChild(chip);

    const card = document.createElement("div");
    card.className = "agent-card"; card.style.setProperty("--c", a.color); card.dataset.id = a.id;
    card.innerHTML = `<img src="${portraits[a.id]}" alt=""><div class="n">${a.name}</div><div class="r">${a.role}</div><div class="a"></div>`;
    card.addEventListener("click", () => openProfile(a.id, sim));
    grid.appendChild(card);
  }

  // ---- canvas clicks ----
  const toCanvas = (ev) => {
    const rect = canvas.getBoundingClientRect();
    return { x: (ev.clientX - rect.left) * (canvas.width / rect.width), y: (ev.clientY - rect.top) * (canvas.height / rect.height) };
  };
  canvas.addEventListener("click", (ev) => { const { x, y } = toCanvas(ev); const a = renderer.agentAt(x, y, sim.agents); if (a) openProfile(a.id, sim); });
  canvas.addEventListener("mousemove", (ev) => { const { x, y } = toCanvas(ev); canvas.classList.toggle("hover", !!renderer.agentAt(x, y, sim.agents)); });

  // ---- modal ----
  $("#profile-modal").addEventListener("click", (ev) => { if (ev.target.dataset.close !== undefined || ev.target.classList.contains("close")) closeProfile(); });
  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") closeProfile(); });

  // ---- coin lab ----
  onPlanChange(() => { renderCoin(); updateScreenLogo(renderer); });
  renderCoin();
  updateScreenLogo(renderer);

  // ---- clock ----
  const tick = () => { const d = new Date(); $("#clock").textContent = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
  tick(); setInterval(tick, 10000);
}

// ---------------- chat ----------------
export function appendMessage(e, scroll = true) {
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
    el.className = "scene-title"; el.textContent = e.text;
  } else {
    el.className = "msg system";
    el.innerHTML = `<div class="text">${e.html || esc(e.text)}</div>`;
  }
  log.appendChild(el);
  while (log.children.length > 220) log.removeChild(log.firstChild);
  if (scroll) log.scrollTop = log.scrollHeight;
}

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
      if (!el) {
        el = document.createElement("div");
        el.style.setProperty("--bc", a.def.color);
        layer.appendChild(el);
        bubbleEls.set(a.id, el);
      }
      if (el.dataset.text !== a.bubble.text) {
        el.dataset.text = a.bubble.text;
        el.className = `bubble ${a.bubble.emotion || ""}`;
        el.innerHTML = `<span class="who">${a.def.name}</span>${esc(a.bubble.text)}`;
      }
      const h = renderer.headPos(a);
      el.style.left = `${offX + h.x * sx}px`;
      el.style.top = `${offY + h.y * sy}px`;
    } else if (el) {
      el.remove();
      bubbleEls.delete(a.id);
    }
  }
}

// ---------------- roster / cards ----------------
export function updateRoster(sim) {
  for (const a of sim.agents) {
    const chip = document.querySelector(`.chip[data-id="${a.id}"]`);
    if (chip) { chip.querySelector(".act").textContent = a.describe(); chip.classList.toggle("talking", a.talking); }
    const card = document.querySelector(`.agent-card[data-id="${a.id}"] .a`);
    if (card) card.textContent = a.describe();
  }
}

// ---------------- status ----------------
export function updateStatus() {
  const el = $("#ai-status");
  el.classList.remove("online", "offline", "busy");
  let label;
  if (!aiState.checked) label = "connecting…";
  else if (aiState.paused) { label = "AI paused"; el.classList.add("offline"); }
  else if (!aiState.claude) { label = "offline mode (no API key)"; el.classList.add("offline"); }
  else if (aiState.busy) { label = "agents thinking…"; el.classList.add("busy"); }
  else { label = `live · ${aiState.model || "claude"}${aiState.fal ? " · fal" : ""}`; el.classList.add("online"); }
  if (aiState.lastError) label += " · last call failed";
  el.querySelector(".label").textContent = label;
}

// ---------------- profile ----------------
export function openProfile(id, sim) {
  const a = byId[id];
  const live = sim.agent(id);
  const card = $("#profile-card");
  card.style.setProperty("--c", a.color);
  const skills = Object.entries(a.skills).map(([k, v]) => `<div class="skill"><span>${k}</span><div class="bar"><i data-w="${v}"></i></div><span class="v">${v}</span></div>`).join("");
  card.innerHTML = `
    <button class="close" aria-label="Close">×</button>
    <div class="profile-head">
      <img src="${portraits[id]}" alt="${a.name}">
      <div>
        <h2>${a.name}</h2>
        <div class="role">${a.title} · ${a.role}</div>
        <div class="quote">“${a.tagline}”</div>
      </div>
    </div>
    <div class="profile-section"><p style="margin:0">${a.bio}</p></div>
    <div class="profile-section"><h4>Right now</h4><div class="stat-row">
      <div class="stat">Activity<b>${live?.describe() || "—"}</b></div>
      <div class="stat">Mood<b>${live?.mood || "—"}</b></div>
      <div class="stat">Lines spoken<b>${live?.linesSpoken ?? 0}</b></div>
    </div></div>
    <div class="profile-section"><h4>Skills</h4>${skills}</div>
    <div class="profile-section"><h4>Personality</h4><div class="traits">${a.traits.map((t) => `<span>${t}</span>`).join("")}</div></div>
    <div class="profile-section"><h4>Favorite spots</h4><div class="traits">${[...new Set(a.favorites)].map((t) => `<span>${t}</span>`).join("")}</div></div>
  `;
  $("#profile-modal").hidden = false;
  requestAnimationFrame(() => card.querySelectorAll(".bar i").forEach((i) => { i.style.width = `${i.dataset.w}%`; }));
}
export function closeProfile() { $("#profile-modal").hidden = true; }

// ---------------- coin lab ----------------
export function renderCoin() {
  const root = $("#coin-lab");
  const idx = stageIndex();
  const stages = STAGES.map((s, i) => `<div class="st ${i < idx ? "done" : i === idx ? "now" : ""}" title="${STAGE_INFO[s].label}"></div>`).join("");
  const logo = plan.logoUrl
    ? `<img src="${esc(plan.logoUrl)}" alt="logo">`
    : `<span class="ph">${esc((plan.ticker || "??").slice(0, 2))}</span>`;
  const list = (arr) => arr.length ? `<ul>${arr.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` : `<p class="empty">Not decided yet.</p>`;
  root.innerHTML = `
    <div>
      <div class="stage-label">Stage ${idx + 1}/${STAGES.length} · <b>${STAGE_INFO[plan.stage].label}</b></div>
      <div class="stages" style="margin-top:6px">${stages}</div>
    </div>
    <div class="coin-hero">
      <div class="coin-logo ${logoState.inflight ? "loading" : ""}">${logo}</div>
      <div>
        <div class="coin-name">${esc(plan.name || "Untitled")}${plan.ticker ? ` <span class="coin-ticker">$${esc(plan.ticker)}</span>` : ""}</div>
        <div class="coin-tag">${esc(plan.tagline || "The team hasn't named it yet. Give them a minute (or a tip).")}</div>
        ${logoState.inflight ? `<div class="coin-tag">🎨 Pixel is rendering the logo…</div>` : ""}
        ${logoState.error ? `<div class="coin-tag" style="color:var(--bad)">Logo failed: ${esc(logoState.error)}</div>` : ""}
      </div>
    </div>
    <div class="card"><h4>Theme</h4>${plan.theme ? `<p>${esc(plan.theme)}</p>` : `<p class="empty">Still brainstorming.</p>`}</div>
    ${plan.candidates.length && !plan.name ? `<div class="card"><h4>Candidates</h4>${list(plan.candidates)}</div>` : ""}
    <div class="card"><h4>Concept</h4>${plan.concept ? `<p>${esc(plan.concept)}</p>` : `<p class="empty">Not written yet.</p>`}</div>
    <div class="card"><h4>Logo prompt</h4>${plan.logoPrompt ? `<p>${esc(plan.logoPrompt)}</p>` : `<p class="empty">Pixel hasn't briefed the logo yet.</p>`}</div>
    <div class="card"><h4>Tokenomics</h4>${list(plan.tokenomics)}</div>
    <div class="card"><h4>Roadmap</h4>${list(plan.roadmap)}</div>
    ${plan.notes ? `<div class="card"><h4>Notes</h4><p>${esc(plan.notes)}</p></div>` : ""}
    <div class="coin-actions">
      <button class="btn primary" id="btn-logo" ${!plan.logoPrompt || logoState.inflight ? "disabled" : ""}>${plan.logoUrl ? "Regenerate logo" : "Render logo"}</button>
      <button class="btn" id="btn-brief" ${!plan.name ? "disabled" : ""}>Download brief</button>
      <button class="btn danger" id="btn-reset">Start over</button>
    </div>
    <div class="disclaimer">The agents only plan. Nothing is deployed, no funds are held, nothing here is financial advice. ${tips.length ? `${tips.filter((t) => !t.consumed).length} tip(s) waiting for the next conversation.` : ""}</div>
  `;
  $("#btn-logo")?.addEventListener("click", () => generateLogo({ force: true }));
  $("#btn-brief")?.addEventListener("click", () => {
    const blob = new Blob([briefText()], { type: "text/markdown" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${(plan.ticker || "coin").toLowerCase()}-brief.md`; a.click();
  });
  $("#btn-reset")?.addEventListener("click", () => { if (confirm("Throw away the current coin plan? The agents will start brainstorming again.")) resetPlan(); });
}

function updateScreenLogo(renderer) {
  if (!plan.logoUrl) { renderer.logoImage = null; return; }
  if (renderer.logoImage?.dataset?.src === plan.logoUrl) return;
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.dataset.src = plan.logoUrl;
  img.onload = () => { renderer.logoImage = img; };
  img.onerror = () => { renderer.logoImage = null; };
  img.src = plan.logoUrl;
}
