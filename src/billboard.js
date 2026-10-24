// The garden billboard's face, drawn on a canvas: the 3D board in the garden and the live preview in
// the rent form use the same drawing. Pictures load async; onImage() asks for a redraw.
import { displayUrl } from "../shared/media.js";

export const BOARD_W = 1024, BOARD_H = 512;
const DISPLAY = "'Lilita One', 'Nunito', sans-serif", UI = "'Nunito', system-ui, sans-serif";
const images = new Map();

/** A loaded <img> for url, or null while it loads (onload fires once it is ready). */
export function boardImage(url, onload) {
  if (!url) return null;
  const src = url.startsWith("data:") ? url : displayUrl(url);
  let rec = images.get(src);
  if (!rec) {
    const img = new Image();
    if (!src.startsWith("data:")) img.crossOrigin = "anonymous";
    rec = { img, ok: false, waiting: new Set() };
    img.onload = () => { rec.ok = true; for (const f of rec.waiting) f(); rec.waiting.clear(); };
    img.onerror = () => { rec.failed = true; };
    img.src = src;
    images.set(src, rec);
  }
  if (rec.ok) return rec.img;
  if (onload && !rec.failed) rec.waiting.add(onload);
  return null;
}

function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }

function wrap(ctx, text, x, y, maxW, lineH, maxLines) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  let line = "", n = 0;
  for (let i = 0; i < words.length; i++) {
    const test = line ? `${line} ${words[i]}` : words[i];
    if (ctx.measureText(test).width > maxW && line) {
      if (n === maxLines - 1) { ctx.fillText(`${line.replace(/\s*\S*$/, "")}…`, x, y + n * lineH); return n + 1; }
      ctx.fillText(line, x, y + n * lineH); line = words[i]; n++;
    } else line = test;
  }
  if (line) { ctx.fillText(line, x, y + n * lineH); n++; }
  return n;
}

/** Fill a box with an image (cover). */
function cover(ctx, img, x, y, w, h) {
  const s = Math.max(w / img.width, h / img.height), iw = img.width * s, ih = img.height * s;
  ctx.drawImage(img, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
}

function sponsored(ctx) {
  ctx.font = `800 20px ${UI}`;
  const w = ctx.measureText("SPONSORED").width + 28;
  rr(ctx, BOARD_W - w - 22, 20, w, 36, 18); ctx.fillStyle = "#0b0a1ecc"; ctx.fill();
  ctx.fillStyle = "#ffcf5c"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
  ctx.fillText("SPONSORED", BOARD_W - w - 8, 39);
}

/** X logo, drawn. */
function xMark(ctx, x, y, s, color) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s / 24, s / 24); ctx.fillStyle = color;
  ctx.fill(new Path2D("M18.9 2H22l-6.8 7.8L23.2 22h-6.3l-4.9-6.4L6.4 22H3.3l7.3-8.3L2.8 2h6.4l4.4 5.8L18.9 2Zm-1.1 18h1.7L8.3 3.9H6.5L17.8 20Z"));
  ctx.restore();
}

