// The news radar. Every minute or so it polls news feeds (world headlines, animals and zoos,
// viral stories, AI, superintelligence, tech, crypto, Trump's Truth Social posts via a public mirror) and, with X_BEARER_TOKEN, the big X accounts
// the crew watches. Without an X token, a web-search sweep looks for their latest posts every
// SIGNAL_WEBSEARCH_MIN minutes instead (slower, no API key needed).
// New items are scored by a fast model for "could this be a coin right now"; a hot one sets
// world.signals.hot, and the engine answers it with a flash launch sprint.
import crypto from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { pushTranscript, pushEvent } from "./state.js";

const SCAN_MS = Number(process.env.SIGNAL_SCAN_SEC || 60) * 1000;
const NEWS_SCORE_MS = Number(process.env.SIGNAL_SCORE_MIN || 3) * 60_000; // news batches; posts from watched accounts are scored at once
const WEB_SWEEP_MS = Number(process.env.SIGNAL_WEBSEARCH_MIN || 20) * 60_000;
export const HOT_SCORE = Number(process.env.HOT_SIGNAL_SCORE || 8);
const HOT_MAX_AGE_MS = 90 * 60_000;
const MAX_AGE_MS = 6 * 3_600_000;
const MODEL = process.env.SIGNAL_MODEL || process.env.ANTHROPIC_MODEL || "claude-haiku-5-5";

export const WATCH = (process.env.X_WATCH || "elonmusk,realDonaldTrump,cobie,VitalikButerin,cz_binance,saylor,aeyakovenko,a1lon9,blknoiz06,MustStopMurad,frankdegods,sama,OpenAI,AnthropicAI,nvidia,POTUS,WhiteHouse,JDVance,naval,pmarca")
  .split(",").map((s) => s.trim().replace(/^@/, "")).filter(Boolean);

const gnews = (q) => `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
// Bing News carries a large image and the publisher's own link for every item
const bing = (q) => `https://www.bing.com/news/search?q=${encodeURIComponent(q)}&format=rss&mkt=en-US&qft=sortbydate%3d%221%22`;
// every: minutes between polls (slow-moving feeds don't need a request every minute)
const FEEDS = [
  { name: "Truth Social", url: "https://www.trumpstruth.org/feed", author: "realDonaldTrump", post: true },
  // world and trending
  { name: "Google News", url: "https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en" },
  { name: "Google News", url: "https://news.google.com/rss/headlines/section/topic/WORLD?hl=en-US&gl=US&ceid=US:en" },
  { name: "Google News", url: gnews("viral OR \"internet sensation\" OR \"goes viral\" when:1d") },
  { name: "BBC", url: "https://feeds.bbci.co.uk/news/world/rss.xml", every: 2 },
  { name: "The Guardian", url: "https://www.theguardian.com/world/rss", every: 2 },
  { name: "NYT", url: "https://rss.nytimes.com/services/xml/rss/nyt/World.xml", every: 2 },
  { name: "Sky News", url: "https://feeds.skynews.com/feeds/rss/world.xml", every: 2 },
  { name: "ABC News", url: "https://abcnews.go.com/abcnews/internationalheadlines", every: 2 },
  { name: "NPR", url: "https://feeds.npr.org/1001/rss.xml", every: 2 },
  { name: "Bing News", url: bing("viral"), every: 2 },
  // animals, zoos, nature (the Moo Deng and Pesto kind of story)
  { name: "Google News", url: gnews("zoo OR \"baby animal\" OR wildlife OR \"animal rescue\" OR aquarium when:1d") },
  { name: "The Guardian", url: "https://www.theguardian.com/world/animals/rss", every: 3 },
  { name: "Bing News", url: bing("zoo animal"), every: 2 },
  { name: "Bing News", url: bing("baby animal"), every: 3 },
  { name: "Live Science", url: "https://www.livescience.com/feeds/all", every: 3 },
  { name: "The Guardian", url: "https://www.theguardian.com/science/rss", every: 3 },
  // AI, tech, crypto
  { name: "Google News", url: gnews("artificial intelligence OR OpenAI OR Anthropic OR Nvidia when:1h") },
  { name: "Google News", url: gnews("superintelligence OR AGI OR \"AI model\" when:1d") },
  { name: "Google News", url: gnews("\"Elon Musk\" when:1h") },
  { name: "Google News", url: gnews("Trump when:1h") },
  { name: "Google News", url: gnews("memecoin OR Solana OR bitcoin when:1h") },
  { name: "The Verge", url: "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml" },
  { name: "TechCrunch", url: "https://techcrunch.com/category/artificial-intelligence/feed/" },
  { name: "BBC", url: "https://feeds.bbci.co.uk/news/technology/rss.xml" },
  { name: "Decrypt", url: "https://decrypt.co/feed" },
  { name: "Cointelegraph", url: "https://cointelegraph.com/rss" },
  { name: "Hacker News", url: "https://hnrss.org/frontpage?points=250", every: 2 },
  { name: "Bing News", url: bing("AI"), every: 2 },
];

