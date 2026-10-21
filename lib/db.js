// Storage for the shared world. Upstash Redis in production (Vercel Marketplace
// injects KV_REST_API_URL / KV_REST_API_TOKEN or UPSTASH_REDIS_REST_URL / _TOKEN).
// Falls back to an in-process memory store so local dev works without Redis.
import { Redis } from "@upstash/redis";

const URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

export const redisConfigured = !!(URL && TOKEN);

class MemoryStore {
  constructor() { this.kv = new Map(); this.lists = new Map(); this.sets = new Map(); this.exp = new Map(); }
  _alive(key) { const e = this.exp.get(key); if (e && e < Date.now()) { this.kv.delete(key); this.exp.delete(key); return false; } return true; }
  async get(key) { return this._alive(key) ? this.kv.get(key) ?? null : null; }
  async set(key, value, opts = {}) {
    if (opts.nx && this._alive(key) && this.kv.has(key)) return null;
    this.kv.set(key, value);
    if (opts.ex) this.exp.set(key, Date.now() + opts.ex * 1000); else this.exp.delete(key);
    return "OK";
  }
  async del(key) { this.kv.delete(key); this.lists.delete(key); this.sets.delete(key); return 1; }
  async rpush(key, ...vals) { const l = this.lists.get(key) || []; l.push(...vals); this.lists.set(key, l); return l.length; }
  async lrange(key, a, b) { const l = this.lists.get(key) || []; return l.slice(a, b === -1 ? undefined : b + 1); }
  async ltrim(key, a, b) { const l = this.lists.get(key) || []; this.lists.set(key, l.slice(a, b === -1 ? undefined : b + 1)); return "OK"; }
  async llen(key) { return (this.lists.get(key) || []).length; }
  async sadd(key, ...vals) { const s = this.sets.get(key) || new Set(); let n = 0; for (const v of vals) if (!s.has(v)) { s.add(v); n++; } this.sets.set(key, s); return n; }
  async sismember(key, v) { return (this.sets.get(key) || new Set()).has(v) ? 1 : 0; }
}

let client = null;
export function db() {
  if (client) return client;
  if (redisConfigured) {
    client = new Redis({ url: URL, token: TOKEN, automaticDeserialization: false });
  } else {
    if (!globalThis.__agentHouseMemoryStore) globalThis.__agentHouseMemoryStore = new MemoryStore();
    client = globalThis.__agentHouseMemoryStore;
  }
  return client;
}

export async function getJSON(key) {
  const raw = await db().get(key);
  if (raw === null || raw === undefined) return null;
  try { return typeof raw === "string" ? JSON.parse(raw) : raw; } catch { return null; }
}
export async function setJSON(key, value) {
  return db().set(key, JSON.stringify(value));
}

/** Try to take a short lock. Returns true when acquired. */
export async function acquireLock(key, seconds) {
  const r = await db().set(key, String(Date.now()), { nx: true, ex: seconds });
  return r === "OK";
}
export async function releaseLock(key) {
  await db().del(key);
}
