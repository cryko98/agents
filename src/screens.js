// What each cooker has on their monitor: their actual job, drawn from the live world.
// Logical canvas SCREEN_W x SCREEN_H; callers scale the context (2x on the desk, 4x in the close-up).
//   Nova  (Founder & Narrative)   roadmap for the next coin
//   Byte  (Solana Engineer)       terminal: launch transactions, dev sells, fees, wallet
//   Pixel (Brand & Design)        design tool with the real logo and past logos
//   Max   (Tokenomics & Markets)  paper trading desk: positions, trades, PnL, scalper
//   Sage  (Community & Strategy)  strategy doc: trends, leaderboard, supporters
//   Juno  (Content & Virality)    the news radar as a social feed
import { STAGES, STAGE_INFO, byId } from "../shared/roster.js";
import { displayUrl } from "../shared/media.js";

export const SCREEN_W = 320, SCREEN_H = 200;
const MONO = "'SFMono-Regular', Consolas, 'Liberation Mono', monospace";
const SANS = "Inter, system-ui, sans-serif";

// ---------- helpers ----------
const short = (s, a = 4, b = 4) => (s && s.length > a + b + 1 ? `${s.slice(0, a)}…${s.slice(-b)}` : s || "—");
const sol = (n, d = 4) => (n == null ? "—" : `${Number(n).toFixed(d)}`);
const signed = (n, d = 4) => (n == null ? "—" : `${n >= 0 ? "+" : ""}${Number(n).toFixed(d)}`);
const hhmm = (t) => (t ? new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "");
const ago = (t) => { if (!t) return ""; const m = Math.max(0, Math.round((Date.now() - t) / 60000)); return m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`; };
const hue = (s) => { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; };

function text(ctx, s, x, y, { size = 9, color = "#e8ecff", weight = "", font = SANS, align = "left", max } = {}) {
  ctx.font = `${weight} ${size}px ${font}`;
  ctx.fillStyle = color; ctx.textAlign = align;
  let str = String(s ?? "");
  if (max) while (str.length > 1 && ctx.measureText(str).width > max) str = str.slice(0, -2) + "…";
  ctx.fillText(str, x, y);
  ctx.textAlign = "left";
}

/** Word-wrap into at most `lines` lines; returns the y after the last line. */
function wrap(ctx, s, x, y, maxW, lineH, lines, opts = {}) {
  ctx.font = `${opts.weight || ""} ${opts.size || 9}px ${opts.font || SANS}`;
  const words = String(s ?? "").split(/\s+/).filter(Boolean);
  let line = "", n = 0;
  for (let i = 0; i < words.length; i++) {
    const test = line ? `${line} ${words[i]}` : words[i];
    if (ctx.measureText(test).width > maxW && line) {
      n++;
      if (n === lines) { text(ctx, line + "…", x, y, { ...opts, max: maxW }); return y + lineH; }
      text(ctx, line, x, y, opts); y += lineH; line = words[i];
    } else line = test;
  }
  if (line) { text(ctx, line, x, y, { ...opts, max: maxW }); y += lineH; }
  return y;
}

/** Window chrome: title bar with the app name, the owner's dot and the real clock. */
function chrome(ctx, bg, bar, title, color, dark = true) {
  ctx.fillStyle = bg; ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
  ctx.fillStyle = bar; ctx.fillRect(0, 0, SCREEN_W, 16);
  for (const [i, c] of ["#ff5f57", "#febc2e", "#28c840"].entries()) { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(8 + i * 9, 8, 2.6, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = color; ctx.beginPath(); ctx.arc(40, 8, 3, 0, Math.PI * 2); ctx.fill();
  text(ctx, title, 47, 11, { size: 8, color: dark ? "#cbd5e1" : "#334155", weight: "600", max: 210 });
  text(ctx, new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), SCREEN_W - 6, 11, { size: 8, color: dark ? "#94a3b8" : "#64748b", align: "right" });
}

// images (logos) load once, through a CORS-friendly gateway; failures just don't draw
const images = new Map();
function image(url) {
  if (!url) return null;
  const src = displayUrl(url);
  let e = images.get(src);
  if (!e) {
    const img = new Image();
    img.crossOrigin = "anonymous";
    e = { img, ok: false };
    img.onload = () => { e.ok = true; };
    img.src = src;
    images.set(src, e);
  }
  return e.ok ? e.img : null;
}
function drawImageCover(ctx, img, x, y, w, h) {
  const s = Math.max(w / img.width, h / img.height), iw = img.width * s, ih = img.height * s;
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.drawImage(img, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih); ctx.restore();
}

// ---------- the six screens ----------
const SCREENS = {
  // Byte: a terminal session over the crew's real on-chain activity
  byte(ctx, w, t, color) {
    chrome(ctx, "#0d1117", "#161b22", "byte@cookers: ~/launcher — zsh", color);
    const tr = w.treasury || {}, lines = [];
    const cmd = (s) => lines.push(["cmd", s]);
    const out = (s, c = "#c9d1d9") => lines.push(["out", s, c]);
    cmd(`solana balance ${short(tr.address, 4, 4)}`);
    out(`${sol(tr.realSol)} SOL`, "#7ee787");
    cmd("cookers launches --recent");
    const launched = (w.launches || []).filter((l) => l.status === "launched").slice(0, 4);
    if (!launched.length) out("no coins launched yet · radar is watching", "#8b949e");
    for (const l of launched) {
      out(`✔ $${l.ticker}  mint ${short(l.mint)}  tx ${short(l.signature)}  ${hhmm(l.launchedAt)}`, "#79c0ff");
      const d = l.devSell;
      // older launches only recorded what came back, newer ones the profit or loss too
      if (d?.status === "sold" && d.pnl != null) out(`  ↳ dev sell ${signed(d.pnl)} SOL${d.noBuyers ? " (no buyers)" : ""}`, d.pnl >= 0 ? "#7ee787" : "#ffa198");
      else if (d?.status === "sold") out(`  ↳ dev bag sold · ${sol(d.solBack)} SOL back`, "#8b949e");
      else if (d) out(`  ↳ dev bag held · worth ${sol(d.value)} SOL (${d.pnlPct ?? "—"}%)`, "#d2a8ff");
    }
    cmd("cookers fees");
    out(`creator fees ${sol(tr.creatorFeesSol || 0)} SOL · pending ${sol(tr.pendingCreatorFeesSol || 0)}`, "#e3b341");
    const p = w.plan || {};
    cmd("cookers next");
    out(p.ticker ? `$${p.ticker} · ${STAGE_INFO[p.stage]?.label || p.stage}` : "waiting for the next story", "#c9d1d9");
    // show the tail that fits, cursor blinking on a fresh prompt
    const lineH = 11, maxLines = Math.floor((SCREEN_H - 24) / lineH) - 1;
    const view = lines.slice(-maxLines);
    let y = 28;
    for (const [kind, s, c] of view) {
      if (kind === "cmd") { text(ctx, "❯", 6, y, { size: 8, color: "#7ee787", font: MONO }); text(ctx, s, 16, y, { size: 8, color: "#e6edf3", font: MONO, max: SCREEN_W - 22 }); }
      else text(ctx, s, 16, y, { size: 8, color: c, font: MONO, max: SCREEN_W - 22 });
      y += lineH;
    }
    text(ctx, "❯", 6, y, { size: 8, color: "#7ee787", font: MONO });
    if (Math.floor(t * 2) % 2) { ctx.fillStyle = "#e6edf3"; ctx.fillRect(16, y - 7, 5, 9); }
  },

  // Max: the paper trading desk
  max(ctx, w, t, color) {
    chrome(ctx, "#0b0f19", "#111827", "Cookers Desk — paper trading", color);
    const tr = w.treasury || {};
    text(ctx, "EQUITY", 8, 30, { size: 7, color: "#64748b", weight: "700" });
    text(ctx, `${sol(tr.equitySol, 3)} SOL`, 8, 44, { size: 14, weight: "700" });
    text(ctx, `${signed(tr.pnlSol, 3)} SOL (${tr.pnlPct ?? 0}%)`, 8, 56, { size: 8, color: (tr.pnlSol || 0) >= 0 ? "#22c55e" : "#ef4444", weight: "600" });
    if (tr.solUsd) text(ctx, `SOL $${Number(tr.solUsd).toFixed(2)}`, SCREEN_W - 8, 78, { size: 7.5, color: "#94a3b8", align: "right" });
    // cumulative realized PnL over the real trade history
    const trades = [...(tr.trades || [])].reverse();
    const pts = [0];
    for (const x of trades) if (x.side === "sell") pts.push(pts[pts.length - 1] + (x.realized || 0));
    const cx = 120, cy = 24, cw = SCREEN_W - cx - 8, ch = 40;
    ctx.strokeStyle = "#1f2937"; ctx.strokeRect(cx, cy, cw, ch);
    const lo = Math.min(...pts, 0), hi = Math.max(...pts, 0.0001);
    ctx.beginPath();
    pts.forEach((v, i) => { const x = cx + (pts.length < 2 ? cw : (i / (pts.length - 1)) * cw), y = cy + ch - ((v - lo) / (hi - lo || 1)) * ch; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.strokeStyle = pts[pts.length - 1] >= 0 ? "#22c55e" : "#ef4444"; ctx.lineWidth = 1.4; ctx.stroke(); ctx.lineWidth = 1;
    text(ctx, "realized PnL", cx + 3, cy + 9, { size: 6.5, color: "#64748b" });
    // open positions
    text(ctx, "OPEN POSITIONS", 8, 78, { size: 7, color: "#64748b", weight: "700" });
    const pos = Object.values(tr.positions || {});
    if (!pos.length) text(ctx, "flat · no open positions", 8, 90, { size: 8, color: "#94a3b8" });
    pos.slice(0, 4).forEach((p, i) => {
      const y = 90 + i * 11, pnl = p.costSol ? ((p.valueSol - p.costSol) / p.costSol) * 100 : 0;
      text(ctx, p.symbol, 8, y, { size: 8, weight: "700", max: 60 });
      text(ctx, `${sol(p.costSol, 3)} → ${sol(p.valueSol, 3)} SOL`, 72, y, { size: 8, color: "#cbd5e1" });
      text(ctx, `${pnl >= 0 ? "+" : ""}${pnl.toFixed(1)}%`, SCREEN_W - 8, y, { size: 8, weight: "700", color: pnl >= 0 ? "#22c55e" : "#ef4444", align: "right" });
    });
    // last trades
    text(ctx, "LAST TRADES", 8, 142, { size: 7, color: "#64748b", weight: "700" });
    const last = (tr.trades || []).slice(0, 3);
    if (!last.length) text(ctx, "no trades yet", 8, 154, { size: 8, color: "#94a3b8" });
    last.forEach((x, i) => {
      const y = 154 + i * 11;
      text(ctx, x.side.toUpperCase(), 8, y, { size: 8, weight: "700", color: x.side === "buy" ? "#38bdf8" : "#f59e0b" });
      text(ctx, `${x.symbol} · ${sol(x.sol, 3)} SOL${x.side === "sell" ? ` · ${signed(x.realized, 4)}` : ""}`, 34, y, { size: 8, color: "#cbd5e1", max: 220 });
      text(ctx, hhmm(x.t), SCREEN_W - 8, y, { size: 7.5, color: "#64748b", align: "right" });
    });
    const sc = w.scalper?.stats;
    if (sc) text(ctx, `scalper today: ${sc.entries || 0} in · ${sc.exits || 0} out · ${sc.wins || 0} wins · ${signed(sc.realizedSol || 0)} SOL`, 8, SCREEN_H - 6, { size: 7, color: "#94a3b8", max: SCREEN_W - 16 });
  },

  // Pixel: the design file for the coin being made, with the real logo
  pixel(ctx, w, t, color) {
    const p = w.plan || {}, launched = (w.launches || []).filter((l) => l.status === "launched");
    const subject = p.ticker ? p : launched[0] || {};
    chrome(ctx, "#2b2d3a", "#23252f", `brand / ${subject.ticker ? `$${subject.ticker}` : "untitled"}.fig`, color);
    ctx.fillStyle = "#1e2029"; ctx.fillRect(0, 16, 26, SCREEN_H - 16);
    ["▢", "◯", "T", "✎", "⬚"].forEach((s, i) => text(ctx, s, 13, 32 + i * 18, { size: 9, color: i === Math.floor(t / 2) % 5 ? color : "#6b7280", align: "center" }));
    // artboard
    ctx.fillStyle = "#f5f3ee"; ctx.fillRect(36, 26, 150, 150);
    const img = image(subject.logoUrl);
    if (img) drawImageCover(ctx, img, 46, 36, 130, 100);
    else {
      ctx.fillStyle = `hsl(${hue(subject.ticker || "cook")},70%,60%)`; ctx.beginPath(); ctx.arc(111, 86, 42, 0, Math.PI * 2); ctx.fill();
      text(ctx, (subject.ticker || "??").slice(0, 3), 111, 92, { size: 18, weight: "800", color: "#fff", align: "center" });
    }
    text(ctx, subject.name || "next coin", 111, 154, { size: 11, weight: "800", color: "#111827", align: "center", max: 140 });
    text(ctx, subject.ticker ? `$${subject.ticker}` : "", 111, 166, { size: 9, weight: "700", color: "#6b7280", align: "center" });
    ctx.strokeStyle = "#38bdf8"; ctx.setLineDash([3, 2]); ctx.strokeRect(44, 34, 134, 104); ctx.setLineDash([]);
    // right panel: layers + past logos
    text(ctx, "LAYERS", 198, 30, { size: 7, color: "#9ca3af", weight: "700" });
    ["logo", "wordmark", "ticker", "background"].forEach((s, i) => text(ctx, `▸ ${s}`, 198, 42 + i * 10, { size: 8, color: i === 0 ? "#e5e7eb" : "#9ca3af" }));
    text(ctx, "PAST LOGOS", 198, 94, { size: 7, color: "#9ca3af", weight: "700" });
    const past = launched.slice(0, 6);
    if (!past.length) text(ctx, "none yet", 198, 106, { size: 8, color: "#6b7280" });
    past.forEach((l, i) => {
      const x = 198 + (i % 3) * 38, y = 100 + Math.floor(i / 3) * 40;
      ctx.fillStyle = "#3a3d4c"; ctx.fillRect(x, y, 34, 34);
      const li = image(l.logoUrl);
      if (li) drawImageCover(ctx, li, x, y, 34, 34);
      else text(ctx, l.ticker.slice(0, 3), x + 17, y + 20, { size: 8, weight: "700", color: "#e5e7eb", align: "center" });
    });
  },

  // Nova: the roadmap for the next coin
  nova(ctx, w, t, color) {
    const p = w.plan || {}, launched = (w.launches || []).filter((l) => l.status === "launched");
    chrome(ctx, "#1c1a2b", "#15131f", `Roadmap — coin #${launched.length + 1}`, color);
    const idx = Math.max(0, STAGES.indexOf(p.stage));
    const sw = (SCREEN_W - 16) / STAGES.length;
    STAGES.forEach((s, i) => {
      ctx.fillStyle = i < idx ? "#22c55e" : i === idx ? color : "#2e2a44";
      ctx.fillRect(8 + i * sw, 24, sw - 3, 5);
      text(ctx, STAGE_INFO[s]?.label || s, 8 + i * sw, 38, { size: 6.5, color: i === idx ? "#ffffff" : "#8b86a8", weight: i === idx ? "700" : "", max: sw - 4 });
    });
    text(ctx, p.name || "Next coin", 8, 60, { size: 15, weight: "800", max: 230 });
    if (p.ticker) text(ctx, `$${p.ticker}`, SCREEN_W - 8, 60, { size: 11, weight: "800", color, align: "right" });
    let y = wrap(ctx, p.tagline || "Waiting for the next big story on Juno's radar.", 8, 74, SCREEN_W - 16, 10, 2, { size: 8.5, color: "#c4b5fd" });
    if (p.concept) y = wrap(ctx, p.concept, 8, y + 2, SCREEN_W - 16, 10, 4, { size: 8, color: "#d1d5db" });
    if (p.source?.title) wrap(ctx, `built on: ${p.source.author ? "@" + p.source.author + " · " : ""}${p.source.title}`, 8, Math.max(y + 4, 140), SCREEN_W - 16, 10, 2, { size: 7.5, color: "#94a3b8" });
    const hot = w.signals?.hot;
    if (hot) wrap(ctx, `⚡ flash sprint queued: ${hot.title}`, 8, 168, SCREEN_W - 16, 10, 1, { size: 8, color: "#fbbf24", weight: "600" });
    text(ctx, `${launched.length} coin${launched.length === 1 ? "" : "s"} launched${launched[0] ? ` · last $${launched[0].ticker} ${ago(launched[0].launchedAt)} ago` : ""}`, 8, SCREEN_H - 7, { size: 7.5, color: "#8b86a8" });
  },

  // Sage: the strategy doc
  sage(ctx, w, t, color) {
    chrome(ctx, "#f8fafc", "#e2e8f0", "strategy.md — Cookers", color, false);
    const ink = "#1e293b", soft = "#64748b";
    text(ctx, "Trends to ride", 10, 32, { size: 11, weight: "800", color: ink });
    const trends = (w.research?.trends || []).slice(0, 3);
    const radar = (w.signals?.feed || []).filter((i) => (i.score || 0) >= 6).slice(0, 3);
    const items = trends.length ? trends.map((x) => x.title) : radar.map((x) => x.title);
    let y = 44;
    if (!items.length) { text(ctx, "• research desk hasn't reported yet", 12, y, { size: 8.5, color: soft }); y += 11; }
    for (const s of items) y = wrap(ctx, `• ${s}`, 12, y, SCREEN_W - 22, 10, 2, { size: 8.5, color: ink }) + 1;
    text(ctx, "Who's calling it right", 10, y + 8, { size: 11, weight: "800", color: ink });
    y += 20;
    (w.leaderboard || []).slice(0, 3).forEach((r, i) => {
      text(ctx, `${i + 1}. ${byId[r.id]?.name || r.id}`, 12, y, { size: 8.5, color: ink, weight: "600" });
      text(ctx, `${signed(r.totalSol, 3)} SOL · ${r.calls} calls · ${r.wins}/${r.closed} wins`, SCREEN_W - 10, y, { size: 8, color: (r.totalSol || 0) >= 0 ? "#15803d" : "#b91c1c", align: "right" });
      y += 11;
    });
    const d = w.donations || {};
    text(ctx, "Community", 10, y + 8, { size: 11, weight: "800", color: ink });
    text(ctx, `${sol(d.totalSol || 0, 3)} SOL from ${(d.wall || []).length} supporter${(d.wall || []).length === 1 ? "" : "s"}${d.wall?.[0] ? ` · latest ${short(d.wall[0].from)}` : ""}`, 12, y + 20, { size: 8.5, color: soft, max: SCREEN_W - 22 });
    if (Math.floor(t * 2) % 2) { ctx.fillStyle = ink; ctx.fillRect(12, Math.min(SCREEN_H - 12, y + 26), 1.2, 9); }
  },

  // Juno: the news radar as a social feed
  juno(ctx, w, t, color) {
    chrome(ctx, "#000000", "#0a0a0a", "Radar — For you", color);
    const hot = w.signals?.hot;
    const feed = [...(hot ? [{ ...hot, pinned: true }] : []), ...(w.signals?.feed || []).filter((i) => !hot || i.id !== hot.id)].slice(0, 8);
    if (!feed.length) { text(ctx, "radar warming up… scanning news & posts", SCREEN_W / 2, 100, { size: 9, color: "#71767b", align: "center" }); return; }
    const cardH = 44, visible = Math.floor((SCREEN_H - 18) / cardH);
    const start = feed.length > visible ? Math.floor(t / 4) % (feed.length - visible + 1) : 0;
    feed.slice(start, start + visible + 1).forEach((it, i) => {
      const y = 20 + i * cardH;
      ctx.fillStyle = "#16181c"; ctx.fillRect(0, y + cardH - 1, SCREEN_W, 1);
      ctx.fillStyle = `hsl(${hue(it.author || it.feed)},65%,55%)`; ctx.beginPath(); ctx.arc(14, y + 11, 7, 0, Math.PI * 2); ctx.fill();
      text(ctx, (it.author || it.feed || "?").slice(0, 1).toUpperCase(), 14, y + 14, { size: 8, weight: "800", color: "#000", align: "center" });
      text(ctx, it.author ? `@${it.author}` : it.feed, 26, y + 9, { size: 8, weight: "700", color: "#e7e9ea", max: 140 });
      text(ctx, `· ${ago(it.at)}${it.pinned ? " · 📌" : ""}`, 26 + Math.min(140, ctx.measureText(it.author ? `@${it.author}` : it.feed).width) + 4, y + 9, { size: 7.5, color: "#71767b" });
      const s = it.score ?? 0;
      ctx.fillStyle = s >= 8 ? "#f4212e" : s >= 6 ? "#ffad1f" : "#2f3336"; ctx.fillRect(SCREEN_W - 40, y + 2, 34, 11);
      text(ctx, `🔥 ${s}/10`, SCREEN_W - 23, y + 10, { size: 7, weight: "700", color: "#fff", align: "center" });
      wrap(ctx, it.title, 26, y + 20, SCREEN_W - 34, 9, 2, { size: 7.5, color: "#d6d9db" });
      if (it.angle) text(ctx, `→ ${it.angle}`, 26, y + 39, { size: 7, color: "#1d9bf0", max: SCREEN_W - 34 });
    });
  },
};

/** Draws `owner`'s screen into a context already scaled to SCREEN_W x SCREEN_H. */
export function drawScreen(owner, ctx, t, world, { active = true } = {}) {
  const color = byId[owner]?.color || "#7c5cff";
  if (!active || !world) return screensaver(ctx, t, color);
  if (!SCREENS[owner]) return screensaver(ctx, t, color);
  try { SCREENS[owner](ctx, world, t, color); }
  catch (err) { console.warn("[screen]", owner, err); screensaver(ctx, t, color); }
}

function screensaver(ctx, t, color) {
  ctx.fillStyle = "#0b0e17"; ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
  const x = 110 + Math.sin(t * 0.6) * 70, y = 100 + Math.cos(t * 0.45) * 50;
  text(ctx, "COOKERS", x, y, { size: 20, weight: "800", color, align: "center" });
}
