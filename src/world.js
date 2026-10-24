// Map definition: rooms, doors, furniture, seats, named spots, pathfinding.
import { COLS, ROWS } from "./config.js";

export const ROOMS = {
  office:  { name: "Workspace",    floor: "wood",       rect: [0, 7, 0, 7] },
  lounge:  { name: "Lounge",       floor: "carpetBlue", rect: [8, 12, 0, 4] },
  kitchen: { name: "Kitchen",      floor: "tile",       rect: [13, 17, 0, 4] },
  meeting: { name: "Meeting Room", floor: "carpetNavy", rect: [8, 15, 6, 12] },
  game:    { name: "Game Room",    floor: "carpetPink", rect: [0, 5, 8, 12] },
  hall:    { name: "Hallway",      floor: "checker",    rect: null },
};

// roomAt[r][c] -> room key or null (void)
export const roomAt = [];
for (let r = 0; r < ROWS; r++) {
  roomAt.push(new Array(COLS).fill(null));
}
for (const [key, room] of Object.entries(ROOMS)) {
  if (!room.rect) continue;
  const [c0, c1, r0, r1] = room.rect;
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) roomAt[r][c] = key;
}
// Hallway: a strip along r=5 (c8..17) and a vertical corridor c6..7 (r8..12)
for (let c = 8; c <= 17; c++) roomAt[5][c] = "hall";
for (let r = 8; r <= 12; r++) for (let c = 6; c <= 7; c++) roomAt[r][c] = "hall";

// Doors: pairs of adjacent tiles that may be crossed between rooms
export const DOORS = [
  [[7, 2], [8, 2]],   // office <-> lounge
  [[7, 5], [8, 5]],   // office <-> hall
  [[6, 7], [6, 8]],   // office <-> hall (south)
  [[10, 4], [10, 5]], // lounge <-> hall
  [[15, 4], [15, 5]], // kitchen <-> hall
  [[9, 5], [9, 6]],   // hall <-> meeting
  [[7, 10], [8, 10]], // hall <-> meeting (west)
  [[5, 10], [6, 10]], // game <-> hall
];
const doorSet = new Set();
for (const [a, b] of DOORS) {
  doorSet.add(`${a[0]},${a[1]}|${b[0]},${b[1]}`);
  doorSet.add(`${b[0]},${b[1]}|${a[0]},${a[1]}`);
}
export function isDoor(c1, r1, c2, r2) {
  return doorSet.has(`${c1},${r1}|${c2},${r2}`);
}

