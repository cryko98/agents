// Market data: Jupiter Price v3, Jupiter Token API v2 (trending), DexScreener as a backup.
// All keyless; Jupiter's keyless tier is ~0.5 req/s so calls are kept to a handful per tick.
export const SOL_MINT = "So11111111111111111111111111111111111111112";
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const JUP = "https://api.jup.ag";
const headers = () => (process.env.JUPITER_API_KEY ? { "x-api-key": process.env.JUPITER_API_KEY } : {});

async function getJSON(url, init = {}, timeoutMs = 12_000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...init, signal: ctrl.signal, headers: { accept: "application/json", ...(init.headers || {}) } });
    if (!r.ok) throw new Error(`${r.status} ${url.split("?")[0]}`);
    return await r.json();
  } finally { clearTimeout(timer); }
}

/** usd prices keyed by mint. Missing mints are simply absent. */
export async function prices(mints) {
  const ids = [...new Set(mints)].filter(Boolean).slice(0, 50);
  if (!ids.length) return {};
  const data = await getJSON(`${JUP}/price/v3?ids=${ids.join(",")}`, { headers: headers() });
  const out = {};
  for (const [mint, v] of Object.entries(data || {})) out[mint] = { usd: Number(v.usdPrice), change24h: v.priceChange24h ?? null, liquidity: v.liquidity ?? null };
  return out;
}

export async function solPrice() {
  const p = await prices([SOL_MINT]);
  return p[SOL_MINT]?.usd || null;
}

/** Trending candidates with the fields the trading desk needs. */
export async function trending({ interval = "1h", limit = 30 } = {}) {
  const [trend, traded] = await Promise.all([
    getJSON(`${JUP}/tokens/v2/toptrending/${interval}?limit=${limit}`, { headers: headers() }).catch(() => []),
    getJSON(`${JUP}/tokens/v2/toptraded/${interval}?limit=${limit}`, { headers: headers() }).catch(() => []),
  ]);
  const seen = new Map();
  for (const t of [...(Array.isArray(trend) ? trend : []), ...(Array.isArray(traded) ? traded : [])]) {
    if (!t?.id || seen.has(t.id)) continue;
    seen.set(t.id, normalizeToken(t));
  }
  return [...seen.values()];
}

export async function tokenInfo(mint) {
  const data = await getJSON(`${JUP}/tokens/v2/search?query=${encodeURIComponent(mint)}`, { headers: headers() }).catch(() => []);
  const t = (Array.isArray(data) ? data : []).find((x) => x.id === mint) || (Array.isArray(data) ? data[0] : null);
  return t ? normalizeToken(t) : null;
}

function normalizeToken(t) {
  const ageH = t.firstPool?.createdAt ? (Date.now() - Date.parse(t.firstPool.createdAt)) / 3_600_000 : null;
  return {
    mint: t.id,
    symbol: t.symbol,
    name: t.name,
    icon: t.icon || null,
    decimals: t.decimals ?? 6,
    usdPrice: Number(t.usdPrice) || null,
    mcap: Number(t.mcap) || null,
    fdv: Number(t.fdv) || null,
    liquidity: Number(t.liquidity) || null,
    holders: t.holderCount ?? null,
    ageHours: ageH != null ? Math.round(ageH) : null,
    organicScore: t.organicScore ?? null,
    organicLabel: t.organicScoreLabel ?? null,
    verified: !!t.isVerified,
    mintDisabled: t.audit?.mintAuthorityDisabled ?? null,
    freezeDisabled: t.audit?.freezeAuthorityDisabled ?? null,
    topHoldersPct: t.audit?.topHoldersPercentage ?? null,
    sus: !!t.audit?.isSus,
    change1h: t.stats1h?.priceChange ?? null,
    change24h: t.stats24h?.priceChange ?? null,
    vol24h: t.stats24h ? Number(t.stats24h.buyVolume || 0) + Number(t.stats24h.sellVolume || 0) : null,
    traders24h: t.stats24h?.numTraders ?? null,
    netBuyers1h: t.stats1h?.numNetBuyers ?? null,
  };
}

/** DexScreener backup for a single mint (price + liquidity). */
export async function dexScreener(mint) {
  const data = await getJSON(`https://api.dexscreener.com/tokens/v1/solana/${mint}`).catch(() => null);
  const pair = Array.isArray(data) ? data.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0] : null;
  if (!pair) return null;
  return { usdPrice: Number(pair.priceUsd) || null, liquidity: pair.liquidity?.usd ?? null, pairCreatedAt: pair.pairCreatedAt ?? null, url: pair.url };
}
