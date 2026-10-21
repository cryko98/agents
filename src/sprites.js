// Procedural pixel-art characters. Each agent is a 12x17 pixel figure built from
// rectangles so every resident can have their own hair, outfit and accessory.
import { S } from "./config.js";

export const SPRITE_W = 12;
export const SPRITE_H = 17;

const DARK = "#1b1b22";
const ACCESSORY_COLORS = { beanie: "#1f2937", beret: "#7f1d1d", headphones: "#111827" };

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, (n >> 16) + amt));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt));
  const b = Math.max(0, Math.min(255, (n & 255) + amt));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

/**
 * Draw a character.
 * @param ctx canvas context
 * @param look appearance from the roster
 * @param fx,fy screen position of the feet center
 * @param opts { facing: 'se'|'sw'|'ne'|'nw', frame: 0|1|2 (walk), sitting: bool, scale }
 */
export function drawCharacter(ctx, look, fx, fy, opts = {}) {
  const scale = opts.scale ?? S;
  const facing = opts.facing ?? "sw";
  const back = facing === "ne" || facing === "nw";
  const flip = facing === "sw" || facing === "nw";
  const frame = opts.frame ?? 0;
  const sitting = !!opts.sitting;
  const bob = frame === 1 ? 1 : 0;

  ctx.save();
  ctx.translate(Math.round(fx), Math.round(fy));
  if (flip) ctx.scale(-1, 1);
  const ox = -Math.floor(SPRITE_W / 2) * scale;
  const oy = -SPRITE_H * scale + (sitting ? 2 * scale : 0) + bob * scale;
  const px = (x, y, w, h, color) => {
    ctx.fillStyle = color;
    ctx.fillRect(ox + x * scale, oy + y * scale, w * scale, h * scale);
  };

  const { skin, hair, hairStyle, top, bottom, shoes, accessory } = look;
  const topDark = shade(top, -30);
  const hairDark = shade(hair, -25);

  // --- legs & shoes ---
  if (sitting) {
    px(3, 13, 6, 2, bottom);
    px(3, 15, 2, 1, shoes);
    px(7, 15, 2, 1, shoes);
  } else if (frame === 0) {
    px(3, 13, 2, 3, bottom); px(7, 13, 2, 3, bottom);
    px(3, 16, 2, 1, shoes); px(7, 16, 2, 1, shoes);
  } else if (frame === 1) {
    px(3, 13, 2, 3, bottom); px(7, 13, 2, 2, bottom);
    px(3, 16, 2, 1, shoes); px(7, 15, 2, 1, shoes);
  } else {
    px(3, 13, 2, 2, bottom); px(7, 13, 2, 3, bottom);
    px(3, 15, 2, 1, shoes); px(7, 16, 2, 1, shoes);
  }

  // --- torso & arms ---
  px(3, 9, 6, 4, top);
  px(3, 12, 6, 1, topDark);
  const armL = frame === 1 ? 1 : 0, armR = frame === 2 ? 1 : 0;
  px(2, 9 + armL, 1, 3, topDark); px(9, 9 + armR, 1, 3, topDark);
  px(2, 12 + armL, 1, 1, skin); px(9, 12 + armR, 1, 1, skin);
  if (!back) px(5, 9, 2, 1, shade(top, 25)); // collar highlight

  // --- neck & head ---
  px(5, 8, 2, 1, shade(skin, -20));
  px(3, 2, 6, 6, skin);

  if (!back) {
    // face
    px(4, 5, 1, 1, DARK); px(7, 5, 1, 1, DARK);
    px(4, 4, 1, 1, "#fff"); px(7, 4, 1, 1, "#fff");
    px(4, 5, 1, 1, DARK); px(7, 5, 1, 1, DARK);
    px(5, 7, 2, 1, shade(skin, -35)); // mouth
    px(3, 6, 1, 1, shade(skin, -12)); px(8, 6, 1, 1, shade(skin, -12)); // cheeks
  } else {
    px(3, 2, 6, 6, hairStyle === "beanie" ? skin : hair);
  }

  // --- hair ---
  switch (hairStyle) {
    case "short":
      px(3, 1, 6, 2, hair); px(3, 3, 1, 1, hair); px(8, 3, 1, 1, hair);
      if (back) px(3, 1, 6, 7, hair);
      break;
    case "spiky":
      px(3, 1, 6, 2, hair); px(2, 2, 1, 1, hair);
      px(3, 0, 1, 1, hair); px(5, 0, 1, 1, hair); px(7, 0, 1, 1, hair); px(9, 0, 1, 1, hairDark);
      if (back) px(3, 1, 6, 6, hair);
      break;
    case "long":
      px(3, 1, 6, 2, hair); px(2, 2, 1, 7, hair); px(9, 2, 1, 7, hair);
      px(2, 1, 1, 1, hairDark); px(9, 1, 1, 1, hairDark);
      if (back) { px(3, 1, 6, 8, hair); px(3, 8, 6, 1, hairDark); }
      break;
    case "bob":
      px(2, 1, 8, 3, hair); px(2, 4, 1, 3, hair); px(9, 4, 1, 3, hair);
      px(2, 6, 1, 1, hairDark); px(9, 6, 1, 1, hairDark);
      if (back) px(2, 1, 8, 6, hair);
      break;
    case "curly":
      px(2, 0, 8, 3, hair); px(2, 3, 1, 3, hair); px(9, 3, 1, 3, hair);
      px(3, 0, 1, 1, hairDark); px(6, 0, 1, 1, hairDark); px(8, 0, 1, 1, hairDark);
      px(1, 2, 1, 1, hair); px(10, 2, 1, 1, hair);
      if (back) px(2, 0, 8, 7, hair);
      break;
    case "beanie": {
      const hat = ACCESSORY_COLORS.beanie;
      px(2, 0, 8, 3, hat); px(2, 3, 8, 1, shade(hat, 30));
      px(3, 4, 6, 1, hair); // hair peeking out
      if (back) { px(3, 4, 6, 3, hair); px(2, 0, 8, 4, hat); px(2, 3, 8, 1, shade(hat, 30)); }
      break;
    }
    default:
      px(3, 1, 6, 2, hair);
  }

  // --- accessories ---
  switch (accessory) {
    case "glasses":
      if (!back) {
        px(3, 4, 2, 1, DARK); px(7, 4, 2, 1, DARK);
        px(3, 6, 2, 1, DARK); px(7, 6, 2, 1, DARK);
        px(5, 5, 2, 1, DARK);
        ctx.globalAlpha = 0.35; px(3, 5, 2, 1, "#9ad1ff"); px(7, 5, 2, 1, "#9ad1ff"); ctx.globalAlpha = 1;
      }
      break;
    case "sunglasses":
      if (!back) { px(3, 5, 6, 1, DARK); px(3, 4, 6, 1, "#2b2b36"); px(4, 5, 1, 1, "#5b5bd6"); px(7, 5, 1, 1, "#5b5bd6"); }
      else px(2, 4, 8, 1, DARK);
      break;
    case "beret": {
      const hat = ACCESSORY_COLORS.beret;
      px(2, 1, 8, 1, hat); px(3, 0, 6, 1, hat); px(8, 0, 1, 1, shade(hat, 40));
      break;
    }
    case "headphones":
      px(2, 0, 8, 1, ACCESSORY_COLORS.headphones);
      px(1, 3, 1, 3, "#0f766e"); px(10, 3, 1, 3, "#0f766e");
      px(1, 4, 1, 1, "#5eead4"); px(10, 4, 1, 1, "#5eead4");
      break;
  }

  ctx.restore();
}

/** Render a 64x64 portrait (head + shoulders) as a data URL. */
export function portraitDataURL(look, bg = "transparent") {
  const cv = document.createElement("canvas");
  cv.width = 64; cv.height = 64;
  const ctx = cv.getContext("2d");
  if (bg !== "transparent") { ctx.fillStyle = bg; ctx.fillRect(0, 0, 64, 64); }
  // scale 4 -> sprite 48x68; feet at y=76 so the head sits in frame
  drawCharacter(ctx, look, 32, 76, { facing: "se", scale: 4 });
  return cv.toDataURL();
}
