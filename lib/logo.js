// Image generation through fal.ai (coin logo, holder artworks).
const FAL_MODEL = process.env.FAL_MODEL || "fal-ai/flux/schnell";

export const falConfigured = () => !!process.env.FAL_KEY;

export async function generateImage(prompt) {
  if (!process.env.FAL_KEY) throw new Error("FAL_KEY not configured");
  const r = await fetch(`https://fal.run/${FAL_MODEL}`, {
    method: "POST",
    headers: { authorization: `Key ${process.env.FAL_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ prompt, image_size: "square_hd", num_images: 1, enable_safety_checker: true }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`fal.ai ${r.status}: ${data.detail?.[0]?.msg || data.detail || data.error || "unknown"}`);
  const url = data.images?.[0]?.url;
  if (!url) throw new Error("fal.ai returned no image");
  return url;
}

export function logoPrompt(plan) {
  const base = String(plan.logoPrompt || "").replace(/\s+/g, " ").trim().slice(0, 500);
  return `${base}. Memecoin logo${plan.name ? ` for "${plan.name}"` : ""}, single centered emblem, bold readable shapes, vibrant colors, clean simple background, high quality, no text, no letters, no watermark.`;
}

export function artworkPrompt(request) {
  const base = String(request || "").replace(/\s+/g, " ").trim().slice(0, 300);
  return `${base}. Pixel-art style illustration by a playful digital artist, bold colors, clean composition, high quality, no text.`;
}