export const xConfigured = () => !!process.env.X_BEARER_TOKEN;
const hash = (s) => crypto.createHash("sha1").update(s).digest("hex").slice(0, 12);

function state(world) {
  world.signals ||= { feed: [], seen: [], hot: null, used: [], lastScanAt: 0, lastScoreAt: 0, lastWebAt: 0, xSince: {} };
  return world.signals;
}

/** Poll every source (rate-limited inside), score what is new, flag a hot one. Safe to call often. */
export async function scanSignals(world) {
  const s = state(world);
  const now = Date.now();
  if (now - (s.lastScanAt || 0) < SCAN_MS) return { skipped: true };
  s.lastScanAt = now;
  const errors = [];
  s.feedAt ||= {};
  const due = FEEDS.filter((f) => now - (s.feedAt[f.url] || 0) >= (f.every || 1) * 60_000 - 5000);
  for (const f of due) s.feedAt[f.url] = now;
  const results = await Promise.allSettled([
    ...due.map((f) => fetchFeed(f)),
    xConfigured() ? fetchX(s) : Promise.resolve([]),
    !xConfigured() && process.env.ANTHROPIC_API_KEY && now - (s.lastWebAt || 0) > WEB_SWEEP_MS ? (s.lastWebAt = now, webSweep()) : Promise.resolve([]),
  ]);
  const seen = new Set(s.seen);
  const fresh = [];
  for (const r of results) {
    if (r.status === "rejected") { errors.push(r.reason?.message || String(r.reason)); continue; }
    for (const item of r.value) {
      if (!item.title || seen.has(item.id)) continue;
      seen.add(item.id);
      if (item.at && now - item.at > MAX_AGE_MS) continue;
      fresh.push(item);
    }
  }
  s.seen = [...seen].slice(-600);
  // posts from watched accounts first, then the newest headlines
  s.pending = [...(s.pending || []), ...fresh].sort((a, b) => (b.post - a.post) || ((b.at || 0) - (a.at || 0))).slice(0, 80);
  if (errors.length) s.errors = errors.slice(0, 4);

  // posts from watched accounts are scored right away; plain news waits for a batch
  const urgent = s.pending.some((i) => i.post);
  if (s.pending.length && (urgent || now - (s.lastScoreAt || 0) > NEWS_SCORE_MS)) {
    const batch = s.pending.splice(0, 40);
    s.lastScoreAt = now;
    try { await scoreItems(batch); } catch (err) { pushEvent(world, "signal-error", { error: err.message }); }
    await findImages(batch.filter((i) => !i.image && (i.score || 0) >= 6).slice(0, 4));
    s.feed = [...batch, ...s.feed].sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 40);
    pickHot(world, batch);
  }
  return { fresh: fresh.length, errors: errors.length };
}

function pickHot(world, batch) {
  const s = world.signals, now = Date.now();
  const used = new Set(s.used || []);
  const best = batch.filter((i) => (i.score || 0) >= HOT_SCORE && !used.has(i.id) && now - (i.at || now) < HOT_MAX_AGE_MS)
    .sort((a, b) => (b.score - a.score) || ((b.post ? 1 : 0) - (a.post ? 1 : 0)) || (b.at - a.at))[0];
  if (!best || (s.hot && s.hot.score >= best.score)) return;
  s.hot = { ...best, flaggedAt: now };
  const who = best.author ? `@${best.author}` : best.feed;
  pushTranscript(world, { kind: "system", text: `📡 Juno's radar lit up (${best.score}/10): ${who}: "${best.title.slice(0, 140)}". Flash launch sprint incoming.` });
  pushEvent(world, "hot-signal", { id: best.id, score: best.score });
}

