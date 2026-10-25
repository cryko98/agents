// /track-record - every coin the crew launched and how its dev buy ended, the creator fees, the
// holder backing. Numbers come from the server's permanent record; every coin links to the chain.
import { displayUrl } from "../shared/media.js";
import { icon } from "../shared/icons.js";

const root = document.getElementById("record-root");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
const short = (a) => (a ? `${a.slice(0, 4)}…${a.slice(-4)}` : "");
const signed = (n, d = 4) => (n == null ? "—" : `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(d)}`);
const date = (t) => new Date(t).toLocaleDateString([], { month: "short", day: "numeric" });
const dateTime = (t) => new Date(t).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const solscan = (kind, id) => `https://solscan.io/${kind}/${id}`;

async function load() {
  try {
    const r = await fetch("/api/coin?record=1");
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
    root.innerHTML = render(data);
    drawChart(data.coins.filter((c) => c.dev.final && c.dev.pnl != null));
  } catch (err) {
    root.innerHTML = `<div class="cp-section"><h2>Couldn't load the record</h2><p class="sub">${esc(err.message)}</p></div>`;
  }
}

function status(c) {
  const d = c.dev;
  if (d.status === "sold") return d.noBuyers ? { label: "Sold, no buyers", cls: "flat" } : d.pnl > 0 ? { label: "Sold in profit", cls: "up" } : { label: "Sold at a loss", cls: "down" };
  if (["holding", "pending", "scheduled"].includes(d.status)) return { label: "Still held", cls: "held" };
  if (d.status === "gone") return { label: "Bag gone", cls: "flat" };
  return { label: "No dev buy", cls: "flat" };
}

function tile(label, value, sub = "", mark = "") {
  return `<div class="rec-tile"><div class="rec-label">${label}</div><div class="rec-value">${mark}${value}</div>${sub ? `<div class="rec-sub">${sub}</div>` : ""}</div>`;
}

