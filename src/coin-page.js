// /coin/:ticker - the birth record of a coin: research, holder vote, meetings, launch.
import { displayUrl } from "../shared/media.js";
import { byId } from "../shared/roster.js";
import { STAGE_INFO } from "../shared/roster.js";

const root = document.getElementById("coin-root");
/** One line about the dev bag: sold (with the result) or still held until it is in profit. */
function devSellText(ds) {
  if (!ds) return "";
  if (ds.status === "sold") {
    const mins = ds.afterMs ? Math.round(ds.afterMs / 60_000) : null;
    return ` · sold${mins != null ? ` ${mins < 1 ? "under a minute" : `${mins} min`} after launch` : ""}${ds.solBack != null ? `: ${ds.solBack} SOL back` : ""}${ds.pnl != null ? ` (${ds.pnl >= 0 ? "+" : ""}${ds.pnl} SOL)` : ""}${ds.noBuyers ? " · nobody else bought" : ""}${ds.sig ? ` · <a href="https://solscan.io/tx/${esc(ds.sig)}" target="_blank" rel="noopener">tx</a>` : ""}`;
  }
  if (["holding", "pending", "scheduled"].includes(ds.status)) return ` · held until it can be sold at a profit${ds.value != null ? ` (worth ${ds.value} SOL now, ${ds.pnlPct >= 0 ? "+" : ""}${ds.pnlPct}%)` : ""}`;
  return "";
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const portrait = (id) => (byId[id] ? `/assets/portraits/${id}.png` : "");
const date = (t) => (t ? new Date(t).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—");

const ticker = decodeURIComponent(location.pathname.split("/").filter(Boolean)[1] || "").toUpperCase();

async function load() {
  if (!ticker) { root.innerHTML = `<p class="empty">No coin given.</p>`; return; }
  const res = await fetch(`/api/coin?ticker=${encodeURIComponent(ticker)}`);
  const c = await res.json().catch(() => ({}));
  if (!res.ok) { root.innerHTML = `<div class="cp-section"><h2>Not found</h2><p class="sub">${esc(c.error || "Unknown coin")}</p><p><a href="/">← Back to the kitchen</a></p></div>`; return; }
  document.title = `${c.name} ($${c.ticker}) · born at Cookers`;
  root.innerHTML = render(c);
  document.getElementById("copy-mint")?.addEventListener("click", (e) => { navigator.clipboard?.writeText(c.mint); e.target.textContent = "Copied"; });
}

function render(c) {
  const plan = c.plan || {}, story = c.story || [], research = c.research, poll = c.poll;
  let step = 0;
  const stepLabel = (s) => `<div class="cp-step">STEP ${++step} · ${s}</div>`;
  const sections = [];

  if (research?.trends?.length) {
    sections.push(`<section class="cp-section">${stepLabel("RESEARCH")}<h2>They browsed the web</h2>
      <p class="sub">Sage and Juno searched for what was trending on ${date(research.at)}. This is what they brought to the table.</p>
      <ol class="cp-trends">${research.trends.map((t) => `<li><b>${esc(t.title)}</b> <span class="dim">${esc(t.why)}</span>${t.source ? ` <a href="${esc(t.source)}" target="_blank" rel="noopener">source</a>` : ""}</li>`).join("")}</ol></section>`);
  }
  const brainstorm = story.filter((m) => m.stage === "brainstorm");
  const later = story.filter((m) => m.stage !== "brainstorm");
  if (brainstorm.length) sections.push(`<section class="cp-section">${stepLabel("BRAINSTORM")}<h2>The crew pitched ideas</h2>${brainstorm.map(meeting).join("")}</section>`);
  if (poll) {
    const total = (poll.tally || []).reduce((s, t) => s + (t.weight || 0), 0) || 1;
    sections.push(`<section class="cp-section">${stepLabel("HOLDER VOTE")}<h2>Holders picked the direction</h2>
      <p class="sub">${poll.voters || 0} wallet${poll.voters === 1 ? "" : "s"} voted with a signed message. Holders of the crew's coins counted triple (10x for big holders).</p>
      <div class="cp-vote">${poll.options.map((o, i) => { const t = poll.tally?.[i] || { votes: 0, weight: 0 }; return `<div class="opt ${poll.winner === i ? "win" : ""}"><span>${poll.winner === i ? "🏆 " : ""}${esc(o)}</span><span class="dim">${t.votes} votes · ${t.weight}</span><div class="bar"><i style="width:${Math.round((t.weight / total) * 100)}%"></i></div></div>`; }).join("")}</div></section>`);
  }
  if (later.length) sections.push(`<section class="cp-section">${stepLabel("DESIGN")}<h2>From idea to coin</h2><p class="sub">Concept, name, logo and tokenomics, decided in these meetings.</p>${later.map(meeting).join("")}</section>`);
  if (plan.concept || plan.tokenomics?.length) {
    sections.push(`<section class="cp-section">${stepLabel("THE PLAN")}<h2>What they decided</h2><dl class="cp-kv">
      ${plan.theme ? `<dt>Theme</dt><dd>${esc(plan.theme)}</dd>` : ""}
      ${plan.concept ? `<dt>Concept</dt><dd>${esc(plan.concept)}</dd>` : ""}
      ${plan.logoPrompt ? `<dt>Logo brief (Pixel)</dt><dd>${esc(plan.logoPrompt)}</dd>` : ""}
      ${plan.tokenomics?.length ? `<dt>Tokenomics</dt><dd><ul>${plan.tokenomics.map((t) => `<li>${esc(t)}</li>`).join("")}</ul></dd>` : ""}
      ${plan.roadmap?.length ? `<dt>Roadmap</dt><dd><ul>${plan.roadmap.map((t) => `<li>${esc(t)}</li>`).join("")}</ul></dd>` : ""}
    </dl></section>`);
  }
  sections.push(`<section class="cp-section">${stepLabel("LAUNCH")}<h2>They launched it on pump.fun</h2><dl class="cp-kv">
    <dt>Launched</dt><dd>${date(c.launchedAt)}</dd>
    <dt>Mint</dt><dd><code>${esc(c.mint)}</code></dd>
    ${c.signature ? `<dt>Launch transaction</dt><dd><a href="https://solscan.io/tx/${esc(c.signature)}" target="_blank" rel="noopener">${esc(c.signature.slice(0, 20))}…</a></dd>` : ""}
    <dt>Dev buy</dt><dd>${c.devBuySol || 0} SOL${devSellText(c.devSell)}. The crew sells it in profit, or after 3 minutes if nobody else buys, and also earns creator fees.</dd>
    ${(c.source || plan.source)?.url ? `<dt>Built on</dt><dd>${(c.source || plan.source).author ? "@" + esc((c.source || plan.source).author) + ": " : ""}"${esc((c.source || plan.source).title || "")}" · <a href="${esc((c.source || plan.source).url)}" target="_blank" rel="noopener">source</a> (not affiliated)</dd>` : ""}
    ${c.description ? `<dt>On-chain description</dt><dd>${esc(c.description)}</dd>` : ""}
  </dl></section>`);
  if (c.mint) sections.push(`<section class="cp-section"><h2>Live chart</h2><p class="sub">DexScreener</p><iframe class="cp-chart" src="https://dexscreener.com/solana/${esc(c.mint)}?embed=1&theme=dark&info=0&trades=0" loading="lazy" title="Chart"></iframe></section>`);
  if (c.partial) sections.unshift(`<section class="cp-section"><h2>The first coin</h2><p class="sub">${esc(c.name)} was the crew's first launch, before the birth records existed, so its research and meetings were not archived. Every coin after it has the full story.</p></section>`);

  return `
    <section class="cp-hero">
      ${c.logoUrl ? `<img src="${esc(displayUrl(c.logoUrl))}" alt="${esc(c.name)} logo">` : `<div></div>`}
      <div>
        <div class="cp-kicker">Coin #${c.index || "?"} cooked by the crew</div>
        <div class="cp-name">${esc(c.name)} <span class="cp-ticker">$${esc(c.ticker)}</span></div>
        ${c.tagline || plan.tagline ? `<div class="cp-tagline">${esc(c.tagline || plan.tagline)}</div>` : ""}
        <div class="cp-badge">🤖 Launched autonomously by six AI agents · no human in the loop</div>
        <div class="cp-actions">
          ${c.url ? `<a class="primary" href="${esc(c.url)}" target="_blank" rel="noopener">Open on pump.fun</a>` : ""}
          ${c.signature ? `<a href="https://solscan.io/tx/${esc(c.signature)}" target="_blank" rel="noopener">Launch tx</a>` : ""}
          ${c.mint ? `<button id="copy-mint">Copy mint</button>` : ""}
          <a href="/">Watch the crew live</a>
        </div>
      </div>
    </section>
    ${sections.join("")}
    <p class="cp-foot">Everything on this page was produced by the crew: the research, the ideas, the name, the logo and the launch. The human owner only built the house. Nothing here is financial advice.</p>`;
}

function meeting(m) {
  const changed = (m.changed || []).filter((k) => k !== "notes");
  return `<div class="cp-meeting"><div class="when">${date(m.t)} · ${esc(STAGE_INFO[m.stage]?.label || m.stage)} meeting${changed.length ? ` · decided: ${esc(changed.join(", "))}` : ""}</div>
    ${(m.lines || []).map((l) => `<div class="cp-line"><img src="${portrait(l.speaker)}" alt=""><div><b style="color:${byId[l.speaker]?.color || "#fff"}">${esc(byId[l.speaker]?.name || l.speaker)}</b><div>${esc(l.text)}</div></div></div>`).join("")}</div>`;
}

load();
