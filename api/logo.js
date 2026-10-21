// POST /api/logo - render the coin logo with fal.ai from the agents' prompt.
import { json, clientIp, readBody, paused } from "../lib/http.js";
import { rateLimit } from "../lib/ratelimit.js";

const FAL_MODEL = process.env.FAL_MODEL || "fal-ai/flux/schnell";

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "POST only" });
  if (!process.env.FAL_KEY) return json(res, 503, { error: "FAL_KEY not configured" });
  if (paused()) return json(res, 503, { error: "AI is paused" });

  const rl = rateLimit(`logo:${clientIp(req)}`, 6, 60 * 60 * 1000);
  if (!rl.ok) return json(res, 429, { error: `Logo limit reached, try again in ${Math.ceil(rl.retryAfter / 60)} min` });

  const body = await readBody(req);
  const base = String(body.prompt || "").replace(/\s+/g, " ").trim().slice(0, 500);
  if (base.length < 10) return json(res, 400, { error: "prompt too short" });
  const name = String(body.name || "").slice(0, 60);
  const prompt = `${base}. Memecoin logo${name ? ` for "${name}"` : ""}, single centered emblem, bold readable shapes, vibrant colors, clean simple background, high quality, no text, no letters, no watermark.`;

  try {
    const r = await fetch(`https://fal.run/${FAL_MODEL}`, {
      method: "POST",
      headers: { authorization: `Key ${process.env.FAL_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ prompt, image_size: "square_hd", num_images: 1, enable_safety_checker: true }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return json(res, 502, { error: `fal.ai error ${r.status}: ${data.detail?.[0]?.msg || data.detail || data.error || "unknown"}` });
    const url = data.images?.[0]?.url;
    if (!url) return json(res, 502, { error: "fal.ai returned no image" });
    return json(res, 200, { url, prompt, model: FAL_MODEL });
  } catch (err) {
    console.error(err);
    return json(res, 500, { error: "Logo generation failed" });
  }
}