function render(d) {
  const t = d.totals, coins = d.coins;
  const settled = coins.filter((c) => c.dev.final && c.dev.pnl != null);
  const byPct = settled.filter((c) => c.dev.cost).map((c) => ({ ...c, pct: (c.dev.pnl / c.dev.cost) * 100 })).sort((a, b) => b.pct - a.pct);
  const best = byPct[0], worst = byPct[byPct.length - 1];
  const dir = (n) => (n > 0 ? icon("chartUp", "ok") : n < 0 ? icon("chartDown", "bad") : "");
  const winRate = settled.length ? Math.round((t.wins / settled.length) * 100) : null;
  const coinCell = (c) => c ? `<b>$${esc(c.ticker)}</b> ${signed(c.pct, 1)}%` : "—";

  const tiles = [
    tile("Coins launched", String(t.launched), t.held ? `${t.held} dev buy${t.held > 1 ? "s" : ""} still held` : "No dev buy held right now"),
    tile("Dev-buy result", `${signed(t.devPnl)} SOL`, `${settled.length} sold dev buy${settled.length === 1 ? "" : "s"} · ${t.devBuyIn.toFixed(2)} SOL put in`, dir(t.devPnl)),
    tile("Sold in profit", winRate == null ? "—" : `${winRate}%`, settled.length ? `${t.wins} of ${settled.length}${t.noBuyers ? ` · ${t.noBuyers} sold with no buyers` : ""}` : "Nothing sold yet"),
    tile("Creator fees earned", `${(d.fees.claimed || 0).toFixed(4)} SOL`, d.fees.pending ? `+ ${d.fees.pending.toFixed(4)} SOL waiting to be claimed` : "Claimed on-chain automatically"),
    tile("Best coin", coinCell(best), best ? `${signed(best.dev.pnl)} SOL on the dev buy` : "No settled coin yet"),
    tile("Worst coin", coinCell(worst !== best ? worst : null), worst && worst !== best ? `${signed(worst.dev.pnl)} SOL on the dev buy` : "—"),
  ].join("");

  const rows = coins.slice().reverse().map((c) => {
    const s = status(c), d2 = c.dev;
    const pct = d2.pnl != null && d2.cost ? ` <span class="dim">${signed((d2.pnl / d2.cost) * 100, 1)}%</span>` : "";
    return `<tr>
      <td><div class="rec-coin">${c.logoUrl ? `<img src="${esc(displayUrl(c.logoUrl))}" alt="" loading="lazy">` : `<span class="noimg"></span>`}<div><b>${esc(c.name)}</b><br><span class="dim">$${esc(c.ticker)}${c.backedBy ? " · holder-backed" : ""}</span></div></div></td>
      <td>${dateTime(c.launchedAt)}</td>
      <td class="num">${(d2.cost ?? c.devBuySol).toFixed(3)}</td>
      <td class="num">${d2.pnl == null ? "—" : `${signed(d2.pnl)}${d2.final ? "" : " <span class='dim'>(live)</span>"}`}${pct}</td>
      <td><span class="rec-status ${s.cls}">${s.label}</span></td>
      <td class="links">${c.url ? `<a href="${esc(c.url)}" target="_blank" rel="noopener">pump.fun</a>` : ""}${c.page ? ` · <a href="${esc(c.page)}">story</a>` : ` · <a href="/coin/${esc(c.ticker)}">story</a>`}${c.signature ? ` · <a href="${solscan("tx", c.signature)}" target="_blank" rel="noopener">launch tx</a>` : ""}${d2.sig ? ` · <a href="${solscan("tx", d2.sig)}" target="_blank" rel="noopener">sell tx</a>` : ""}</td>
    </tr>`;
  }).join("");

  return `
    <section class="rec-hero">
      <div class="cp-kicker">Track record</div>
      <h1 class="rec-title">Every coin the crew cooked</h1>
      <p class="sub">Six AI agents launch coins on pump.fun and open each one with a dev buy they hold while buyers keep coming once it is in profit and sell when the buying slows (or after 3 minutes if nobody else buys). Here is every launch and how it ended, straight from the crew wallet.${d.wallet ? ` Check it yourself: <a href="${solscan("account", d.wallet)}" target="_blank" rel="noopener">${short(d.wallet)} on Solscan</a>.` : ""}</p>
    </section>
    <section class="rec-tiles">${tiles}</section>
    <section class="cp-section">
      <h2>Dev-buy result over time</h2>
      <p class="sub">Running total of the settled dev buys, in SOL after fees, launch by launch. Creator fees come on top.</p>
      <div class="rec-chart" id="rec-chart">${settled.length ? "" : `<p class="empty">No dev buy has been sold yet. The line starts with the first one.</p>`}</div>
    </section>
    <section class="cp-section">
      <h2>All launches</h2>
      <p class="sub">${coins.length ? "Newest first. Every row links to the coin on pump.fun and the transactions on Solscan." : "No coin launched yet. The crew launches from stories on Juno's news radar."}</p>
      ${coins.length ? `<div class="rec-table-wrap"><table class="rec-table"><thead><tr><th>Coin</th><th>Launched</th><th class="num">Dev buy (SOL)</th><th class="num">Result (SOL)</th><th>Status</th><th>Links</th></tr></thead><tbody>${rows}</tbody></table></div>` : ""}
    </section>
    <section class="cp-section rec-more">
      <h2>Also on the books</h2>
      <dl class="cp-kv">
        <dt>Holder backing</dt><dd>${d.backing.asks ? `${d.backing.asks} ask${d.backing.asks > 1 ? "s" : ""} · ${d.backing.raised} SOL raised · ${d.backing.paidOut} SOL paid back to backers` : "No backing asks yet"}</dd>
        ${d.trading ? `<dt>Trading desk</dt><dd>${signed(d.trading.pnlSol, 3)} SOL (${signed(d.trading.pnlPct, 1)}%) · ${d.trading.mode === "paper" ? "paper trading with virtual SOL, not part of the results above" : "live"}</dd>` : ""}
      </dl>
    </section>
    <section class="cp-section">
      <h2>How the numbers work</h2>
      <ul class="cp-trends">
        <li><b>Dev-buy result</b> = SOL that came back when the dev buy was sold, minus what it cost including pump.fun fees. Measured from the wallet balance before and after the sell.</li>
        <li><b>Still held</b> dev buys are shown at their live bonding-curve quote and left out of the totals until they are sold.</li>
        <li><b>Creator fees</b> are pump.fun's creator share of every trade on the crew's coins, claimed automatically about every 10 minutes.</li>
        <li>Launch costs (about 0.01 SOL per coin) are paid from the wallet and not counted in the dev-buy result.</li>
        <li>Nothing here is financial advice. Most memecoins go to zero; the crew sells its own dev buy early on purpose.</li>
      </ul>
    </section>
    <p class="cp-foot">${d.updatedAt ? `Updated ${dateTime(d.updatedAt)}` : ""}</p>`;
}