/** The engine calls this when a flash sprint starts on the hot signal. */
export function takeHotSignal(world) {
  const s = state(world), hot = s.hot;
  if (!hot) return null;
  s.hot = null;
  s.used = [...(s.used || []), hot.id].slice(-100);
  return hot;
}

export function findSignal(world, id) {
  const s = world.signals;
  if (!s || !id) return null;
  return s.feed.find((i) => i.id === id) || null;
}

/** Prompt block for regular sprints: the best recent items, with ids the crew can cite. */
export function radarBlock(world) {
  const s = world.signals;
  const items = (s?.feed || []).filter((i) => (i.score || 0) >= 5 && Date.now() - (i.at || 0) < 4 * 3_600_000 && !(s.used || []).includes(i.id))
    .sort((a, b) => b.score - a.score).slice(0, 8);
  if (!items.length) return "";
  return `NEWS RADAR (live posts and headlines, scored for coin potential; cite one with planUpdate.sourceId if the coin is built on it):
${items.map((i) => `- [${i.id}] ${i.score}/10 · ${i.author ? `@${i.author} posted` : i.feed}: "${i.title.slice(0, 220)}"${i.image ? " (has an image)" : ""}${i.angle ? ` → idea: ${i.angle}` : ""}`).join("\n")}`;
}

/** Prompt block for a flash sprint. */
export function hotBlock(hot) {
  const mins = Math.max(0, Math.round((Date.now() - (hot.at || Date.now())) / 60_000));
  return `BREAKING SIGNAL [${hot.id}] (${mins} min ago, scored ${hot.score}/10): ${hot.author ? `@${hot.author} posted` : `${hot.feed} headline`}: "${hot.title}"
${hot.url ? `Link: ${hot.url}` : ""}${hot.image ? "\nThe post/article has an image the crew can use as the logo (set useSourceImage true if that image IS the meme; otherwise Pixel writes a logo prompt)." : ""}${hot.angle ? `\nRadar idea: ${hot.angle}` : ""}
This is a FLASH SPRINT: speed wins. Build the coin directly on this signal: the name and ticker should be the obvious word or phrase people will search for in the next hour. Set planUpdate.sourceId to "${hot.id}".`;
}

// ---------- sources ----------
async function get(url, init = {}) {
  const r = await fetch(url, { ...init, headers: { "user-agent": "Mozilla/5.0 (compatible; CookersRadar/1.0)", ...(init.headers || {}) }, signal: AbortSignal.timeout(8000), redirect: "follow" });
  if (!r.ok) throw new Error(`${new URL(url).host} ${r.status}`);
  return r;
}

