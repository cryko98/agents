// Image generation through fal.ai. Coin logos use a stronger illustration model (Recraft V3 by
// default); holder artworks keep the fast model. If the logo model fails, the fast one is used.
const FAL_MODEL = process.env.FAL_MODEL || "fal-ai/flux/schnell";
export const LOGO_MODEL = process.env.LOGO_MODEL || "fal-ai/recraft-v3";

export const falConfigured = () => !!process.env.FAL_KEY;

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

export function generateImage(prompt) {
  return falRun(FAL_MODEL, { prompt, image_size: "square_hd", num_images: 1, enable_safety_checker: true });
}

export async function generateLogo(prompt) {
  const recraft = /recraft/.test(LOGO_MODEL);
  const body = recraft
    ? { prompt, image_size: "square_hd", style: process.env.LOGO_STYLE || "digital_illustration" }
    : { prompt, image_size: "square_hd", aspect_ratio: "1:1", num_images: 1, enable_safety_checker: true };
  try {
    return await falRun(LOGO_MODEL, body);
  } catch (err) {
    console.warn("[logo] falling back to", FAL_MODEL, err.message);
    return generateImage(prompt);
  }
}

export function logoPrompt(plan) {
  const base = String(plan.logoPrompt || "").replace(/\s+/g, " ").trim().slice(0, 500);
  return `${base}. Professional memecoin mascot logo${plan.name ? ` for "${plan.name}"` : ""}: one iconic character or emblem, centered, sticker style with a thick clean outline, bold flat shapes, strong silhouette that reads at 48px, expressive face, 3-4 vibrant colors with simple shading, plain solid contrasting background, crisp edges. No text, no letters, no watermark, no frame.`;
}

export function artworkPrompt(request) {
  const base = String(request || "").replace(/\s+/g, " ").trim().slice(0, 300);
  return `${base}. Pixel-art style illustration by a playful digital artist, bold colors, clean composition, high quality, no text.`;
}
