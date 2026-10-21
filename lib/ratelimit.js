// In-memory sliding-window rate limiter. Serverless instances don't share memory,
// so this is a soft cap per instance - good enough to stop a single tab from
// hammering the API, not a billing guarantee.
const buckets = new Map();

export function rateLimit(key, limit, windowMs) {
  const now = Date.now();
  const arr = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= limit) {
    buckets.set(key, arr);
    return { ok: false, retryAfter: Math.ceil((arr[0] + windowMs - now) / 1000) };
  }
  arr.push(now);
  buckets.set(key, arr);
  if (buckets.size > 5000) buckets.clear();
  return { ok: true };
}
