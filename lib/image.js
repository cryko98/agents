// Coin logos for pump.fun: any image (a real photo from the story or Pixel's drawn logo) becomes a
// 1000x1000 PNG that fills the whole square. Non-square images are cropped around their most
// interesting part (sharp's "attention" strategy: faces, contrast, saturated detail).
let sharpLib;
const sharp = async () => (sharpLib ||= (await import("sharp")).default);

// Bing News thumbnails asked for a size bigger than the original come back letterboxed in white:
// always take Bing's original instead
function unpadded(url) {
  try {
    const u = new URL(url);
    if (!/(^|\.)bing\.com$/.test(u.hostname) || u.pathname !== "/th") return url;
    for (const k of ["w", "h", "c"]) u.searchParams.delete(k);
    return u.toString();
  } catch { return url; }
}

export async function squareLogo(url) {
  // some news CDNs refuse bot user agents, so ask like a browser would
  const r = await fetch(unpadded(url), { headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36", accept: "image/avif,image/webp,image/png,image/jpeg,*/*" }, signal: AbortSignal.timeout(15000), redirect: "follow" });
  if (!r.ok) throw new Error(`image ${r.status}`);
  const s = await sharp();
  const buf = await s(Buffer.from(await r.arrayBuffer())).rotate().toBuffer();
  const meta = await s(buf).metadata();
  if (!meta.width || !meta.height) throw new Error("not an image");
  if (Math.min(meta.width, meta.height) < 120) throw new Error(`image too small (${meta.width}x${meta.height})`);
  const png = await s(buf).resize(1000, 1000, { fit: "cover", position: "attention" }).png().toBuffer();
  return new Blob([png], { type: "image/png" });
}

/** Quick check that a found image is usable before the crew commits to it. */
export async function checkImage(url) {
  try { await squareLogo(url); return true; } catch { return false; }
}