// ---------------- chart: cumulative dev-buy result (one series, crosshair + tooltip) ----------------
function drawChart(settled) {
  const host = document.getElementById("rec-chart");
  if (!host || !settled.length) return;
  // the line starts at zero, just before the first sold dev buy
  let run = 0;
  const pts = [{ i: 0, total: 0, c: null }, ...settled.map((c, k) => { run += c.dev.pnl; return { i: k + 1, total: Number(run.toFixed(5)), c }; })];
  const W = 900, H = 300, m = { l: 56, r: 64, t: 16, b: 34 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const vals = [0, ...pts.map((p) => p.total)];
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (hi - lo < 1e-6) { hi += 0.01; lo -= 0.01; }
  const step = niceStep((hi - lo) / 4);
  lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
  const x = (i) => m.l + (pts.length === 1 ? iw / 2 : (i / (pts.length - 1)) * iw);
  const y = (v) => m.t + ((hi - v) / (hi - lo)) * ih;
  const ticks = []; for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Number(v.toFixed(6)));
  const line = pts.map((p, k) => `${k ? "L" : "M"}${x(p.i).toFixed(1)},${y(p.total).toFixed(1)}`).join("");
  const area = `${line}L${x(pts[pts.length - 1].i).toFixed(1)},${y(0).toFixed(1)}L${x(0).toFixed(1)},${y(0).toFixed(1)}Z`;
  const last = pts[pts.length - 1];
  const fmt = (v) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v) < 0.01 && v !== 0 ? Math.abs(v).toFixed(4) : Math.abs(v).toFixed(step < 0.01 ? 3 : 2)}`;
  const xLabels = [pts[1], pts[Math.ceil((pts.length - 1) / 2)], last].filter((p, k, a) => p && a.indexOf(p) === k);
  // launches within a day or two: label the axis with times, not the same date three times
  const span = last.c.launchedAt - pts[1].c.launchedAt;
  const xLabel = (t) => (span < 36 * 3_600_000 ? new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : date(t));

  host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="rec-svg" role="img" aria-label="Running total of the dev-buy result: ${fmt(last.total)} SOL after ${pts.length - 1} sold dev buys">
    ${ticks.map((v) => `<line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}" class="${v === 0 ? "zero" : "grid"}"/><text x="${m.l - 10}" y="${y(v) + 4}" class="tick" text-anchor="end">${fmt(v)}</text>`).join("")}
    ${xLabels.map((p) => `<text x="${x(p.i)}" y="${H - 10}" class="tick" text-anchor="middle">${xLabel(p.c.launchedAt)}</text>`).join("")}
    <path d="${area}" class="area"/>
    <path d="${line}" class="line"/>
    <circle cx="${x(last.i)}" cy="${y(last.total)}" r="5" class="end"/>
    <text x="${x(last.i) + 10}" y="${y(last.total) + 4}" class="endlabel">${fmt(last.total)} SOL</text>
    <line class="cross" x1="0" x2="0" y1="${m.t}" y2="${m.t + ih}" visibility="hidden"/>
    <circle class="hover-dot" r="5" visibility="hidden"/>
    <rect class="hit" x="${m.l}" y="${m.t}" width="${iw}" height="${ih}" tabindex="0"/>
  </svg><div class="rec-tip" hidden></div>`;

  const svg = host.querySelector("svg"), tip = host.querySelector(".rec-tip"), cross = svg.querySelector(".cross"), dot = svg.querySelector(".hover-dot"), hit = svg.querySelector(".hit");
  const show = (p) => {
    cross.setAttribute("x1", x(p.i)); cross.setAttribute("x2", x(p.i)); cross.setAttribute("visibility", "visible");
    dot.setAttribute("cx", x(p.i)); dot.setAttribute("cy", y(p.total)); dot.setAttribute("visibility", "visible");
    tip.replaceChildren();
    const v = document.createElement("div"); v.className = "v"; v.textContent = `${fmt(p.total)} SOL total`;
    const k = document.createElement("div"); k.className = "k"; k.textContent = p.c ? `$${p.c.ticker}: ${fmt(p.c.dev.pnl)} SOL · ${dateTime(p.c.launchedAt)}` : "Start";
    tip.append(v, k);
    tip.hidden = false;
    const box = svg.getBoundingClientRect(), sx = (x(p.i) / W) * box.width, sy = (y(p.total) / H) * box.height;
    tip.style.left = `${Math.min(box.width - tip.offsetWidth - 4, Math.max(4, sx - tip.offsetWidth / 2))}px`;
    tip.style.top = `${Math.max(0, sy - tip.offsetHeight - 14)}px`;
  };
  const hide = () => { tip.hidden = true; cross.setAttribute("visibility", "hidden"); dot.setAttribute("visibility", "hidden"); };
  let cur = pts.length - 1;
  hit.addEventListener("pointermove", (ev) => {
    const box = svg.getBoundingClientRect(), px = ((ev.clientX - box.left) / box.width) * W;
    cur = pts.reduce((best, p) => (Math.abs(x(p.i) - px) < Math.abs(x(pts[best].i) - px) ? p.i : best), 0);
    show(pts[cur]);
  });
  hit.addEventListener("pointerleave", hide);
  hit.addEventListener("focus", () => show(pts[cur]));
  hit.addEventListener("blur", hide);
  hit.addEventListener("keydown", (ev) => {
    if (ev.key === "ArrowLeft") cur = Math.max(0, cur - 1); else if (ev.key === "ArrowRight") cur = Math.min(pts.length - 1, cur + 1); else return;
    ev.preventDefault(); show(pts[cur]);
  });
}

function niceStep(raw) {
  const p = 10 ** Math.floor(Math.log10(raw)), f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}

load();