export function drawBillboard(ctx, ad, { price = 0.02, onImage } = {}) {
  const W = BOARD_W, H = BOARD_H;
  ctx.save();
  ctx.clearRect(0, 0, W, H);
  ctx.textBaseline = "alphabetic";
  if (!ad) {
    // empty board: the rent offer
    const g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, "#2a1f6b"); g.addColorStop(1, "#b0357e");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 0.12; ctx.fillStyle = "#fff";
    for (let i = -H; i < W; i += 70) { ctx.beginPath(); ctx.moveTo(i, H); ctx.lineTo(i + H, 0); ctx.lineTo(i + H + 30, 0); ctx.lineTo(i + 30, H); ctx.fill(); }
    ctx.globalAlpha = 1;
    ctx.textAlign = "center"; ctx.fillStyle = "#fff";
    ctx.font = `110px ${DISPLAY}`; ctx.shadowColor = "#0b0a1e"; ctx.shadowOffsetY = 8;
    ctx.fillText("YOUR AD HERE", W / 2, 220);
    ctx.shadowOffsetY = 0;
    ctx.font = `800 40px ${UI}`; ctx.fillStyle = "#ffe9a8";
    ctx.fillText(`Rent this board from ${price} SOL / hour`, W / 2, 300);
    ctx.font = `800 30px ${UI}`; ctx.fillStyle = "#ffffffcc";
    ctx.fillText("X profile · any text · your picture · click to rent", W / 2, 370);
    ctx.restore();
    return;
  }
  if (ad.type === "image") {
    ctx.fillStyle = "#111"; ctx.fillRect(0, 0, W, H);
    const img = boardImage(ad.image, onImage);
    if (img) cover(ctx, img, 0, 0, W, H);
    if (ad.headline) {
      const g = ctx.createLinearGradient(0, H - 170, 0, H); g.addColorStop(0, "#0000"); g.addColorStop(1, "#000c");
      ctx.fillStyle = g; ctx.fillRect(0, H - 170, W, 170);
      ctx.fillStyle = "#fff"; ctx.textAlign = "left"; ctx.font = `64px ${DISPLAY}`;
      wrap(ctx, ad.headline, 40, H - 50, W - 80, 64, 1);
    }
  } else if (ad.type === "x") {
    const g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, "#0f1419"); g.addColorStop(1, "#1d2a3a");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    const cx = 220, cy = 256, r = 160;
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
    const img = boardImage(ad.avatar, onImage);
    if (img) cover(ctx, img, cx - r, cy - r, r * 2, r * 2);
    else { ctx.fillStyle = "#2f3b4c"; ctx.fillRect(cx - r, cy - r, r * 2, r * 2); xMark(ctx, cx - 70, cy - 70, 140, "#fff"); }
    ctx.restore();
    ctx.lineWidth = 10; ctx.strokeStyle = "#1d9bf0"; ctx.beginPath(); ctx.arc(cx, cy, r + 4, 0, Math.PI * 2); ctx.stroke();
    ctx.textAlign = "left"; ctx.fillStyle = "#fff";
    ctx.font = `${ad.handle.length > 11 ? 66 : 80}px ${DISPLAY}`;
    ctx.fillText(`@${ad.handle}`, 420, 170);
    ctx.font = `800 34px ${UI}`; ctx.fillStyle = "#c7d2df";
    const n = ad.headline ? wrap(ctx, ad.headline, 420, 232, 560, 42, 2) : 0;
    rr(ctx, 420, 250 + n * 42, 300, 84, 42); ctx.fillStyle = "#fff"; ctx.fill();
    xMark(ctx, 448, 274 + n * 42, 36, "#0f1419");
    ctx.fillStyle = "#0f1419"; ctx.font = `900 36px ${UI}`; ctx.fillText("Follow", 502, 305 + n * 42);
  } else {
    const g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, "#ffcf5c"); g.addColorStop(1, "#ff7ac3");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    const img = boardImage(ad.image, onImage);
    let x = 60, w = W - 120;
    if (ad.image) {
      rr(ctx, 40, 40, 400, 432, 28); ctx.save(); ctx.clip();
      if (img) cover(ctx, img, 40, 40, 400, 432); else { ctx.fillStyle = "#0002"; ctx.fill(); }
      ctx.restore(); x = 480; w = W - 520;
    }
    ctx.textAlign = "left"; ctx.fillStyle = "#1b1440";
    ctx.font = `${ad.headline.length > 28 ? 64 : 84}px ${DISPLAY}`;
    const n = wrap(ctx, ad.headline, x, 150, w, ad.headline.length > 28 ? 70 : 88, 3);
    ctx.font = `800 32px ${UI}`; ctx.fillStyle = "#3a2a63";
    if (ad.description) wrap(ctx, ad.description, x, 150 + n * (ad.headline.length > 28 ? 70 : 88) + 10, w, 40, 2);
    if (ad.link) { ctx.font = `900 28px ${UI}`; ctx.fillStyle = "#1b1440"; ctx.fillText(new URL(ad.link).hostname.replace(/^www\./, ""), x, H - 46); }
  }
  sponsored(ctx);
  ctx.restore();
}