// Furniture. Each item: type, c, r, w (tiles along c), d (tiles along r), plus extras.
// "blocks" = tiles that can't be walked on (defaults to its footprint).
export const FURNITURE = [
  // --- Workspace: six desks, chairs south of each: agents sit with their backs to the viewer,
  // so every monitor faces the camera over their shoulder ---
  { type: "desk", c: 1, r: 2, w: 1, d: 1, owner: "nova" },
  { type: "desk", c: 3, r: 2, w: 1, d: 1, owner: "byte" },
  { type: "desk", c: 5, r: 2, w: 1, d: 1, owner: "pixel" },
  { type: "desk", c: 1, r: 5, w: 1, d: 1, owner: "max" },
  { type: "desk", c: 3, r: 5, w: 1, d: 1, owner: "sage" },
  { type: "desk", c: 5, r: 5, w: 1, d: 1, owner: "juno" },
  { type: "chair", c: 1, r: 3, w: 1, d: 1, facing: "ne", walkable: true },
  { type: "chair", c: 3, r: 3, w: 1, d: 1, facing: "ne", walkable: true },
  { type: "chair", c: 5, r: 3, w: 1, d: 1, facing: "ne", walkable: true },
  { type: "chair", c: 1, r: 6, w: 1, d: 1, facing: "ne", walkable: true },
  { type: "chair", c: 3, r: 6, w: 1, d: 1, facing: "ne", walkable: true },
  { type: "chair", c: 5, r: 6, w: 1, d: 1, facing: "ne", walkable: true },
  { type: "plant", c: 7, r: 0, w: 1, d: 1 },
  { type: "plant", c: 0, r: 7, w: 1, d: 1 },
  { type: "cabinet", c: 7, r: 7, w: 1, d: 1 },

  // --- Lounge ---
  { type: "couch", c: 9, r: 1, w: 2, d: 1, facing: "sw", walkable: true },
  { type: "table", c: 9, r: 2, w: 2, d: 1 },
  { type: "armchair", c: 12, r: 2, w: 1, d: 1, facing: "sw", walkable: true },
  { type: "plant", c: 8, r: 0, w: 1, d: 1 },
  { type: "lamp", c: 12, r: 0, w: 1, d: 1 },
  { type: "rug", c: 9, r: 3, w: 2, d: 1, walkable: true },

  // --- Kitchen ---
  { type: "fridge", c: 13, r: 0, w: 1, d: 1 },
  { type: "counter", c: 14, r: 0, w: 1, d: 1, coffee: true },
  { type: "counter", c: 15, r: 0, w: 1, d: 1, sink: true },
  { type: "counter", c: 16, r: 0, w: 1, d: 1 },
  { type: "vending", c: 17, r: 0, w: 1, d: 1 },
  { type: "cooler", c: 17, r: 3, w: 1, d: 1 },
  { type: "stool", c: 14, r: 3, w: 1, d: 1, facing: "se", walkable: true },
  { type: "ktable", c: 15, r: 3, w: 1, d: 1 },
  { type: "stool", c: 16, r: 3, w: 1, d: 1, facing: "nw", walkable: true },
  { type: "plant", c: 13, r: 4, w: 1, d: 1 },

  // --- Meeting room: big table, six seats that all face the viewer ---
  { type: "bigtable", c: 10, r: 8, w: 4, d: 2 },
  { type: "chair", c: 10, r: 7, w: 1, d: 1, facing: "sw", walkable: true },
  { type: "chair", c: 11, r: 7, w: 1, d: 1, facing: "sw", walkable: true },
  { type: "chair", c: 12, r: 7, w: 1, d: 1, facing: "sw", walkable: true },
  { type: "chair", c: 13, r: 7, w: 1, d: 1, facing: "sw", walkable: true },
  { type: "chair", c: 9, r: 8, w: 1, d: 1, facing: "se", walkable: true },
  { type: "chair", c: 9, r: 9, w: 1, d: 1, facing: "se", walkable: true },
  { type: "screen", c: 8, r: 6, w: 1, d: 2 },
  { type: "plant", c: 8, r: 12, w: 1, d: 1 },
  { type: "plant", c: 15, r: 12, w: 1, d: 1 },
  { type: "cabinet", c: 15, r: 6, w: 1, d: 1 },
  { type: "whiteboard", c: 14, r: 6, w: 1, d: 1 },

  // --- Game room ---
  { type: "arcade", c: 0, r: 9, w: 1, d: 1 },
  { type: "arcade", c: 0, r: 11, w: 1, d: 1, alt: true },
  { type: "pool", c: 2, r: 10, w: 2, d: 1 },
  { type: "plant", c: 5, r: 12, w: 1, d: 1 },
  { type: "trash", c: 5, r: 8, w: 1, d: 1 },
  { type: "beanbag", c: 4, r: 8, w: 1, d: 1, walkable: true },

  // --- Hall ---
  { type: "plant", c: 17, r: 5, w: 1, d: 1 },
  { type: "plant", c: 7, r: 12, w: 1, d: 1 },

  // --- unlockable upgrades: drawn only once the crew earns them, never block walking ---
  { type: "arcade", c: 0, r: 10, w: 1, d: 1, gold: true, upgrade: "arcade3", decor: true },
  { type: "plant", c: 0, r: 0, w: 1, d: 1, upgrade: "jungle", decor: true },
  { type: "plant", c: 12, r: 4, w: 1, d: 1, upgrade: "jungle", decor: true },
  { type: "plant", c: 14, r: 12, w: 1, d: 1, upgrade: "jungle", decor: true },
  { type: "plant", c: 5, r: 7, w: 1, d: 1, upgrade: "jungle", decor: true },
  { type: "plant", c: 17, r: 2, w: 1, d: 1, upgrade: "jungle", decor: true },
];

// Decorations drawn on exterior walls. side: "n" (north edge of tile) or "w" (west edge)
export const WALL_ITEMS = [
  { type: "bookshelf", c: 1, r: 0, side: "n" },
  { type: "bookshelf", c: 2, r: 0, side: "n" },
  { type: "clock", c: 4, r: 0, side: "n" },
  { type: "poster", c: 6, r: 0, side: "n", color: "#7c5cff" },
  { type: "frame", c: 0, r: 2, side: "w" },
  { type: "frame", c: 0, r: 4, side: "w", color: "#2dd4bf" },
  { type: "window", c: 0, r: 6, side: "w" },
  { type: "frame", c: 9, r: 0, side: "n", color: "#fb7185" },
  { type: "bookshelf", c: 11, r: 0, side: "n" },
  { type: "shelf", c: 16, r: 0, side: "n" },
  { type: "clock", c: 15, r: 0, side: "n" },
  { type: "poster", c: 2, r: 8, side: "n", color: "#f59e0b" },
  { type: "neon", c: 3, r: 8, side: "n" },
  { type: "frame", c: 0, r: 10, side: "w", color: "#a78bfa" },
];

// Blocked tiles from furniture footprints
const blocked = new Set();
for (const f of FURNITURE) {
  if (f.walkable || f.decor) continue;
  for (let dc = 0; dc < f.w; dc++) for (let dr = 0; dr < f.d; dr++) blocked.add(`${f.c + dc},${f.r + dr}`);
}

