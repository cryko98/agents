// Image generation through fal.ai. Coin logos use Google's Nano Banana (LOGO_MODEL) for both
// true-to-life pictures and the occasional illustrated mascot; holder artworks keep the fast
// model. If Nano Banana fails: FLUX 1.1 Pro Ultra (realistic) or Recraft (illustration), then FLUX schnell.
const FAL_MODEL = process.env.FAL_MODEL || "fal-ai/flux/schnell";
export const LOGO_MODEL = process.env.LOGO_MODEL || "fal-ai/nano-banana";
export const REALISTIC_MODEL = process.env.REALISTIC_MODEL || LOGO_MODEL;

export const falConfigured = () => !!process.env.FAL_KEY;
export let lastLogoModel = null; // which model actually drew the last logo (fallbacks included)

async function falRun(model, body) {
  if (!process.env.FAL_KEY) throw new Error("FAL_KEY not configured");
  const r = await fetch(`https://fal.run/${model}`, {
    method: "POST",
    headers: { authorization: `Key ${process.env.FAL_KEY}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`fal.ai ${model} ${r.status}: ${JSON.stringify(data.detail?.[0]?.msg || data.detail || data.error || "unknown").slice(0, 200)}`);
  const url = data.images?.[0]?.url;
  if (!url) throw new Error(`fal.ai ${model} returned no image`);
  return url;
}

/** The request body each model family expects for one square image. */
function bodyFor(model, prompt, realistic) {
  if (/nano-banana|gemini|imagen/.test(model)) return { prompt, num_images: 1, aspect_ratio: "1:1", output_format: "png" };
  if (/recraft/.test(model)) return { prompt, image_size: "square_hd", style: realistic ? "realistic_image" : process.env.LOGO_STYLE || "digital_illustration" };
  if (/ultra/.test(model)) return { prompt, aspect_ratio: "1:1", num_images: 1, enable_safety_checker: true, output_format: "jpeg" };
  return { prompt, image_size: "square_hd", num_images: 1, enable_safety_checker: true };
}

export function generateImage(prompt) {
  return falRun(FAL_MODEL, bodyFor(FAL_MODEL, prompt, false));
}

export async function generateLogo(prompt, { realistic = false, model } = {}) {
  const chain = [model || (realistic ? REALISTIC_MODEL : LOGO_MODEL), realistic ? "fal-ai/flux-pro/v1.1-ultra" : "fal-ai/recraft-v3"];
  for (const m of [...new Set(chain)]) {
    try { const url = await falRun(m, bodyFor(m, prompt, realistic)); lastLogoModel = m; return url; }
    catch (err) { console.warn(`[logo] ${m} failed:`, err.message); }
  }
  lastLogoModel = FAL_MODEL;
  return generateImage(prompt);
}

export function logoPrompt(plan) {
  const base = String(plan.logoPrompt || "").replace(/\s+/g, " ").trim().slice(0, 500);
  if (plan.logoStyle === "illustration") return `${base}. Memecoin mascot logo${plan.name ? ` for "${plan.name}"` : ""}: one iconic character or emblem, centered, strong silhouette that reads at 48px, expressive, vibrant colors, plain contrasting background, crisp edges. Square 1:1 composition filling the frame. No text, no letters, no watermark, no frame.`;
  return `${base}. Photorealistic, true-to-life photograph, natural light, sharp focus, rich detail, one clear subject centered and filling the square 1:1 frame, shot on a professional camera, looks like a real news or wildlife photo, not a cartoon or illustration. No text, no letters, no watermark, no frame.`;
}

export function artworkPrompt(request) {
  const base = String(request || "").replace(/\s+/g, " ").trim().slice(0, 300);
  return `${base}. Pixel-art style illustration by a playful digital artist, bold colors, clean composition, high quality, no text.`;
}
