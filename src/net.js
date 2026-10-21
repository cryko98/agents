// Talks to the shared world: polls /api/world, nudges /api/tick when the world is stale.
export const net = {
  world: null,
  offset: 0,          // serverNow - Date.now()
  error: null,
  lastTickAt: 0,
  listeners: new Set(),
  health: null,
};

export const serverNow = () => Date.now() + net.offset;

export function onWorld(fn) { net.listeners.add(fn); return () => net.listeners.delete(fn); }

export async function fetchWorld() {
  try {
    const res = await fetch("/api/world", { cache: "no-store" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `world ${res.status}`);
    net.offset = data.serverNow - Date.now();
    net.world = data;
    net.error = null;
    for (const fn of net.listeners) fn(data);
    if (serverNow() >= data.nextTickAt && Date.now() - net.lastTickAt > 20_000) {
      net.lastTickAt = Date.now();
      fetch("/api/tick", { method: "POST" }).catch(() => {});
    }
  } catch (err) {
    net.error = err.message || String(err);
  }
  return net.world;
}

export async function checkHealth() {
  try { net.health = await (await fetch("/api/health")).json(); } catch { net.health = null; }
  return net.health;
}

export async function sendTip(text) {
  const res = await fetch("/api/tip", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `tip failed (${res.status})`);
  return data;
}

export async function requestPerk(address, request) {
  const res = await fetch("/api/perk", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address, request }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `request failed (${res.status})`);
  return data;
}

export function startPolling(intervalMs = 4000) {
  fetchWorld();
  setInterval(fetchWorld, intervalMs);
  checkHealth();
  setInterval(checkHealth, 60_000); // env changes after a redeploy show up within a minute
  // the scalper reacts every ~15s while someone is watching (the server ignores extra pings)
  setInterval(() => { if (!document.hidden) fetch("/api/scalp", { method: "POST" }).catch(() => {}); }, 15_000);
}