export function inBounds(c, r) {
  return c >= 0 && r >= 0 && c < COLS && r < ROWS;
}
export function isWalkable(c, r) {
  return inBounds(c, r) && roomAt[r][c] !== null && !blocked.has(`${c},${r}`);
}
export function canStep(c1, r1, c2, r2) {
  if (!isWalkable(c2, r2)) return false;
  const a = roomAt[r1][c1], b = roomAt[r2][c2];
  if (a === b) return true;
  return isDoor(c1, r1, c2, r2);
}

// Seats: tiles the agents can sit on, keyed by purpose
export const SEATS = {
  desk: Object.fromEntries(
    FURNITURE.filter((f) => f.type === "desk").map((f) => [f.owner, { c: f.c, r: f.r + 1, facing: "ne" }])
  ),
  meeting: [
    { c: 10, r: 7, facing: "sw" }, { c: 11, r: 7, facing: "sw" }, { c: 12, r: 7, facing: "sw" },
    { c: 13, r: 7, facing: "sw" }, { c: 9, r: 8, facing: "se" }, { c: 9, r: 9, facing: "se" },
  ],
  lounge: [{ c: 9, r: 1, facing: "sw" }, { c: 10, r: 1, facing: "sw" }, { c: 12, r: 2, facing: "sw" }],
  kitchen: [{ c: 14, r: 3, facing: "se" }, { c: 16, r: 3, facing: "nw" }],
  beanbag: [{ c: 4, r: 8, facing: "sw" }],
};

// Standing spots (not seats)
export const SPOTS = {
  coffee: [{ c: 14, r: 1, facing: "ne" }, { c: 15, r: 1, facing: "ne" }],
  arcade: [{ c: 1, r: 9, facing: "nw" }, { c: 1, r: 11, facing: "nw" }],
  pool: [{ c: 2, r: 11, facing: "ne" }, { c: 3, r: 9, facing: "sw" }, { c: 4, r: 10, facing: "nw" }],
  whiteboard: [{ c: 14, r: 7, facing: "ne" }],
  screen: [{ c: 9, r: 7, facing: "nw" }],
};

// Places where two agents can have a one-on-one (two spots, facing each other-ish)
export const CHAT_SPOTS = [
  { name: "the coffee machine", spots: [{ c: 14, r: 1, facing: "se" }, { c: 15, r: 1, facing: "nw" }] },
  { name: "the lounge couch", spots: [{ c: 9, r: 1, facing: "sw", sit: true }, { c: 10, r: 1, facing: "sw", sit: true }] },
  { name: "the air hockey table", spots: [{ c: 2, r: 11, facing: "ne" }, { c: 3, r: 9, facing: "sw" }] },
  { name: "the hallway", spots: [{ c: 11, r: 5, facing: "se" }, { c: 12, r: 5, facing: "nw" }] },
  { name: "the arcade", spots: [{ c: 1, r: 9, facing: "nw" }, { c: 1, r: 10, facing: "ne" }] },
  { name: "the kitchen table", spots: [{ c: 14, r: 3, facing: "se", sit: true }, { c: 16, r: 3, facing: "nw", sit: true }] },
  { name: "the whiteboard", spots: [{ c: 14, r: 7, facing: "se" }, { c: 15, r: 7, facing: "nw" }] },
  { name: "the workspace", spots: [{ c: 2, r: 4, facing: "se" }, { c: 3, r: 4, facing: "nw" }] },
];

export function randomWalkable(exclude = new Set()) {
  for (let i = 0; i < 200; i++) {
    const c = Math.floor(Math.random() * COLS), r = Math.floor(Math.random() * ROWS);
    if (isWalkable(c, r) && !exclude.has(`${c},${r}`)) return { c, r };
  }
  return { c: 8, r: 5 };
}

// Breadth-first search on the tile grid. Returns array of {c,r} excluding start, or null.
export function findPath(sc, sr, tc, tr) {
  if (sc === tc && sr === tr) return [];
  if (!isWalkable(tc, tr)) return null;
  const key = (c, r) => c + r * COLS;
  const prev = new Map();
  const queue = [[sc, sr]];
  prev.set(key(sc, sr), null);
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  while (queue.length) {
    const [c, r] = queue.shift();
    if (c === tc && r === tr) {
      const path = [];
      let k = key(c, r);
      while (prev.get(k) !== null) {
        path.push({ c: k % COLS, r: Math.floor(k / COLS) });
        k = prev.get(k);
      }
      return path.reverse();
    }
    for (const [dc, dr] of dirs) {
      const nc = c + dc, nr = r + dr;
      const nk = key(nc, nr);
      if (prev.has(nk)) continue;
      if (!canStep(c, r, nc, nr)) continue;
      prev.set(nk, key(c, r));
      queue.push([nc, nr]);
    }
  }
  return null;
}

export function roomName(c, r) {
  const k = inBounds(c, r) ? roomAt[r][c] : null;
  return k ? ROOMS[k].name : "somewhere";
}
