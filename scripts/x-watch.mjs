// X watcher for the news radar, run by GitHub Actions (see .github/workflows/tick.yml).
// A headless Chrome opens x.com with the session cookies of a dedicated X account
// (X_AUTH_TOKEN, X_CT0 as repository secrets), reads its "Following" timeline every minute
// and posts new tweets to /api/signals. Follow the accounts the crew should watch with it.
// The browser does what the web app does, so no API key and no hand-built requests.
import { chromium } from "playwright-core";

const SITE = (process.env.SITE || "").replace(/\/$/, "");
const SECRET = process.env.TICK_SECRET;
const RUN_MS = Number(process.env.X_WATCH_SECONDS || 270) * 1000;
const EVERY_MS = Number(process.env.X_REFRESH_SECONDS || 60) * 1000;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

if (!process.env.X_AUTH_TOKEN || !process.env.X_CT0) { console.log("X_AUTH_TOKEN / X_CT0 not set: skipping the X watcher"); process.exit(0); }
if (!SITE || !SECRET) { console.log("SITE / TICK_SECRET missing"); process.exit(1); }

async function send(items, status) {
  const r = await fetch(`${SITE}/api/signals`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ secret: SECRET, items, status }) });
  console.log(`sent ${items.length} posts${status?.ok === false ? ` (error: ${status.error})` : ""} -> ${r.status} ${(await r.text()).slice(0, 160)}`);
}

// ---------- tweets out of the timeline JSON ----------
function collect(node, out) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) { for (const n of node) collect(n, out); return; }
  const t = node.legacy?.full_text != null && node.rest_id ? node : null;
  if (t) {
    const l = t.legacy;
    const user = t.core?.user_results?.result;
    const author = user?.core?.screen_name || user?.legacy?.screen_name || null;
    // retweets, replies and the quoted tweet inside a quote are someone else's words: skip them
    if (!l.retweeted_status_result && !l.in_reply_to_status_id_str) {
      const media = (l.extended_entities?.media || l.entities?.media || [])[0];
      out.push({
        id: t.rest_id, author,
        text: t.note_tweet?.note_tweet_results?.result?.text || l.full_text,
        image: media?.media_url_https || null,
        at: Date.parse(l.created_at) || Date.now(),
      });
    }
    return; // don't descend into retweeted / quoted tweets
  }
  for (const v of Object.values(node)) collect(v, out);
}

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--disable-blink-features=AutomationControlled"] });
const context = await browser.newContext({ userAgent: UA, locale: "en-US", viewport: { width: 1280, height: 900 } });
await context.addCookies([
  { name: "auth_token", value: process.env.X_AUTH_TOKEN.trim(), domain: ".x.com", path: "/", httpOnly: true, secure: true, sameSite: "None" },
  { name: "ct0", value: process.env.X_CT0.trim(), domain: ".x.com", path: "/", secure: true, sameSite: "Lax" },
]);
const page = await context.newPage();
const seen = new Set();
let batch = [];
page.on("response", async (res) => {
  if (!/\/i\/api\/graphql\/[^/]+\/HomeLatestTimeline/.test(res.url())) return;
  try {
    const out = [];
    collect(await res.json(), out);
    for (const t of out) if (!seen.has(t.id)) { seen.add(t.id); batch.push(t); }
  } catch { /* not JSON, ignore */ }
});

async function openFollowing() {
  const tab = page.getByRole("tab", { name: /^Following$/ });
  await tab.click({ timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(5000);
}

try {
  await page.goto("https://x.com/home", { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(6000);
  if (/\/login|\/i\/flow\/|\/account\/access|\/logout/.test(page.url())) {
    await send([], { ok: false, error: `X sent the session to ${new URL(page.url()).pathname}: log in again and update X_AUTH_TOKEN / X_CT0` });
    process.exit(0);
  }
  const started = Date.now();
  await openFollowing();
  let firstSend = true;
  while (true) {
    if (batch.length || firstSend) { const items = batch; batch = []; await send(items, { ok: true }); firstSend = false; }
    if (Date.now() - started + EVERY_MS > RUN_MS) break;
    await page.waitForTimeout(EVERY_MS);
    await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => {});
    await page.waitForTimeout(3000);
    await openFollowing();
  }
} catch (err) {
  console.error(err);
  await send(batch, { ok: false, error: `watcher error: ${err.message}`.slice(0, 200) }).catch(() => {});
} finally {
  await browser.close();
}
