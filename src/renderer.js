// Isometric renderer: floor, walls, furniture and characters in depth order.
import { TW, TH, WALL_H, PART_H, COLS, ROWS, S } from "./config.js";
import { ROOMS, roomAt, isDoor, FURNITURE, WALL_ITEMS } from "./world.js";
import { drawCharacter, SPRITE_H } from "./sprites.js";

const WALL_N = "#2c3658", WALL_W = "#232c4b", WALL_TOP = "#4a568c", BASE = "#161c33";
const PART_N = "#3b4672", PART_W = "#303a63", PART_TOP = "#5a67a3";

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.ctx.imageSmoothingEnabled = false;
    const minX = (0 - ROWS) * TW / 2, maxX = COLS * TW / 2;
    this.ox = Math.round(canvas.width / 2 - (minX + maxX) / 2);
    this.oy = 84;
    this.floorLayer = this.buildFloorLayer();
    this.logoImage = null; // HTMLImageElement shown on the meeting-room screen
    this.time = 0;
  }

  p(c, r) {
    return { x: this.ox + (c - r) * TW / 2, y: this.oy + (c + r) * TH / 2 };
  }

  // ---------- floor (static, pre-rendered) ----------
  buildFloorLayer() {
    const cv = document.createElement("canvas");
    cv.width = this.canvas.width; cv.height = this.canvas.height;
    const ctx = cv.getContext("2d");
    // soft drop shadow under the whole house
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      if (!roomAt[r][c]) continue;
      this.diamond(ctx, c + 0.15, r + 0.15, 1, 1, "#00000055");
    }
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const k = roomAt[r][c];
      if (!k) continue;
      this.drawFloorTile(ctx, c, r, ROOMS[k].floor);
    }
    for (const f of FURNITURE) if (f.type === "rug") this.drawRug(ctx, f);
    return cv;
  }

  diamond(ctx, c, r, w, d, fill, stroke) {
    const T = this.p(c, r), R = this.p(c + w, r), B = this.p(c + w, r + d), L = this.p(c, r + d);
    ctx.beginPath(); ctx.moveTo(T.x, T.y); ctx.lineTo(R.x, R.y); ctx.lineTo(B.x, B.y); ctx.lineTo(L.x, L.y); ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
  }

  drawFloorTile(ctx, c, r, style) {
    let fill, edge = "#00000022";
    switch (style) {
      case "wood": fill = (c % 2 === 0) ? "#9a6a3f" : "#8e5f36"; break;
      case "carpetBlue": fill = ((c + r) % 2 === 0) ? "#3756a2" : "#34519a"; break;
      case "carpetNavy": fill = ((c + r) % 2 === 0) ? "#243463" : "#21305c"; break;
      case "carpetPink": fill = ((c + r) % 2 === 0) ? "#c9679a" : "#c26093"; break;
      case "tile": fill = ((c + r) % 2 === 0) ? "#ece7dc" : "#dfd9cc"; edge = "#b9b2a4"; break;
      case "checker": fill = ((c + r) % 2 === 0) ? "#f2eee6" : "#1c1d28"; edge = "#00000033"; break;
      default: fill = "#777";
    }
    this.diamond(ctx, c, r, 1, 1, fill, edge);
    if (style === "wood") {
      // plank seams along the r axis
      ctx.strokeStyle = "#00000030"; ctx.lineWidth = 1;
      for (const t of [0.33, 0.66]) {
        const a = this.p(c + t, r), b = this.p(c + t, r + 1);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
    } else if (style.startsWith("carpet")) {
      ctx.fillStyle = "#ffffff12";
      for (let i = 0; i < 4; i++) {
        const q = this.p(c + 0.2 + (i % 2) * 0.5, r + 0.25 + Math.floor(i / 2) * 0.45);
        ctx.fillRect(q.x, q.y, 2, 1);
      }
    }
  }

  drawRug(ctx, f) {
    this.diamond(ctx, f.c + 0.1, f.r + 0.1, f.w - 0.2, f.d - 0.2, "#e0b35a", "#8a6a2a");
    this.diamond(ctx, f.c + 0.3, f.r + 0.3, f.w - 0.6, f.d - 0.6, "#c4903f");
  }

  // ---------- iso box helper ----------
  box(ctx, c, r, w, d, h, cols, z = 0) {
    const lift = (pt) => ({ x: pt.x, y: pt.y - z });
    const T = lift(this.p(c, r)), R = lift(this.p(c + w, r)), B = lift(this.p(c + w, r + d)), L = lift(this.p(c, r + d));
    // left face (south edge)
    ctx.fillStyle = cols.left;
    ctx.beginPath(); ctx.moveTo(L.x, L.y); ctx.lineTo(B.x, B.y); ctx.lineTo(B.x, B.y - h); ctx.lineTo(L.x, L.y - h); ctx.closePath(); ctx.fill();
    // right face (east edge)
    ctx.fillStyle = cols.right;
    ctx.beginPath(); ctx.moveTo(B.x, B.y); ctx.lineTo(R.x, R.y); ctx.lineTo(R.x, R.y - h); ctx.lineTo(B.x, B.y - h); ctx.closePath(); ctx.fill();
    // top
    ctx.fillStyle = cols.top;
    ctx.beginPath(); ctx.moveTo(T.x, T.y - h); ctx.lineTo(R.x, R.y - h); ctx.lineTo(B.x, B.y - h); ctx.lineTo(L.x, L.y - h); ctx.closePath(); ctx.fill();
    if (cols.outline !== false) {
      ctx.strokeStyle = "#00000055"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(T.x, T.y - h); ctx.lineTo(R.x, R.y - h); ctx.lineTo(B.x, B.y - h); ctx.lineTo(L.x, L.y - h); ctx.closePath(); ctx.stroke();
    }
    return { T, R, B, L };
  }

  // Draw something on the right (east) face of a box footprint: callback gets a local
  // coordinate system where x runs along the face (0..len px) and y runs down (0..h).
  onRightFace(ctx, c, r, w, d, h, z, fn) {
    const B = this.p(c + w, r + d), R = this.p(c + w, r);
    const len = Math.hypot(R.x - B.x, R.y - B.y);
    ctx.save();
    ctx.translate(B.x, B.y - z - h);
    ctx.transform(1, -0.5, 0, 1, 0, 0);
    fn(len, h);
    ctx.restore();
  }
  onLeftFace(ctx, c, r, w, d, h, z, fn) {
    const L = this.p(c, r + d), B = this.p(c + w, r + d);
    const len = Math.hypot(B.x - L.x, B.y - L.y);
    ctx.save();
    ctx.translate(L.x, L.y - z - h);
    ctx.transform(1, 0.5, 0, 1, 0, 0);
    fn(len, h);
    ctx.restore();
  }

  // ---------- walls ----------
  wallSegments() {
    const segs = [];
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const k = roomAt[r][c];
      if (!k) continue;
      const kn = r > 0 ? roomAt[r - 1][c] : null;
      const kw = c > 0 ? roomAt[r][c - 1] : null;
      if (kn === null) segs.push({ c, r, side: "n", kind: "ext" });
      else if (kn !== k && !isDoor(c, r, c, r - 1)) segs.push({ c, r, side: "n", kind: "part" });
      if (kw === null) segs.push({ c, r, side: "w", kind: "ext" });
      else if (kw !== k && !isDoor(c, r, c - 1, r)) segs.push({ c, r, side: "w", kind: "part" });
    }
    return segs;
  }

  drawWall(ctx, seg) {
    const { c, r, side, kind } = seg;
    const h = kind === "ext" ? WALL_H : PART_H;
    const T = this.p(c, r);
    const E = side === "n" ? this.p(c + 1, r) : this.p(c, r + 1);
    ctx.fillStyle = kind === "ext" ? (side === "n" ? WALL_N : WALL_W) : (side === "n" ? PART_N : PART_W);
    ctx.beginPath(); ctx.moveTo(T.x, T.y); ctx.lineTo(E.x, E.y); ctx.lineTo(E.x, E.y - h); ctx.lineTo(T.x, T.y - h); ctx.closePath(); ctx.fill();
    // top cap
    ctx.strokeStyle = kind === "ext" ? WALL_TOP : PART_TOP; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(T.x, T.y - h + 1); ctx.lineTo(E.x, E.y - h + 1); ctx.stroke();
    // baseboard
    ctx.strokeStyle = BASE; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(T.x, T.y - 1); ctx.lineTo(E.x, E.y - 1); ctx.stroke();
    if (kind === "ext") {
      for (const item of WALL_ITEMS) if (item.c === c && item.r === r && item.side === side) this.drawWallItem(ctx, item);
    }
  }

  drawWallItem(ctx, item) {
    const { c, r, side } = item;
    const T = this.p(c, r);
    ctx.save();
    ctx.translate(T.x, T.y - WALL_H);
    // north wall runs down-right, west wall runs down-left (we draw x from -32..0)
    if (side === "n") ctx.transform(1, 0.5, 0, 1, 0, 0);
    else { ctx.transform(1, -0.5, 0, 1, 0, 0); ctx.translate(-TW / 2, 0); }
    const W = TW / 2;
    const rect = (x, y, w, h, col) => { ctx.fillStyle = col; ctx.fillRect(x, y, w, h); };
    switch (item.type) {
      case "bookshelf":
        rect(3, 6, W - 6, 36, "#5b3a1e"); rect(5, 8, W - 10, 32, "#3d2612");
        for (let row = 0; row < 3; row++) {
          rect(5, 8 + row * 11, W - 10, 2, "#7a5230");
          const cols = ["#e74c3c", "#3498db", "#f1c40f", "#2ecc71", "#9b59b6", "#e67e22"];
          for (let i = 0; i < 5; i++) rect(6 + i * 4, 10 + row * 11, 3, 8, cols[(i + row) % cols.length]);
        }
        break;
      case "shelf":
        rect(3, 14, W - 6, 3, "#7a5230"); rect(6, 8, 5, 6, "#2ecc71"); rect(13, 9, 4, 5, "#e67e22"); rect(20, 7, 6, 7, "#ecf0f1");
        break;
      case "clock":
        ctx.fillStyle = "#f5f5f0"; ctx.beginPath(); ctx.arc(W / 2, 18, 7, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "#222"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(W / 2, 18, 7, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(W / 2, 18); ctx.lineTo(W / 2, 13); ctx.moveTo(W / 2, 18); ctx.lineTo(W / 2 + 4, 18); ctx.stroke();
        break;
      case "poster":
        rect(6, 8, W - 12, 24, "#111"); rect(8, 10, W - 16, 20, item.color || "#7c5cff");
        rect(10, 13, W - 20, 3, "#ffffffaa"); rect(10, 19, W - 24, 2, "#ffffff77"); rect(10, 24, W - 22, 2, "#ffffff55");
        break;
      case "frame":
        rect(8, 10, W - 16, 16, "#c9a86b"); rect(10, 12, W - 20, 12, item.color || "#60a5fa"); rect(12, 14, 6, 4, "#ffffff66");
        break;
      case "window":
        rect(4, 6, W - 8, 30, "#1e293b"); rect(6, 8, W - 12, 26, "#7dd3fc"); rect(6, 8, W - 12, 10, "#bae6fd");
        rect(W / 2 - 1, 8, 2, 26, "#1e293b"); rect(6, 20, W - 12, 2, "#1e293b");
        break;
      case "neon": {
        const glow = (Math.sin(this.time / 300) + 1) / 2;
        ctx.shadowColor = "#f472b6"; ctx.shadowBlur = 8 + glow * 8;
        ctx.strokeStyle = "#f9a8d4"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(6, 22); ctx.lineTo(10, 10); ctx.lineTo(14, 22); ctx.lineTo(18, 10); ctx.lineTo(22, 22); ctx.lineTo(26, 10); ctx.stroke();
        ctx.shadowBlur = 0;
        break;
      }
    }
    ctx.restore();
  }

  // ---------- furniture ----------
  drawFurniture(ctx, f) {
    const { c, r, w, d } = f;
    const wood = { top: "#a9774c", left: "#6e4628", right: "#845634" };
    const dark = { top: "#2f3350", left: "#1c1f33", right: "#252942" };
    const white = { top: "#f3f4f6", left: "#c7cbd3", right: "#dde0e6" };
    switch (f.type) {
      case "desk": {
        this.box(ctx, c + 0.05, r + 0.15, 0.9, 0.7, 14, wood);
        // monitor (back faces the viewer, agent sits north of the desk)
        this.box(ctx, c + 0.3, r + 0.52, 0.4, 0.06, 13, dark, 15);
        this.box(ctx, c + 0.45, r + 0.5, 0.1, 0.1, 3, dark, 14);
        // keyboard + mug
        this.box(ctx, c + 0.3, r + 0.3, 0.4, 0.12, 2, { top: "#d7dae0", left: "#9aa0ab", right: "#b3b8c2" }, 14);
        this.box(ctx, c + 0.8, r + 0.3, 0.12, 0.12, 5, { top: "#f8fafc", left: "#64748b", right: "#94a3b8" }, 14);
        // paper
        const q = this.p(c + 0.12, r + 0.55); ctx.fillStyle = "#f8fafc"; ctx.fillRect(q.x - 2, q.y - 16, 10, 6);
        break;
      }
      case "chair": case "stool": {
        const col = f.type === "stool" ? dark : { top: "#4f46e5", left: "#312e81", right: "#3730a3" };
        this.box(ctx, c + 0.28, r + 0.28, 0.44, 0.44, 7, col);
        if (f.type === "chair") {
          if (f.facing === "sw") this.box(ctx, c + 0.28, r + 0.24, 0.44, 0.08, 20, col);
          else if (f.facing === "se") this.box(ctx, c + 0.24, r + 0.28, 0.08, 0.44, 20, col);
          else if (f.facing === "ne") this.box(ctx, c + 0.28, r + 0.68, 0.44, 0.08, 20, col);
          else this.box(ctx, c + 0.68, r + 0.28, 0.08, 0.44, 20, col);
        }
        break;
      }
      case "couch": case "armchair": {
        const col = { top: "#d64545", left: "#8f2626", right: "#b13232" };
        this.box(ctx, c + 0.05, r + 0.15, w - 0.1, 0.75, 10, col);
        this.box(ctx, c + 0.05, r + 0.1, w - 0.1, 0.18, 24, col);
        this.box(ctx, c + 0.02, r + 0.15, 0.14, 0.75, 16, col);
        this.box(ctx, c + w - 0.16, r + 0.15, 0.14, 0.75, 16, col);
        // cushion seams
        ctx.strokeStyle = "#00000033";
        for (let i = 1; i < w; i++) { const a = this.p(c + i, r + 0.2), b = this.p(c + i, r + 0.9); ctx.beginPath(); ctx.moveTo(a.x, a.y - 10); ctx.lineTo(b.x, b.y - 10); ctx.stroke(); }
        break;
      }
      case "table":
        this.box(ctx, c + 0.15, r + 0.25, w - 0.3, 0.5, 9, { top: "#3b2a1e", left: "#1f150d", right: "#2b1d13" });
        this.box(ctx, c + 0.5, r + 0.4, 0.25, 0.2, 2, { top: "#f1c40f", left: "#b7950b", right: "#d4ac0d" }, 9);
        break;
      case "ktable":
        this.box(ctx, c + 0.1, r + 0.2, 0.8, 0.6, 14, wood);
        this.box(ctx, c + 0.4, r + 0.4, 0.15, 0.15, 5, { top: "#f8fafc", left: "#64748b", right: "#94a3b8" }, 14);
        break;
      case "bigtable": {
        this.box(ctx, c + 0.1, r + 0.1, w - 0.2, d - 0.2, 16, { top: "#b8865a", left: "#6e4628", right: "#845634" });
        // laptops & papers on the table
        const items = [[0.5, 0.35], [1.6, 0.3], [2.7, 0.4], [1.0, 1.2], [2.3, 1.3]];
        items.forEach(([dx, dy], i) => {
          if (i % 2 === 0) {
            this.box(ctx, c + dx, r + dy, 0.32, 0.26, 2, { top: "#cbd5e1", left: "#64748b", right: "#94a3b8" }, 16);
            this.box(ctx, c + dx, r + dy, 0.32, 0.03, 10, { top: "#0f172a", left: "#0f172a", right: "#1e293b" }, 18);
          } else {
            const q = this.p(c + dx, r + dy); ctx.fillStyle = "#f8fafc"; ctx.fillRect(q.x - 6, q.y - 20, 12, 7);
          }
        });
        break;
      }
      case "fridge":
        this.box(ctx, c + 0.15, r + 0.12, 0.7, 0.72, 42, white);
        { const q = this.p(c + 0.85, r + 0.84); ctx.fillStyle = "#9ca3af"; ctx.fillRect(q.x - 10, q.y - 34, 2, 8); ctx.fillRect(q.x - 10, q.y - 20, 2, 10); ctx.strokeStyle = "#9ca3af"; ctx.beginPath(); ctx.moveTo(q.x - 22, q.y - 20 + 11); ctx.lineTo(q.x, q.y - 20); ctx.stroke(); }
        break;
      case "counter": {
        this.box(ctx, c, r, 1, 0.7, 20, { top: "#d9d4c7", left: "#7f6a4e", right: "#9a8260" });
        if (f.sink) { this.diamond(ctx, c + 0.25, r + 0.15, 0.5, 0.4, "#94a3b8"); const q = this.p(c + 0.5, r + 0.1); ctx.fillStyle = "#64748b"; ctx.fillRect(q.x - 1, q.y - 30, 2, 10); }
        if (f.coffee) {
          this.box(ctx, c + 0.3, r + 0.2, 0.4, 0.35, 12, dark, 20);
          const q = this.p(c + 0.7, r + 0.55); ctx.fillStyle = "#ef4444"; ctx.fillRect(q.x - 6, q.y - 28, 2, 2);
          ctx.fillStyle = "#f8fafc"; ctx.fillRect(q.x - 12, q.y - 22, 5, 4);
        }
        break;
      }
      case "vending": {
        this.box(ctx, c + 0.15, r + 0.12, 0.7, 0.72, 44, { top: "#1e3a8a", left: "#1e40af", right: "#2563eb" });
        this.onLeftFace(ctx, c + 0.15, r + 0.12, 0.7, 0.72, 44, 0, (len, h) => {
          ctx.fillStyle = "#0f172a"; ctx.fillRect(3, 4, len - 6, h - 14);
          const cols = ["#f87171", "#fbbf24", "#34d399", "#60a5fa"];
          for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { ctx.fillStyle = cols[(i + j) % 4]; ctx.fillRect(6 + j * 6, 8 + i * 8, 4, 6); }
          ctx.fillStyle = "#fde68a"; ctx.fillRect(3, h - 8, len - 6, 3);
        });
        break;
      }
      case "cooler":
        this.box(ctx, c + 0.32, r + 0.32, 0.36, 0.36, 24, white);
        this.box(ctx, c + 0.35, r + 0.35, 0.3, 0.3, 12, { top: "#bfdbfe", left: "#60a5fa", right: "#93c5fd" }, 24);
        break;
      case "screen": {
        this.box(ctx, c + 0.35, r + 0.15, 0.3, d - 0.3, 8, dark);
        this.box(ctx, c + 0.42, r + 0.12, 0.16, d - 0.24, 46, dark, 8);
        this.onRightFace(ctx, c + 0.42, r + 0.12, 0.16, d - 0.24, 46, 8, (len, h) => {
          ctx.fillStyle = "#0b1020"; ctx.fillRect(2, 3, len - 4, h - 6);
          if (this.logoImage) {
            const s = Math.min(len - 8, h - 10);
            try { ctx.drawImage(this.logoImage, (len - s) / 2, 5, s, s); } catch { /* image not ready */ }
          } else {
            // idle screen: scrolling candles
            for (let i = 0; i < 9; i++) {
              const hh = 6 + ((i * 7 + Math.floor(this.time / 400)) % 5) * 4;
              ctx.fillStyle = i % 3 === 1 ? "#f87171" : "#4ade80";
              ctx.fillRect(6 + i * 5, h - 10 - hh, 3, hh);
            }
            ctx.fillStyle = "#94a3b8"; ctx.font = "7px monospace"; ctx.fillText("WAITING FOR LOGO", 5, 12);
          }
        });
        break;
      }
      case "whiteboard": {
        this.box(ctx, c + 0.2, r + 0.4, 0.6, 0.08, 10, dark);
        this.box(ctx, c + 0.1, r + 0.4, 0.8, 0.1, 34, white, 10);
        this.onLeftFace(ctx, c + 0.1, r + 0.4, 0.8, 0.1, 34, 10, (len, h) => {
          ctx.strokeStyle = "#ef4444"; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(5, h - 8); ctx.lineTo(12, 14); ctx.lineTo(20, 22); ctx.lineTo(28, 8); ctx.lineTo(len - 5, 12); ctx.stroke();
          ctx.strokeStyle = "#2563eb"; ctx.beginPath(); ctx.moveTo(5, 8); ctx.lineTo(16, 8); ctx.moveTo(5, 12); ctx.lineTo(22, 12); ctx.stroke();
        });
        break;
      }
      case "arcade": {
        const col = f.alt ? { top: "#7c3aed", left: "#4c1d95", right: "#6d28d9" } : { top: "#db2777", left: "#831843", right: "#be185d" };
        this.box(ctx, c + 0.15, r + 0.12, 0.7, 0.72, 46, col);
        this.onRightFace(ctx, c + 0.15, r + 0.12, 0.7, 0.72, 46, 0, (len, h) => {
          ctx.fillStyle = "#0b1020"; ctx.fillRect(3, 6, len - 6, 20);
          const t = Math.floor(this.time / 250);
          for (let i = 0; i < 6; i++) { ctx.fillStyle = ["#22d3ee", "#facc15", "#f472b6", "#4ade80"][(i + t) % 4]; ctx.fillRect(6 + i * 4, 10 + ((i + t) % 3) * 4, 3, 3); }
          ctx.fillStyle = "#ef4444"; ctx.fillRect(len / 2 - 2, h - 14, 4, 4);
          ctx.fillStyle = "#facc15"; ctx.fillRect(len / 2 + 4, h - 13, 3, 3);
        });
        break;
      }
      case "pool": {
        this.box(ctx, c + 0.05, r + 0.15, w - 0.1, 0.7, 20, { top: "#5a3b22", left: "#3b2414", right: "#4a2e1a" });
        this.diamond(ctx, c + 0.15, r + 0.25, w - 0.3, 0.5, "#1f8a4c");
        const pts = this.p(c + 0.15, r + 0.25);
        void pts;
        const balls = [[0.5, 0.5, "#fbbf24"], [0.9, 0.4, "#ef4444"], [1.2, 0.55, "#3b82f6"], [0.7, 0.62, "#f8fafc"], [1.5, 0.45, "#111"]];
        for (const [dx, dy, col] of balls) { const q = this.p(c + dx, r + dy); ctx.fillStyle = col; ctx.beginPath(); ctx.arc(q.x, q.y - 20, 2.5, 0, Math.PI * 2); ctx.fill(); }
        break;
      }
      case "plant": {
        this.box(ctx, c + 0.35, r + 0.35, 0.3, 0.3, 10, { top: "#b45309", left: "#78350f", right: "#92400e" });
        const q = this.p(c + 0.5, r + 0.5);
        const greens = ["#15803d", "#16a34a", "#22c55e"];
        [[0, -22, 7], [-7, -16, 6], [7, -17, 6], [-3, -28, 5], [4, -27, 5]].forEach(([dx, dy, rad], i) => {
          ctx.fillStyle = greens[i % 3]; ctx.beginPath(); ctx.arc(q.x + dx, q.y + dy, rad, 0, Math.PI * 2); ctx.fill();
        });
        break;
      }
      case "cabinet":
        this.box(ctx, c + 0.1, r + 0.1, 0.8, 0.8, 26, { top: "#94a3b8", left: "#475569", right: "#64748b" });
        this.onLeftFace(ctx, c + 0.1, r + 0.1, 0.8, 0.8, 26, 0, (len, h) => { ctx.fillStyle = "#1e293b"; ctx.fillRect(len / 2 - 4, h / 2 - 1, 8, 2); ctx.fillRect(len / 2 - 4, h / 2 + 7, 8, 2); });
        break;
      case "trash":
        this.box(ctx, c + 0.35, r + 0.35, 0.3, 0.3, 14, { top: "#6b7280", left: "#374151", right: "#4b5563" });
        break;
      case "lamp": {
        this.box(ctx, c + 0.45, r + 0.45, 0.1, 0.1, 40, dark);
        this.box(ctx, c + 0.3, r + 0.3, 0.4, 0.4, 10, { top: "#fde68a", left: "#d97706", right: "#f59e0b" }, 40);
        const q = this.p(c + 0.5, r + 0.5);
        const g = ctx.createRadialGradient(q.x, q.y - 40, 2, q.x, q.y - 40, 40);
        g.addColorStop(0, "#fde68a55"); g.addColorStop(1, "#fde68a00");
        ctx.fillStyle = g; ctx.fillRect(q.x - 40, q.y - 80, 80, 80);
        break;
      }
      case "beanbag": {
        const q = this.p(c + 0.5, r + 0.5);
        ctx.fillStyle = "#0e7490"; ctx.beginPath(); ctx.ellipse(q.x, q.y - 4, 18, 11, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#22d3ee"; ctx.beginPath(); ctx.ellipse(q.x, q.y - 7, 14, 7, 0, 0, Math.PI * 2); ctx.fill();
        break;
      }
      case "rug":
        break;
    }
  }

  // ---------- frame ----------
  render(agents, time) {
    this.time = time;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this.floorLayer, 0, 0);

    const items = [];
    for (const seg of this.wallSegments()) items.push({ depth: seg.c + seg.r - 0.75, kind: "wall", seg });
    for (const f of FURNITURE) {
      if (f.type === "rug") continue;
      const depth = f.walkable ? f.c + f.r - 0.5 : (f.c + f.w - 1) + (f.r + f.d - 1) + 0.5;
      items.push({ depth, kind: "furn", f });
    }
    for (const a of agents) items.push({ depth: a.x + a.y + 0.01, kind: "agent", a });
    items.sort((p, q) => p.depth - q.depth);

    for (const it of items) {
      if (it.kind === "wall") this.drawWall(ctx, it.seg);
      else if (it.kind === "furn") this.drawFurniture(ctx, it.f);
      else this.drawAgent(ctx, it.a);
    }
  }

  agentScreenPos(a) {
    return this.p(a.x + 0.5, a.y + 0.5);
  }

  drawAgent(ctx, a) {
    const q = this.agentScreenPos(a);
    // shadow
    ctx.fillStyle = "#00000055";
    ctx.beginPath(); ctx.ellipse(q.x, q.y - 1, 14, 6, 0, 0, Math.PI * 2); ctx.fill();
    // highlight ring while talking
    if (a.talking) {
      ctx.strokeStyle = a.def.color; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(q.x, q.y - 1, 17, 8, 0, 0, Math.PI * 2); ctx.stroke();
    }
    drawCharacter(ctx, a.def.look, q.x, q.y, { facing: a.facing, frame: a.frame, sitting: a.sitting });
    // name tag
    ctx.font = "7px 'Press Start 2P', monospace";
    ctx.textAlign = "center";
    const label = a.def.name.toUpperCase();
    const tw = ctx.measureText(label).width + 8;
    ctx.fillStyle = "#000000aa";
    ctx.fillRect(q.x - tw / 2, q.y + 3, tw, 11);
    ctx.fillStyle = a.def.color;
    ctx.fillText(label, q.x, q.y + 11);
  }

  // Head anchor for speech bubbles (screen coordinates, before CSS scaling)
  headPos(a) {
    const q = this.agentScreenPos(a);
    return { x: q.x, y: q.y - SPRITE_H * S + (a.sitting ? 2 * S : 0) - 6 };
  }

  // Simple hit test for clicks
  agentAt(x, y, agents) {
    let best = null;
    for (const a of agents) {
      const q = this.agentScreenPos(a);
      if (x >= q.x - 18 && x <= q.x + 18 && y >= q.y - SPRITE_H * S && y <= q.y + 14) {
        if (!best || a.x + a.y > best.x + best.y) best = a;
      }
    }
    return best;
  }
}
