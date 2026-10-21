// Image generation through fal.ai. Coin logos use a stronger illustration model (Recraft V3 by
// default), or a photorealistic model (FLUX 1.1 Pro Ultra by default) when the crew wants a
// true-to-life picture; holder artworks keep the fast model. Failures fall back down the chain.
const FAL_MODEL = process.env.FAL_MODEL || "fal-ai/flux/schnell";
export const LOGO_MODEL = process.env.LOGO_MODEL || "fal-ai/recraft-v3";
export const REALISTIC_MODEL = process.env.REALISTIC_MODEL || "fal-ai/flux-pro/v1.1-ultra";

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

export async function generateLogo(prompt, { realistic = false } = {}) {
  if (realistic) {
    const body = /recraft/.test(REALISTIC_MODEL)
      ? { prompt, image_size: "square_hd", style: "realistic_image" }
      : { prompt, aspect_ratio: "1:1", num_images: 1, enable_safety_checker: true, output_format: "jpeg" };
    try { return await falRun(REALISTIC_MODEL, body); } catch (err) {
      console.warn("[logo] realistic model failed, trying Recraft realistic_image:", err.message);
      try { return await falRun("fal-ai/recraft-v3", { prompt, image_size: "square_hd", style: "realistic_image" }); } catch { return generateImage(prompt); }
    }
  }
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
  if (plan.logoStyle === "realistic") return `${base}. Photorealistic, true-to-life photograph, natural light, sharp focus, rich detail, one clear subject centered and filling the square frame, shot on a professional camera. No text, no letters, no watermark, no frame.`;
  return `${base}. Professional memecoin mascot logo${plan.name ? ` for "${plan.name}"` : ""}: one iconic character or emblem, centered, sticker style with a thick clean outline, bold flat shapes, strong silhouette that reads at 48px, expressive face, 3-4 vibrant colors with simple shading, plain solid contrasting background, crisp edges. No text, no letters, no watermark, no frame.`;
}

export function artworkPrompt(request) {
  const base = String(request || "").replace(/\s+/g, " ").trim().slice(0, 300);
  return `${base}. Pixel-art style illustration by a playful digital artist, bold colors, clean composition, high quality, no text.`;
}
