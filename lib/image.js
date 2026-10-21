// Coin logos for pump.fun: any image (Pixel's generated logo or one found on the web) becomes a
// 1000x1000 PNG. Near-square images are smart-cropped; very wide or tall ones are fitted whole on
// a blurred copy of themselves, so nothing important gets cut off.
let sharpLib;
const sharp = async () => (sharpLib ||= (await import("sharp")).default);

export async function squareLogo(url) {
  const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (compatible; CookersBot/1.0)" }, signal: AbortSignal.timeout(15000), redirect: "follow" });
  if (!r.ok) throw new Error(`image ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  const s = await sharp();
  const meta = await s(buf).metadata();
  if (!meta.width || !meta.height) throw new Error("not an image");
  if (Math.min(meta.width, meta.height) < 120) throw new Error(`image too small (${meta.width}x${meta.height})`);
  const ratio = meta.width / meta.height;
  let png;
  if (ratio > 0.6 && ratio < 1.67) {
    png = await s(buf).rotate().resize(1000, 1000, { fit: "cover", position: "attention" }).png().toBuffer();
  } else {
    const bg = await s(buf).rotate().resize(1000, 1000, { fit: "cover" }).blur(28).modulate({ brightness: 0.65 }).png().toBuffer();
    const fg = await s(buf).rotate().resize(1000, 1000, { fit: "inside" }).png().toBuffer();
    png = await s(bg).composite([{ input: fg, gravity: "center" }]).png().toBuffer();
  }
  return new Blob([png], { type: "image/png" });
}

/** Quick check that a found image is usable before the crew commits to it. */
export async function checkImage(url) {
  try { await squareLogo(url); return true; } catch { return false; }
}