export async function fetchFeed(feed) {
  const xml = await (await get(feed.url)).text();
  const blocks = xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/g) || [];
  return blocks.slice(0, 20).map((b) => {
    const rawDesc = tag(b, "content:encoded") || tag(b, "description") || tag(b, "summary") || tag(b, "content") || "";
    const desc = clean(rawDesc);
    let title = clean(tag(b, "title"));
    // Truth Social: the post text is the description; media links show up as "View image/video"
    if (feed.post) title = desc.replace(/\b(View (image|video)|Quoted Donald J\. Trump|RT: https?:\/\/\S+)/g, " ").replace(/\s+/g, " ").trim();
    if (feed.name === "Google News") title = title.replace(/ - [^-]{2,40}$/, ""); // drop the " - Publisher" suffix
    let link = attr(b, "link", "href") || clean(tag(b, "link"));
    // Bing wraps the publisher link in a click tracker; keep the real article URL
    if (/bing\.com\/news\/apiclick/.test(link)) { try { link = new URL(link).searchParams.get("url") || link; } catch { /* keep it */ } }
    const source = clean(tag(b, "News:Source"));
    const when = Date.parse(clean(tag(b, "pubDate") || tag(b, "published") || tag(b, "updated") || tag(b, "dc:date"))) || null;
    const html = unwrap(rawDesc);
    const bingImg = clean(tag(b, "News:Image"));
    const image = (bingImg ? `${bingImg}&w=1280&h=720&c=14` : null) || largestMedia(b) || attr(b, "enclosure", "url")
      || (html.match(/<img[^>]+src=["']([^"']+)/i) || [])[1]
      || (html.match(/href=["']([^"']+\.(?:png|jpe?g|webp|gif))["']/i) || [])[1] || attr(b, "media:thumbnail", "url") || null;
    return {
      id: hash(feed.post ? link || title : title.toLowerCase()), source: feed.post ? "post" : "news", feed: source ? `${source}` : feed.name, author: feed.author || null, post: !!feed.post,
      title: title.slice(0, 400), url: link || null, image: /^https?:/.test(image || "") && !/\.(mp4|mov|webm)(\?|$)/i.test(image) ? bigger(image) : null, at: when,
    };
  }).filter((i) => i.title && !/^(RT:|\[No Title\])/i.test(i.title));
}

async function fetchX(s) {
  const groups = [];
  let cur = [];
  for (const u of WATCH) {
    const q = [...cur, u].map((x) => `from:${x}`).join(" OR ");
    if (q.length > 440 && cur.length) { groups.push(cur); cur = [u]; } else cur.push(u);
  }
  if (cur.length) groups.push(cur);
  const out = [];
  for (const [i, g] of groups.entries()) {
    const params = new URLSearchParams({
      query: `(${g.map((u) => `from:${u}`).join(" OR ")}) -is:retweet -is:reply`, max_results: "20",
      "tweet.fields": "created_at,author_id,attachments", expansions: "author_id,attachments.media_keys",
      "user.fields": "username", "media.fields": "url,preview_image_url,type",
    });
    if (s.xSince?.[i]) params.set("since_id", s.xSince[i]);
    const d = await (await get(`https://api.x.com/2/tweets/search/recent?${params}`, { headers: { authorization: `Bearer ${process.env.X_BEARER_TOKEN}` } })).json();
    if (d.meta?.newest_id) s.xSince = { ...(s.xSince || {}), [i]: d.meta.newest_id };
    const users = Object.fromEntries((d.includes?.users || []).map((u) => [u.id, u.username]));
    const media = Object.fromEntries((d.includes?.media || []).map((m) => [m.media_key, m.url || m.preview_image_url]));
    for (const t of d.data || []) {
      const author = users[t.author_id] || null;
      out.push({ id: `x${t.id}`, source: "post", feed: "X", author, post: true, title: t.text.slice(0, 400), url: `https://x.com/${author || "i"}/status/${t.id}`, image: (t.attachments?.media_keys || []).map((k) => media[k]).find(Boolean) || null, at: Date.parse(t.created_at) || Date.now() });
    }
  }
  return out;
}

/** No X token: one web-search sweep for the watched accounts' latest posts and breaking AI news. */
async function webSweep() {
  const client = new Anthropic();
  const prompt = `Find what these X (Twitter) accounts posted in the last 3 hours: ${WATCH.slice(0, 12).map((u) => "@" + u).join(", ")}. Also find breaking AI / superintelligence news from the last 2 hours. Only include items you actually found with a date in that window.
Reply with JSON only: {"items":[{"author":"<handle without @, or null for news>","text":"<the post text or headline, verbatim if possible>","url":"https://...","image":"<direct image URL shown with the post/article, or null>","at":"<ISO time>"}]} (max 12 items, newest first).`;
  const response = await client.messages.create({
    model: MODEL, max_tokens: 3000,
    tools: [{ type: /haiku|4-5|3-/.test(MODEL) ? "web_search_20250305" : "web_search_20260209", name: "web_search", max_uses: 4 }],
    messages: [{ role: "user", content: prompt }],
  });
  const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
  const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  const items = JSON.parse(json || "{}").items || [];
  return items.filter((i) => i.text).map((i) => ({
    id: hash(i.url || i.text), source: i.author ? "post" : "news", feed: i.author ? "X (web)" : "Web", author: i.author ? String(i.author).replace(/^@/, "") : null,
    post: !!i.author, title: String(i.text).slice(0, 400), url: i.url || null, image: /^https?:/.test(i.image || "") ? i.image : null, at: Date.parse(i.at) || Date.now(),
  }));
}

// BBC feeds point at 240px thumbnails; the same path serves 976px
const bigger = (url) => url.replace(/(ichef\.bbci\.co\.uk\/ace\/standard\/)\d+\//, "$1" + "976/");

/** The widest media:content image in an item (The Guardian lists several sizes). */
function largestMedia(b) {
  let best = null, bestW = -1;
  for (const m of b.matchAll(/<media:content\b([^>]*)>/gi)) {
    const url = (m[1].match(/\burl=["']([^"']+)["']/) || [])[1];
    if (!url || /\.(mp4|mov|webm)(\?|$)/i.test(url) || /medium=["']video/.test(m[1])) continue;
    const w = Number((m[1].match(/\bwidth=["'](\d+)/) || [])[1] || 0);
    if (w > bestW) { best = decode(url); bestW = w; }
  }
  return best;
}

/** Promising items without a picture: read the article's og:image (Google News links can't be resolved). */
async function findImages(items) {
  await Promise.allSettled(items.map(async (i) => {
    if (!i.url || /news\.google\.com/.test(i.url)) return;
    const html = (await (await get(i.url)).text()).slice(0, 200_000);
    const m = html.match(/<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)(?::src)?["'][^>]*content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["'](?:og:image|twitter:image)["']/i);
    if (m && /^https?:/.test(decode(m[1]))) i.image = decode(m[1]);
  }));
}

// ---------- scoring ----------
const SCORE_PROMPT = `You are the news radar of COOKERS, six AI agents who launch Solana memecoins on pump.fun within minutes of a viral moment. Items come from world news, animal and zoo stories, viral stories, science, AI, tech, crypto and posts from big accounts. Score each item 0-10 for how well a coin based on it would catch attention RIGHT NOW:
10-9: a big account posted something instantly meme-able (a new word, nickname, joke, pet, product name, striking image), a viral breaking moment people will search for in the next hour, or an adorable / absurd named animal (a zoo baby, an escaped animal, a famous pet: the Moo Deng kind of story).
8-7: strong, fresh, fun angle. 6-4: interesting but weak or slow. 3-0: routine news, earnings, policy detail, old news.
Score 0 (never a coin): deaths, tragedies, violence, war, disasters, illness, crimes against people, private individuals, anything hateful or sexual.
For items scoring 6 or more, give "angle": one sentence with a coin name and $TICKER (3-6 letters) and the joke. Otherwise angle is null.`;

async function scoreItems(items) {
  if (!process.env.ANTHROPIC_API_KEY || !items.length) return;
  const client = new Anthropic();
  const list = items.map((i) => `[${i.id}] ${i.author ? `@${i.author} posted` : i.feed}: ${i.title.slice(0, 300)}${i.image ? " (image)" : ""}`).join("\n");
  const schema = { type: "object", additionalProperties: false, required: ["items"], properties: { items: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "score", "angle"], properties: { id: { type: "string" }, score: { type: "integer" }, angle: { type: ["string", "null"] } } } } } };
  const response = await client.messages.create({
    model: MODEL, max_tokens: 2500,
    system: [{ type: "text", text: SCORE_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: list }],
    output_config: { effort: "low", format: { type: "json_schema", schema } },
  });
  const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  const byId = Object.fromEntries((JSON.parse(text).items || []).map((x) => [x.id, x]));
  for (const i of items) {
    const x = byId[i.id];
    i.score = x ? Math.max(0, Math.min(10, Math.round(x.score))) : 0;
    i.angle = x?.angle ? String(x.angle).slice(0, 240) : null;
  }
}

// ---------- tiny XML helpers ----------
function tag(b, name) { const m = b.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, "i")); return m ? m[1] : ""; }
function attr(b, name, a) { const m = b.match(new RegExp(`<${name}\\b[^>]*\\b${a}=["']([^"']+)["']`, "i")); return m ? decode(m[1]) : ""; }
function unwrap(s) { return decode(String(s || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")); }
function clean(s) { return unwrap(s).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(); }
function decode(s) {
  return String(s).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&amp;/g, "&");
}
