// 3D isometric renderer for the Cookers house (three.js). Models are Kenney CC0 packs (Furniture
// Kit, Mini Arcade, Mini Characters); the layout, seats and paths still come from world.js, so the
// server and every viewer agree on where things are. One tile = one world unit: tile (c, r) covers
// x in [c, c+1], z in [r, r+1]. The camera looks from the south-east, like the old 2D view.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { COLS, ROWS } from "./config.js";
import { ROOMS, roomAt, FURNITURE, WALL_ITEMS, isDoor } from "./world.js";
import { drawScreen, SCREEN_W, SCREEN_H } from "./screens.js";
import { icon } from "../shared/icons.js";
import { Effects } from "./effects3d.js";
import { drawBillboard, BOARD_W, BOARD_H } from "./billboard.js";

const ASSETS = "/assets/kenney/";
const CHARACTERS = { nova: "female-e", byte: "male-a", pixel: "female-b", max: "male-d", sage: "male-e", juno: "female-c" };
const YAW = { sw: 0, se: Math.PI / 2, ne: Math.PI, nw: -Math.PI / 2 };
const WALL_H = 1.55, WALL_T = 0.12, PART_H = 0.38, CHAR_SCALE = 1.25, TABLE_Y = 0.52, DESK_Y = 0.5;
// office chairs (and whoever sits on them) are drawn pulled up towards the desk to their north
const DESK_PULL = -0.18;
// camera framings: the whole island, the workspace (every monitor readable), each room
const roomBox = (key, pad = 1.08) => {
  const [c0, c1, r0, r1] = ROOMS[key].rect;
  return { x0: c0, x1: c1 + 1, z0: r0, z1: r1 + 1, y0: 0, y1: 1.2, pad };
};
const VIEWS = {
  house: { label: "House", icon: "house", x0: -1.3, x1: COLS + 1.7, z0: -1.3, z1: ROWS + 2.0, y0: -0.9, y1: WALL_H + 0.6, pad: 1.04 },
  desks: { label: "Workspace", icon: "monitor", x0: 0, x1: 8, z0: 0.6, z1: 7.6, y0: 0, y1: 1.3, pad: 1.02 },
  lounge: { label: "Lounge", icon: "sofa", ...roomBox("lounge") },
  kitchen: { label: "Kitchen", icon: "pot", ...roomBox("kitchen") },
  meeting: { label: "Meeting", icon: "users", ...roomBox("meeting", 1.04) },
  game: { label: "Game Room", icon: "gamepad", ...roomBox("game") },
};
// the rentable billboard in the garden's front-east corner, facing the camera
const BILLBOARD = { x: 18.0, z: 13.2, yaw: Math.PI / 4, w: 3.5, h: 1.75, y: 0.9 };
const SCREEN_RES = 2, FOCUS_RES = 5; // desk screens render at 2x the logical size, 5x when the camera is on them
const ISO_DIR = new THREE.Vector3(1, 1.05, 1).normalize(); // the isometric camera looks along -ISO_DIR
// the Mini Characters "sit" clip sits on the ground: lift them to the seat of what they sit on
const SEAT_Y = { chair: 0.3, couch: 0.26, armchair: 0.24, stool: 0.42, beanbag: 0.12 };
// a few models face -z out of the box; this turns them so "sw" means "front towards +z (the viewer)"
const BASE_ROT = {};

const FLOOR_STYLE = {
  wood: { kind: "planks", base: "#b98454", dark: "#8f5e36" },
  carpetBlue: { kind: "carpet", base: "#4b6fb5", dark: "#3d5c99" },
  tile: { kind: "tiles", base: "#f2efe8", dark: "#d9d3c7" },
  carpetNavy: { kind: "carpet", base: "#2f3b6b", dark: "#27315a" },
  carpetPink: { kind: "carpet", base: "#a8558f", dark: "#8e4579" },
  checker: { kind: "checker", base: "#e8e3da", dark: "#c9c1b3" },
};
const WALL_TONE = { office: "#efe3cf", lounge: "#d3e3f5", kitchen: "#d6efe2", meeting: "#ddd7f5", game: "#ecd5f0", hall: "#e8e2d6" };
// the house stands on a grass island; its edges in world units
const ISLAND = { x0: -1.3, z0: -1.3, x1: COLS + 1.7, z1: ROWS + 2.0 };
const NATURE = ["tree_oak", "tree_default", "tree_fat", "tree_detailed", "tree_pineRoundC", "tree_pineTallA_detailed", "plant_bushLarge", "plant_bush", "plant_bushDetailed",
  "flower_redA", "flower_yellowB", "flower_purpleA", "grass_large", "grass", "rock_smallA", "rock_smallFlatB", "mushroom_redGroup", "path_stone"];
// garden: [model, x, z, scale, turn]; the empty corner east of the meeting room is a small terrace
const GARDEN = [
  ["tree_oak", 0.6, 14.3, 2.6, 0.4], ["tree_fat", 19.4, 10.4, 2.0, 1.2], ["tree_default", 19.2, 2.0, 2.3, 2.0], ["tree_pineTallA_detailed", -0.5, -0.4, 2.6, 0],
  ["tree_detailed", 17.2, 9.6, 2.2, 0.8], ["tree_pineRoundC", 18.9, 6.4, 2.2, 0], ["plant_bushLarge", 16.6, 6.6, 1.9, 0.3], ["plant_bushDetailed", 16.6, 12.7, 1.6, 1.1],
  ["plant_bush", 3.2, 14.2, 1.8, 0], ["plant_bushLarge", 10.6, 14.5, 1.8, 2.2], ["plant_bush", 15.7, 14.3, 1.7, 0.6], ["plant_bushDetailed", 19.2, 4.6, 1.7, 0],
  ["flower_redA", 4.6, 14.0, 2.0, 0], ["flower_yellowB", 9.2, 14.2, 2.0, 0.5], ["flower_purpleA", 12.4, 14.1, 2.0, 1], ["flower_redA", 16.9, 8.1, 2.0, 0],
  ["flower_yellowB", 19.0, 9.2, 2.0, 0], ["flower_purpleA", 17.0, 11.0, 2.0, 2], ["flower_yellowB", 1.8, 14.6, 2.0, 1.4], ["flower_purpleA", 18.9, 0.6, 2.0, 0.3],
  ["grass_large", 13.8, 14.6, 2.2, 0], ["grass_large", 18.4, 11.2, 2.2, 1], ["grass", 5.6, 14.6, 2.2, 0], ["grass", 19.3, 7.8, 2.2, 0.4], ["grass_large", 2.3, 14.1, 2.0, 0.7],
  ["rock_smallA", 8.3, 14.6, 2.0, 0.2], ["rock_smallFlatB", 16.4, 14.4, 2.2, 0.9], ["mushroom_redGroup", 0.2, 13.4, 2.0, 0.5], ["flower_redA", 19.3, 14.4, 1.8, 2.1],
];
// a stone path from the hallway's south end off the island
const PATH = [[6.6, 13.3], [7.3, 13.75], [6.7, 14.2], [7.3, 14.65]];

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.upgrades = new Set();
    this.logoImage = null;
    this.ready = false;
    this.lastTime = 0;
    this.models = {};
    this.agentViews = new Map();
    this.v = new THREE.Vector3();

    this.gl = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.toneMappingExposure = 1.05;
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = THREE.PCFSoftShadowMap;
    this.gl.setClearColor(0x000000, 0);

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-10, 10, 6, -6, 0.1, 200);
    this.target = new THREE.Vector3(COLS / 2, 0, ROWS / 2);
    this.camera.position.copy(this.target).add(new THREE.Vector3(1, 1.05, 1).normalize().multiplyScalar(60));
    this.camera.lookAt(this.target);
    this.lights();

    this.screens = [];
    try { const v = localStorage.getItem("cookers.view"); this.view = VIEWS[v] ? v : "house"; } catch { this.view = "house"; }
    this.buildViewToggle();

    this.overlay = document.createElement("div");
    this.overlay.className = "scene-loading";
    this.overlay.textContent = "Setting up the kitchen…";
    canvas.parentElement.appendChild(this.overlay);

    this.resize();
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    this.load().catch((err) => { console.error(err); this.overlay.textContent = "Could not load the 3D kitchen."; });
  }

  // ---------- setup ----------
  lights() {
    this.scene.add(new THREE.HemisphereLight(0xfff4e6, 0x3a3358, 1.35));
    const sun = new THREE.DirectionalLight(0xfff0dc, 2.1);
    sun.position.set(COLS / 2 - 6, 16, ROWS / 2 + 9);
    sun.target.position.copy(this.target);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const s = sun.shadow.camera;
    s.left = -15; s.right = 15; s.top = 15; s.bottom = -15; s.near = 1; s.far = 50;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    sun.shadow.radius = 3;
    this.scene.add(sun, sun.target);
  }

  resize() {
    const host = this.canvas.parentElement;
    const cs = getComputedStyle(host);
    const w = Math.max(320, host.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight));
    const h = Math.max(220, host.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom));
    this.gl.setSize(w, h, true);
    this.fitCamera(w / h);
  }

  /** Fit the whole house (floor to wall tops) into the view with a small margin. */
  // ---------- camera: a pose is where it stands, what it looks at, and the frustum ----------
  /** The isometric pose that fits a view's box (the whole island, or the workspace). */
  isoPose(view) {
    const b = VIEWS[view] || VIEWS.house;
    const look = this.target.clone(), pos = look.clone().addScaledVector(ISO_DIR, 60);
    const cam = (this.tmpCam ||= new THREE.OrthographicCamera());
    cam.position.copy(pos); cam.lookAt(look); cam.updateMatrixWorld();
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const x of [b.x0, b.x1]) for (const y of [b.y0, b.y1]) for (const z of [b.z0, b.z1]) {
      const p = this.v.set(x, y, z).applyMatrix4(cam.matrixWorldInverse);
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    let w = (maxX - minX) * b.pad, h = (maxY - minY) * (b.pad + 0.02);
    if (w / h > this.aspect) h = w / this.aspect; else w = h * this.aspect;
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    return { pos, look, near: 0.1, left: cx - w / 2, right: cx + w / 2, top: cy + h / 2, bottom: cy - h / 2 };
  }

  /** Straight in front of a desk monitor, slightly above, the screen filling the view. */
  focusPose(owner) {
    const s = this.screens.find((x) => x.owner === owner);
    if (!s) return null;
    const look = s.mesh.getWorldPosition(new THREE.Vector3());
    const pos = look.clone().add(new THREE.Vector3(0, 0.18, 1).normalize().multiplyScalar(6));
    const hh = Math.max(0.33, 0.43 / this.aspect), hw = hh * this.aspect;
    // near plane just in front of the screen: desks between the camera and this monitor aren't drawn
    return { pos, look, near: 5.55, left: -hw, right: hw, top: hh, bottom: -hh };
  }

  goalPose() { return (this.focus && this.focusPose(this.focus)) || this.isoPose(this.view); }

  /** Re-aim at the current goal; instant on resize, eased in render() otherwise. */
  fitCamera(aspect, { instant = true } = {}) {
    this.aspect = aspect;
    if (instant) this.centerViewButton(false);
    this.camGoal = this.goalPose();
    if (instant || !this.camPose) { this.camPose = { ...this.camGoal, pos: this.camGoal.pos.clone(), look: this.camGoal.look.clone() }; this.applyPose(); }
  }

  applyPose() {
    const p = this.camPose, c = this.camera;
    c.position.copy(p.pos); c.lookAt(p.look);
    Object.assign(c, { left: p.left, right: p.right, top: p.top, bottom: p.bottom, near: p.near });
    c.updateProjectionMatrix(); c.updateMatrixWorld();
  }

  setView(view, { auto = false } = {}) {
    if (!VIEWS[view]) return;
    if (this.focus) this.unfocus({ refit: false });
    this.view = view;
    if (!auto) {
      this.autoBack = null; // the viewer picked a room: stay there, even when the gathering ends
      try { localStorage.setItem("cookers.view", view); } catch { /* private mode */ }
    }
    for (const b of this.viewButtons || []) b.classList.toggle("active", b.dataset.view === view);
    this.centerViewButton(true);
    this.fitCamera(this.aspect, { instant: false });
  }

  /** Fly the camera to a desk monitor and read it on the monitor itself. */
  focusMonitor(owner) {
    const s = this.screens.find((x) => x.owner === owner);
    if (!s) return;
    if (this.focus && this.focus !== owner) this.setScreenRes(this.screens.find((x) => x.owner === this.focus), SCREEN_RES);
    this.focus = owner;
    this.setScreenRes(s, FOCUS_RES);
    this.focusBar.hidden = false; this.viewBar.hidden = true;
    this.focusBar.querySelector("span").textContent = `${owner[0].toUpperCase()}${owner.slice(1)}'s monitor`;
    document.body.classList.add("monitor-focus");
    this.fitCamera(this.aspect, { instant: false });
  }

  unfocus({ refit = true } = {}) {
    if (!this.focus) return;
    this.setScreenRes(this.screens.find((x) => x.owner === this.focus), SCREEN_RES);
    this.focus = null;
    this.focusBar.hidden = true; this.viewBar.hidden = false;
    document.body.classList.remove("monitor-focus");
    if (refit) this.fitCamera(this.aspect, { instant: false });
  }

  /** Swap a screen's canvas resolution (sharper when the camera is right on it). */
  setScreenRes(s, res) {
    if (!s || s.res === res) return;
    s.res = res;
    s.ctx.canvas.width = SCREEN_W * res; s.ctx.canvas.height = SCREEN_H * res;
    const old = s.tex;
    s.tex = new THREE.CanvasTexture(s.ctx.canvas);
    s.tex.colorSpace = THREE.SRGBColorSpace;
    s.tex.anisotropy = 4;
    s.mesh.material.map = s.tex; s.mesh.material.needsUpdate = true;
    old.dispose();
    s.drawnAt = -1;
  }

  /** One button per room over the scene, and the Back bar shown while a monitor is in focus. */
  buildViewToggle() {
    const bar = document.createElement("div");
    bar.className = "view-toggle";
    bar.innerHTML = Object.entries(VIEWS).map(([key, v]) => `<button data-view="${key}" title="${v.label}">${icon(v.icon)}<span class="lbl">${v.label}</span></button>`).join("");
    this.canvas.parentElement.appendChild(bar);
    this.viewBar = bar;
    this.viewButtons = [...bar.querySelectorAll("button")];
    for (const b of this.viewButtons) {
      b.classList.toggle("active", b.dataset.view === this.view);
      b.addEventListener("click", () => this.setView(b.dataset.view));
    }
    requestAnimationFrame(() => this.centerViewButton(false));
    const back = document.createElement("div");
    back.className = "view-toggle focus-bar";
    back.hidden = true;
    back.innerHTML = `<button class="active">${icon("back")} Back</button><span></span>`;
    back.querySelector("button").addEventListener("click", () => this.unfocus());
    this.canvas.parentElement.appendChild(back);
    this.focusBar = back;
  }

  /**
   * All six cookers in one room (a meeting, the trading desk, a break): the camera goes there by
   * itself and returns to the previous view when they spread out. The workspace doesn't count:
   * everyone is there whenever they are simply working at their desks.
   */
  followGathering(agents, t) {
    if (this.focus || agents.length < 2) return;
    const rooms = new Set(agents.map((a) => roomAt[a.r]?.[a.c] ?? null));
    const room = rooms.size === 1 ? [...rooms][0] : null;
    const target = room && room !== "office" && VIEWS[room] ? room : null;
    if (target !== this.gathering) { this.gathering = target; this.gatheredAt = t; return; }
    if (t - this.gatheredAt < 1.2) return; // passing through a doorway is not a gathering
    if (target && this.followedAt !== this.gatheredAt) {
      this.followedAt = this.gatheredAt;
      if (this.view !== target) { const back = this.view; this.setView(target, { auto: true }); this.autoBack = back; }
    } else if (!target && this.autoBack) {
      const back = this.autoBack;
      this.autoBack = null;
      this.setView(back, { auto: true });
    }
  }

  /** On narrow screens the room bar scrolls sideways: keep the active room in the middle of it. */
  centerViewButton(smooth) {
    const bar = this.viewBar, b = bar?.querySelector(".active");
    if (bar && !bar.hidden) { bar.classList.remove("compact"); bar.classList.toggle("compact", bar.scrollWidth > bar.clientWidth + 1); }
    if (!b || bar.scrollWidth <= bar.clientWidth) return;
    bar.scrollTo({ left: b.offsetLeft - (bar.clientWidth - b.offsetWidth) / 2, behavior: smooth ? "smooth" : "auto" });
  }

  /** Ease the camera pose towards the goal (view switch, monitor focus). */
  easeCamera(dt) {
    const g = this.camGoal, p = this.camPose;
    if (!g || !p) return;
    const diff = p.pos.distanceTo(g.pos) + p.look.distanceTo(g.look) + Math.abs(p.near - g.near) + Math.abs(p.left - g.left) + Math.abs(p.top - g.top) + Math.abs(p.right - g.right) + Math.abs(p.bottom - g.bottom);
    if (diff < 1e-4) return;
    const k = 1 - Math.exp(-dt * 5);
    p.pos.lerp(g.pos, k); p.look.lerp(g.look, k);
    for (const key of ["left", "right", "top", "bottom", "near"]) p[key] += (g[key] - p[key]) * k;
    this.applyPose();
  }

  async load() {
    const loader = new GLTFLoader();
    const furniture = new Set(["desk", "chairDesk", "chairModernCushion", "computerScreen", "computerKeyboard", "pottedPlant", "plantSmall1", "plantSmall2", "plantSmall3",
      "bookcaseClosedDoors", "books", "loungeSofa", "tableCoffee", "loungeChair", "lampRoundFloor", "rugRectangle", "kitchenFridge", "kitchenCabinet",
      "kitchenSink", "kitchenCabinetDrawer", "kitchenCabinetUpper", "kitchenCoffeeMachine", "kitchenFridgeSmall", "stoolBar", "tableRound", "trashcan", "loungeChairRelax",
      "lampSquareTable", "radio", "cardboardBoxClosed", "laptop", "kitchenMicrowave", "toaster"]);
    const jobs = [];
    for (const n of furniture) jobs.push(loader.loadAsync(`${ASSETS}furniture/${n}.glb`).then((g) => { this.models[n] = g.scene; }));
    for (const n of ["arcade-machine", "pinball", "air-hockey", "vending-machine"]) jobs.push(loader.loadAsync(`${ASSETS}arcade/${n}.glb`).then((g) => { this.models[n] = g.scene; }));
    for (const n of NATURE) jobs.push(loader.loadAsync(`${ASSETS}nature/${n}.glb`).then((g) => { this.models[n] = g.scene; }));
    const chars = {};
    for (const [id, file] of Object.entries(CHARACTERS)) jobs.push(loader.loadAsync(`${ASSETS}characters/character-${file}.glb`).then((g) => { chars[id] = g; }));
    await Promise.all(jobs);
    await document.fonts?.ready; // neon signs and the meeting screen are drawn with the page font
    this.chars = chars;
    this.buildGarden();
    this.buildBillboard();
    this.buildHouse();
    this.buildFurniture();
    this.ready = true;
    this.overlay.remove();
  }

  // ---------- the garden island ----------
  buildGarden() {
    const g = new THREE.Group();
    const { x0, z0, x1, z1 } = ISLAND;
    const depth = 0.7, rad = 1.1;
    // rounded rectangle in the XZ plane (shape y = -z, see the rotation below)
    const s = new THREE.Shape();
    s.moveTo(x0 + rad, -z0);
    s.lineTo(x1 - rad, -z0); s.quadraticCurveTo(x1, -z0, x1, -z0 - rad);
    s.lineTo(x1, -z1 + rad); s.quadraticCurveTo(x1, -z1, x1 - rad, -z1);
    s.lineTo(x0 + rad, -z1); s.quadraticCurveTo(x0, -z1, x0, -z1 + rad);
    s.lineTo(x0, -z0 - rad); s.quadraticCurveTo(x0, -z0, x0 + rad, -z0);
    const geo = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.08, bevelSegments: 2, curveSegments: 10 });
    geo.rotateX(-Math.PI / 2);
    const grass = grassTexture();
    grass.repeat.set(0.25, 0.25);
    const island = new THREE.Mesh(geo, [new THREE.MeshStandardMaterial({ map: grass, roughness: 0.95 }), new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 1 })]);
    island.position.y = -0.32 - depth - 0.06;
    island.receiveShadow = true;
    g.add(island);
    this.scene.add(g);
    this.furniture ||= new THREE.Group();
    const garden = this.furniture;
    for (const [name, x, z, scale, turn] of GARDEN) {
      const h = this.place(name, { c: x - 0.5, r: z - 0.5 }, { scale, y: -0.32 });
      if (h) h.rotation.y = turn;
    }
    for (const [x, z] of PATH) this.place("path_stone", { c: x - 0.5, r: z - 0.5 }, { scale: 1.1, y: -0.32, shadow: false });
    this.gardenGroup = garden;
    this.furniture = null;
    this.scene.add(garden);
    // warm room lights: lounge lamp, game room glow, kitchen and office fill
    for (const [color, x, y, z, power, dist] of [[0xffc27a, 12.5, 1.3, 0.8, 2.2, 4.5], [0xff5fc8, 2.6, 1.2, 10.2, 2.0, 5], [0xd9f3ff, 15.3, 1.4, 2.0, 1.2, 4.5], [0xffd9a0, 3.5, 1.5, 3.5, 1.4, 6]]) {
      const l = new THREE.PointLight(color, power, dist, 2);
      l.position.set(x, y, z);
      this.scene.add(l);
    }
  }

  // ---------- the house ----------
  buildHouse() {
    const house = new THREE.Group();
    // base slab under every floor tile, so the house reads as a diorama
    const slabMat = new THREE.MeshStandardMaterial({ color: 0x2a2f52, roughness: 0.9 });
    const slab = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.32, 1), slabMat, COLS * ROWS);
    let n = 0;
    const m = new THREE.Matrix4();
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      if (!roomAt[r][c]) continue;
      slab.setMatrixAt(n++, m.makeTranslation(c + 0.5, -0.16 - 0.001, r + 0.5));
    }
    slab.count = n;
    slab.receiveShadow = true;
    house.add(slab);

    // floors: one textured plane per room (the hallway goes tile by tile)
    const floorMats = {};
    const floorMat = (room) => (floorMats[room] ||= new THREE.MeshStandardMaterial({ map: floorTexture(FLOOR_STYLE[ROOMS[room].floor]), roughness: 0.85 }));
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const room = roomAt[r][c];
      if (!room) continue;
      const geo = new THREE.PlaneGeometry(1, 1);
      // world-anchored UVs so planks and tiles run continuously across a room
      const uv = geo.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, (c + uv.getX(i)) / 2, (ROWS - r - 1 + uv.getY(i)) / 2);
      const tile = new THREE.Mesh(geo, floorMat(room));
      tile.rotation.x = -Math.PI / 2;
      tile.position.set(c + 0.5, 0, r + 0.5);
      tile.receiveShadow = true;
      house.add(tile);
    }

    // walls: tall back walls on the north and west edges, low partitions between rooms (gaps at doors)
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const room = roomAt[r][c];
      if (!room) continue;
      if (r === 0 || !roomAt[r - 1][c]) house.add(backWall(c, r, "n", WALL_TONE[room]));
      if (c === 0 || !roomAt[r][c - 1]) house.add(backWall(c, r, "w", WALL_TONE[room]));
      const east = c + 1 < COLS ? roomAt[r][c + 1] : null, south = r + 1 < ROWS ? roomAt[r + 1][c] : null;
      if (east && east !== room && !isDoor(c, r, c + 1, r)) house.add(partition(c + 1, r, "x"));
      if (south && south !== room && !isDoor(c, r, c, r + 1)) house.add(partition(c, r + 1, "z"));
    }
    this.scene.add(house);
  }

  // ---------- furniture ----------
  /** Put a model on tiles: centered on the footprint (plus offsets), resting on y. */
  place(name, f, o = {}) {
    const src = this.models[name];
    if (!src) return null;
    const obj = src.clone(true);
    const s = o.scale ?? 1;
    obj.scale.set(o.sx ?? s, o.sy ?? s, o.sz ?? s);
    obj.rotation.y = YAW[o.facing || f.facing || "sw"] + (BASE_ROT[name] || 0);
    const holder = new THREE.Group();
    holder.add(obj);
    const box = new THREE.Box3().setFromObject(holder);
    const center = box.getCenter(new THREE.Vector3());
    obj.position.set(-center.x, -box.min.y, -center.z);
    holder.position.set(f.c + (f.w || 1) / 2 + (o.dx || 0), o.y || 0, f.r + (f.d || 1) / 2 + (o.dz || 0));
    obj.traverse((mesh) => {
      if (!mesh.isMesh) return;
      mesh.castShadow = o.shadow !== false;
      mesh.receiveShadow = true;
      crispPalette(mesh.material);
      if (o.tint) { mesh.material = mesh.material.clone(); mesh.material.color.multiply(new THREE.Color(o.tint)); if (o.shiny) { mesh.material.metalness = 0.55; mesh.material.roughness = 0.3; } }
    });
    this.furniture.add(holder);
    return holder;
  }

  buildFurniture() {
    if (this.focus) this.unfocus({ refit: false });
    this.furniture?.removeFromParent();
    this.furniture = new THREE.Group();
    this.screens = [];
    const up = this.upgrades;
    for (const f of FURNITURE) {
      if (f.upgrade && !up.has(f.upgrade)) continue;
      this.buildItem(f, up);
    }
    for (const item of WALL_ITEMS) this.buildWallItem(item, up);
    if (up.has("neon")) this.furniture.add(neonSign("COOKERS", 5.0, 1.12, 0.03, "n", "#ff4fd8", "#5ef2ff"));
    this.scene.add(this.furniture);
    this.builtUpgrades = [...up].sort().join(",");
  }

  buildItem(f, up) {
    const hash = (f.c * 7 + f.r * 13) % 3;
    switch (f.type) {
      case "desk":
        // the chair is on the tile south of the desk: the agent sits with their back to the viewer,
        // so the monitor faces the camera over their shoulder
        this.place("desk", f, { facing: "sw", scale: 1.3, dz: 0.3 });
        this.furniture.add(this.monitor(f));
        this.place("computerKeyboard", f, { facing: "sw", y: DESK_Y, dz: 0.45, scale: 1.1 });
        if (hash === 0) this.place("plantSmall2", f, { y: DESK_Y, dx: 0.38, dz: 0.28 });
        else if (hash === 1) this.place("lampSquareTable", f, { y: DESK_Y, dx: 0.38, dz: 0.26, scale: 0.9 });
        else this.place("books", f, { y: DESK_Y, dx: -0.38, dz: 0.28, scale: 0.9 });
        return;
      case "chair":
        if (roomAt[f.r][f.c] === "office") this.place("chairDesk", f, { scale: 1.25, dz: DESK_PULL });
        else this.place("chairModernCushion", f, { scale: 1.35 });
        return;
      case "plant":
        this.place(["pottedPlant", "plantSmall1", "plantSmall3"][hash], f, { scale: hash === 0 ? 1.45 : 2.2 });
        return;
      case "cabinet":
        this.place("bookcaseClosedDoors", f, { scale: 1.25 });
        if (f.c === 7 && f.r === 7 && up.has("trophy")) this.furniture.add(trophy(f.c + 0.5, 1.12, f.r + 0.5));
        else this.place("radio", f, { y: 1.1, scale: 1.2 });
        return;
      case "couch":
        this.place("loungeSofa", f, { scale: 1.5, tint: up.has("goldcouch") ? "#ffd35a" : null, shiny: up.has("goldcouch") });
        return;
      case "table": this.place("tableCoffee", f, { scale: 1.6 }); this.place("laptop", f, { y: 0.37, scale: 1.2, facing: "ne" }); return;
      case "armchair": this.place("loungeChair", f, { scale: 1.35 }); return;
      case "lamp": this.place("lampRoundFloor", f, { scale: 1.5 }); return;
      case "rug": this.place("rugRectangle", f, { sx: 1.25, sy: 1, sz: 1.0, shadow: false }); return;
      case "fridge": this.place("kitchenFridge", f, { scale: 1.45 }); return;
      case "counter":
        this.place(f.sink ? "kitchenSink" : f.coffee ? "kitchenCabinet" : "kitchenCabinetDrawer", f, { scale: 1.6 });
        if (f.coffee) this.place("kitchenCoffeeMachine", f, { y: 0.72, scale: 1.5, dz: -0.05 });
        else if (!f.sink) this.place("kitchenMicrowave", f, { y: 0.72, scale: 1.3, dz: -0.05 });
        this.place("kitchenCabinetUpper", f, { y: 1.02, scale: 1.6, dz: -0.18 });
        return;
      case "vending": this.place("vending-machine", f, { scale: 1.45 }); return;
      case "cooler": this.place("kitchenFridgeSmall", f, { scale: 1.5, facing: "nw" }); return;
      case "stool": this.place("stoolBar", f, { scale: 1.3 }); return;
      case "ktable": this.place("tableRound", f, { scale: 1.25 }); this.place("toaster", f, { y: 0.43, scale: 1.1 }); return;
      case "bigtable":
        this.furniture.add(meetingTable(f));
        if (up.has("tradingwall")) for (let i = 0; i < 3; i++) this.place("computerScreen", { c: f.c + 0.45 + i * 1.05, r: f.r, w: 1, d: 1 }, { facing: "ne", y: TABLE_Y, scale: 1.25, dz: 0.1 });
        this.place("laptop", { c: f.c + 1, r: f.r + 1, w: 2, d: 1 }, { y: TABLE_Y, scale: 1.3, facing: "ne", dz: -0.2 });
        this.place("laptop", { c: f.c, r: f.r, w: 1, d: 2 }, { y: TABLE_Y, scale: 1.2, facing: "nw", dx: -0.1 });
        return;
      case "screen": this.furniture.add(bigScreen(f, this)); return;
      case "whiteboard": this.furniture.add(whiteboard(f)); return;
      case "arcade":
        if (f.alt) this.place("pinball", f, { facing: "se", scale: 1.25 });
        else this.place("arcade-machine", f, { facing: "se", scale: 1.35, tint: f.gold ? "#ffd35a" : null, shiny: f.gold });
        return;
      case "pool": this.place("air-hockey", f, { facing: "se", scale: 1.6 }); return;
      case "trash": this.place("trashcan", f, { scale: 1.6 }); return;
      case "beanbag": this.place("loungeChairRelax", f, { scale: 1.3, tint: "#ff9ec7" }); return;
      default:
        this.place("cardboardBoxClosed", f, { scale: 1.4 });
    }
  }

  buildWallItem(item, up) {
    const g = new THREE.Group();
    // north items hang on the wall at z=0 and face +z; west items at x=0 and face +x
    const at = (u, y) => (item.side === "n" ? g.position.set(item.c + 0.5 + u, y, 0.02) : g.position.set(0.02, y, item.r + 0.5 + u));
    if (item.side === "w") g.rotation.y = Math.PI / 2;
    // items on the low partitions (game room) float above it like a sign
    const interior = item.side === "n" && item.r > 0;
    if (interior) { if (item.type === "neon") this.furniture.add(neonSign("GAME ON", item.c + 0.5, 0.95, item.r + 0.02, "n", "#ff4fd8", "#a855f7", 0.9)); return; }
    switch (item.type) {
      case "bookshelf":
        // two floating wall shelves with books
        for (const [y, dx] of [[0, -0.15], [0.32, 0.12]]) {
          g.add(box(0.8, 0.04, 0.2, "#8f5e36", 0, y, 0.1));
          const b = this.models.books?.clone(true);
          if (b) { b.scale.setScalar(1.25); b.position.set(dx - 0.12, y + 0.04, 0.02); b.traverse((m) => m.isMesh && crispPalette(m.material)); g.add(b); }
        }
        at(0, 0.82);
        break;
      case "shelf": g.add(box(0.9, 0.05, 0.22, "#8f5e36", 0, 0, 0.11)); { const b = this.models.books?.clone(true); if (b) { b.scale.setScalar(1.2); b.position.set(-0.2, 0.03, 0.02); g.add(b); } } at(0, 1.0); break;
      case "clock": g.add(clockFace()); at(0, 1.18); break;
      case "poster": case "frame": g.add(framedArt(item.color || "#7c5cff", item.type === "poster")); at(0, item.type === "poster" ? 0.95 : 0.98); break;
      case "window": g.add(windowPane()); at(0, 0.92); break;
      case "neon": break;
      default: return;
    }
    g.traverse((m) => { if (m.isMesh) { m.castShadow = false; m.receiveShadow = true; } });
    this.furniture.add(g);
  }

  // ---------- desk monitors ----------
  /** A big monitor on the north half of the desk, its screen facing the chair (and the camera). */
  monitor(f) {
    const g = new THREE.Group();
    const dark = new THREE.MeshStandardMaterial({ color: 0x1c1f2e, roughness: 0.5, metalness: 0.3 });
    g.add(box(0.2, 0.015, 0.13, null, 0, 0, 0, dark));
    g.add(box(0.045, 0.14, 0.035, null, 0, 0.01, -0.02, dark));
    g.add(box(0.68, 0.43, 0.035, null, 0, 0.13, 0, dark));
    const cv = document.createElement("canvas");
    cv.width = SCREEN_W * SCREEN_RES; cv.height = SCREEN_H * SCREEN_RES;
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.64, 0.4), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
    screen.position.set(0, 0.13 + 0.215, 0.019);
    g.add(screen);
    g.position.set(f.c + 0.5, DESK_Y, f.r + 0.62);
    g.scale.setScalar(1.25); // a touch bigger than life so the screens read from the camera
    g.traverse((m) => { if (m.isMesh && m !== screen) { m.castShadow = true; m.receiveShadow = true; } });
    const seat = { c: f.c, r: f.r + 1 };
    screen.userData.owner = f.owner;
    this.screens.push({ owner: f.owner, seat, mesh: screen, ctx: cv.getContext("2d"), tex, res: SCREEN_RES, drawnAt: -1, active: null });
    return g;
  }

  /** Redraw desk screens twice a second: the owner's real work when they sit there, a screensaver otherwise. */
  updateScreens(agents, t) {
    const byId = Object.fromEntries(agents.map((a) => [a.id, a]));
    for (const s of this.screens) {
      const a = byId[s.owner];
      const active = !!a && a.sitting && !a.path.length && a.c === s.seat.c && a.r === s.seat.r;
      const focused = this.focus === s.owner;
      if (active === s.active && t - s.drawnAt < (focused ? 0.25 : 0.5)) continue;
      s.active = active; s.drawnAt = t;
      s.ctx.setTransform(s.res, 0, 0, s.res, 0, 0);
      // in focus the screen always shows the work, even if its owner just stepped away
      drawScreen(s.owner, s.ctx, t, this.world, { active: active || focused });
      s.tex.needsUpdate = true;
    }
  }

  /** The desk monitor under a canvas point (canvas pixels), if any: its owner's id. */
  monitorAt(x, y) {
    if (!this.screens.length) return null;
    this.raycaster ||= new THREE.Raycaster();
    const ndc = new THREE.Vector2((x / this.canvas.width) * 2 - 1, -(y / this.canvas.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.intersectObjects(this.screens.map((s) => s.mesh), false)[0];
    return hit?.object.userData.owner || null;
  }

  // ---------- agents ----------
  agentView(a) {
    let v = this.agentViews.get(a.id);
    if (v || !this.chars?.[a.id]) return v;
    const gltf = this.chars[a.id];
    const root = new THREE.Group();
    const model = gltf.scene;
    model.scale.setScalar(CHAR_SCALE);
    model.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; crispPalette(m.material); } });
    root.add(model);
    const color = new THREE.Color(a.def.color);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.38, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, toneMapped: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.015;
    const glow = new THREE.Mesh(new THREE.CircleGeometry(0.3, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.18, toneMapped: false }));
    glow.rotation.x = -Math.PI / 2; glow.position.y = 0.012;
    root.add(ring, glow);
    const mixer = new THREE.AnimationMixer(model);
    const clip = (name) => gltf.animations.find((c) => c.name === name);
    const actions = {};
    // "drive" is a seated pose with both hands forward: at a desk it reads as typing
    for (const [key, name] of Object.entries({ idle: "idle", walk: "walk", sit: "sit", type: "drive", talk: "emote-yes", gesture: "interact-right", jump: "jump", hold: "holding-right" })) {
      const c = clip(name);
      if (c) actions[key] = mixer.clipAction(c);
    }
    v = { root, model, mixer, actions, current: null, ring, glow, yaw: YAW[a.facing] ?? 0, gestureAt: 0 };
    this.scene.add(root);
    this.agentViews.set(a.id, v);
    return v;
  }

  play(v, key) {
    if (v.current === key || !v.actions[key]) return;
    const next = v.actions[key];
    next.reset().setEffectiveWeight(1).fadeIn(0.25).play();
    if (v.current) v.actions[v.current].fadeOut(0.25);
    v.current = key;
  }

  /** Seated at their own desk: drawn pulled up to it, like the chair. */
  pull(a) { return a.sitting && !a.path.length && this.atOwnDesk(a) ? DESK_PULL : 0; }

  atOwnDesk(a) {
    const s = this.screens.find((x) => x.owner === a.id);
    return !!s && a.c === s.seat.c && a.r === s.seat.r;
  }

  seatHeight(a) {
    if (!a.sitting) return 0;
    const f = FURNITURE.find((x) => x.walkable && a.c >= x.c && a.c < x.c + x.w && a.r >= x.r && a.r < x.r + x.d);
    return SEAT_Y[f?.type] ?? 0.2;
  }

  updateAgent(a, dt, t) {
    const v = this.agentView(a);
    if (!v) return;
    const y = this.seatHeight(a);
    v.root.position.set(a.x + 0.5, 0, a.y + 0.5 + this.pull(a));
    v.root.visible = this.focus !== a.id;
    v.model.position.y = y;
    // turn smoothly towards the facing the simulation wants
    const want = YAW[a.facing] ?? 0;
    let d = want - v.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    v.yaw += d * Math.min(1, dt * 10);
    v.model.rotation.y = v.yaw;

    const walking = a.path.length > 0;
    const hop = this.effects3d?.hopFor(a.id, this.serverNow || Date.now());
    const fxAnim = hop != null ? "jump" : this.showAnim(a, walking, t);
    if (hop != null) v.model.position.y = y + Math.sin(hop * Math.PI) * 0.55;
    if (walking) { this.play(v, "walk"); v.actions.walk.timeScale = 1.35; }
    else if (fxAnim) this.play(v, fxAnim);
    else if (a.sitting) this.play(v, this.atOwnDesk(a) && v.actions.type ? "type" : "sit");
    else if (a.talking) {
      // talking while standing: nod, with an occasional hand gesture
      if (t > v.gestureAt) { v.gestureAt = t + 2.2 + Math.random() * 2; this.play(v, Math.random() < 0.4 ? "gesture" : "talk"); }
    } else this.play(v, "idle");
    if (!a.talking) v.gestureAt = 0;
    v.mixer.update(dt);

    const pulse = a.talking ? 1 + Math.sin(t * 8) * 0.08 : 1;
    v.ring.scale.setScalar(pulse);
    v.glow.material.opacity = a.talking ? 0.35 : 0.16;
  }

  /** Paid interactions change how the people in them move: dancing at the disco, a cup in hand at the coffee round. */
  showAnim(a, walking, t) {
    const sc = this.world?.scene, now = this.serverNow || Date.now();
    if (walking || !sc || sc.type !== "show" || !sc.participants.includes(a.id) || now < sc.startsAt - 10_000 || now > sc.endsAt) return null;
    if (sc.show === "disco") return Math.floor(t * 1.2 + a.id.charCodeAt(0)) % 3 === 0 ? "jump" : "talk";
    if (sc.show === "coffee" && !a.sitting && !a.talking) return "hold";
    return null;
  }

  // ---------- garden billboard ----------
  buildBillboard() {
    const b = BILLBOARD, g = new THREE.Group();
    const dark = new THREE.MeshStandardMaterial({ color: 0x23214a, roughness: 0.6, metalness: 0.2 });
    const trim = new THREE.MeshStandardMaterial({ color: 0xffcf5c, roughness: 0.4, metalness: 0.3 });
    for (const dx of [-b.w * 0.32, b.w * 0.32]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, b.y + 0.4, 0.12), dark);
      post.position.set(dx, (b.y + 0.4) / 2 - 0.32, -0.08); post.castShadow = true; g.add(post);
    }
    const back = new THREE.Mesh(new THREE.BoxGeometry(b.w + 0.16, b.h + 0.16, 0.1), dark);
    back.position.set(0, b.y + b.h / 2, -0.05); back.castShadow = true; g.add(back);
    for (const [w, h, x, y] of [[b.w + 0.2, 0.05, 0, b.y + b.h + 0.08], [b.w + 0.2, 0.05, 0, b.y - 0.08], [0.05, b.h + 0.2, -b.w / 2 - 0.08, b.y + b.h / 2], [0.05, b.h + 0.2, b.w / 2 + 0.08, b.y + b.h / 2]]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.12), trim); m.position.set(x, y, 0); g.add(m);
    }
    const cv = document.createElement("canvas"); cv.width = BOARD_W; cv.height = BOARD_H;
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    const face = new THREE.Mesh(new THREE.PlaneGeometry(b.w, b.h), new THREE.MeshBasicMaterial({ map: tex }));
    face.position.set(0, b.y + b.h / 2, 0.005);
    g.add(face);
    // two little lamps on top
    for (const dx of [-b.w * 0.3, b.w * 0.3]) {
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.06, 0.16), dark); lamp.position.set(dx, b.y + b.h + 0.16, 0.12); g.add(lamp);
    }
    g.position.set(b.x, 0, b.z); g.rotation.y = b.yaw;
    this.scene.add(g);
    this.board = { face, tex, ctx: cv.getContext("2d"), key: null };
    this.drawBoard();
  }

  /** Show an ad (or the rent offer when ad is null). */
  setBillboard(ad, price) {
    if (!this.board) { this.pendingAd = [ad, price]; return; }
    const key = ad ? `${ad.id}` : `empty:${price}`;
    if (key === this.board.key) return;
    this.board.key = key; this.board.ad = ad; this.board.price = price;
    this.drawBoard();
  }

  drawBoard() {
    const bd = this.board;
    if (!bd) return;
    if (this.pendingAd) { [bd.ad, bd.price] = this.pendingAd; this.pendingAd = null; }
    drawBillboard(bd.ctx, bd.ad || null, { price: bd.price, onImage: () => this.drawBoard() });
    bd.tex.needsUpdate = true;
  }

  billboardAt(x, y) {
    if (!this.board) return false;
    this.raycaster ||= new THREE.Raycaster();
    const ndc = new THREE.Vector2((x / this.canvas.width) * 2 - 1, -(y / this.canvas.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    return this.raycaster.intersectObject(this.board.face, false).length > 0;
  }

  // ---------- per frame ----------
  render(agents, time) {
    const t = time / 1000;
    const dt = this.lastTime ? Math.min(0.1, t - this.lastTime) : 0;
    this.lastTime = t;
    if (this.ready) {
      const key = [...this.upgrades].sort().join(",");
      if (key !== this.builtUpgrades) this.buildFurniture();
      if (this.logoImage !== this.shownLogo) this.updateScreen();
      for (const a of agents) this.updateAgent(a, dt, t);
      this.followGathering(agents, t);
      this.effects3d ||= new Effects(this.scene);
      const now = this.serverNow || Date.now();
      this.effects3d.sync(this.world?.effects, now);
      this.effects3d.update(t, now, (id) => this.agentViews.get(id)?.root.position);
      this.updateScreens(agents, t);
      this.animateDecor(t);
      this.easeCamera(dt);
    }
    this.gl.render(this.scene, this.camera);
  }

  animateDecor(t) {
    this.scene.traverse((o) => { if (o.userData.flicker) o.material.opacity = 0.85 + Math.sin(t * 9 + o.userData.flicker) * 0.06 + (Math.random() < 0.01 ? -0.3 : 0); });
  }

  updateScreen() {
    this.shownLogo = this.logoImage;
    const mat = this.screenMat;
    if (!mat) return;
    if (this.logoImage) {
      const tex = new THREE.Texture(this.logoImage);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.needsUpdate = true;
      mat.map = tex;
    } else mat.map = this.idleScreen;
    mat.needsUpdate = true;
  }

  // ---------- screen-space helpers used by the UI ----------
  project(x, y, z) {
    const p = this.v.set(x, y, z).project(this.camera);
    return { x: ((p.x + 1) / 2) * this.canvas.width, y: ((1 - p.y) / 2) * this.canvas.height };
  }

  headPos(a) {
    const y = (a.sitting ? this.seatHeight(a) - 0.12 : 0) + 0.95;
    return this.project(a.x + 0.5, y, a.y + 0.5 + this.pull(a));
  }

  agentAt(x, y, agents) {
    let best = null, bestD = Infinity;
    for (const a of agents) {
      const head = this.headPos(a), feet = this.project(a.x + 0.5, 0, a.y + 0.5 + this.pull(a));
      const mid = { x: (head.x + feet.x) / 2, y: (head.y + feet.y) / 2 };
      const radius = Math.abs(feet.y - head.y) * 0.6;
      const d = Math.hypot(x - mid.x, y - mid.y);
      if (d < radius && d < bestD) { best = a; bestD = d; }
    }
    return best;
  }
}

// ---------- building blocks ----------
function box(w, h, d, color, x = 0, y = 0, z = 0, mat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat || new THREE.MeshStandardMaterial({ color, roughness: 0.8 }));
  m.position.set(x, y + h / 2, z);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

/** A tall back wall on the north (side "n") or west ("w") edge of tile (c, r): wainscot, wall, trim. */
function backWall(c, r, side, tone) {
  const g = new THREE.Group();
  const base = new THREE.Color(tone);
  const lower = base.clone().multiplyScalar(0.78);
  const len = 1 + WALL_T; // overlap a little so corners close
  g.add(box(len, 0.5, WALL_T, lower, 0, 0, 0));
  g.add(box(len, WALL_H - 0.5, WALL_T, base, 0, 0.5, 0));
  g.add(box(len, 0.05, WALL_T + 0.03, "#fdfaf3", 0, 0.5, 0.01));
  g.add(box(len, 0.08, WALL_T + 0.04, "#3b3f6b", 0, WALL_H, 0));
  if (side === "n") g.position.set(c + 0.5 - WALL_T / 2, 0, -WALL_T / 2);
  else { g.rotation.y = Math.PI / 2; g.position.set(-WALL_T / 2, 0, r + 0.5 - WALL_T / 2); }
  g.traverse((m) => { if (m.isMesh) m.castShadow = false; });
  return g;
}

/** Low partition between rooms, on the west edge of tile (c, r) for axis "x", the north edge for "z". */
function partition(c, r, axis) {
  const g = new THREE.Group();
  g.add(box(1.02, PART_H, 0.1, "#f3efe7"));
  g.add(box(1.04, 0.05, 0.14, "#3b3f6b", 0, PART_H, 0));
  if (axis === "x") { g.rotation.y = Math.PI / 2; g.position.set(c, 0, r + 0.5); }
  else g.position.set(c + 0.5, 0, r);
  return g;
}

function canvasTexture(w, h, draw) {
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  draw(cv.getContext("2d"), w, h);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Floor textures: one texture covers 2x2 tiles (UVs are world-anchored, see buildHouse). */
function floorTexture(style) {
  const tex = canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = style.base; ctx.fillRect(0, 0, w, h);
    if (style.kind === "planks") {
      const rows = 8;
      for (let i = 0; i < rows; i++) {
        const y = (i * h) / rows, off = (i % 2) * 64 + (i % 3) * 21;
        ctx.fillStyle = shade(style.base, (Math.sin(i * 12.9) * 0.5 + 0.5) * 0.14 - 0.07);
        ctx.fillRect(0, y, w, h / rows);
        ctx.fillStyle = style.dark;
        ctx.fillRect(0, y, w, 2);
        for (let x = off; x < w; x += 128) ctx.fillRect(x, y, 2, h / rows);
        ctx.globalAlpha = 0.08; ctx.fillStyle = "#000";
        for (let k = 0; k < 6; k++) ctx.fillRect((k * 47 + i * 31) % w, y + 6 + (k % 3) * 5, 30, 1);
        ctx.globalAlpha = 1;
      }
    } else if (style.kind === "carpet") {
      for (let i = 0; i < 2600; i++) { ctx.fillStyle = Math.random() < 0.5 ? style.dark : shade(style.base, 0.06); ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
    } else if (style.kind === "tiles") {
      const n = 4, s = w / n;
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { ctx.fillStyle = (i + j) % 2 ? style.base : shade(style.base, -0.04); ctx.fillRect(i * s, j * s, s, s); }
      ctx.strokeStyle = style.dark; ctx.lineWidth = 3;
      for (let i = 0; i <= n; i++) { ctx.beginPath(); ctx.moveTo(i * s, 0); ctx.lineTo(i * s, h); ctx.moveTo(0, i * s); ctx.lineTo(w, i * s); ctx.stroke(); }
    } else if (style.kind === "checker") {
      const n = 4, s = w / n;
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { ctx.fillStyle = (i + j) % 2 ? style.base : style.dark; ctx.fillRect(i * s, j * s, s, s); }
    }
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** Kenney models color from a small palette texture: sample it crisply so colors don't bleed. */
function crispPalette(material) {
  for (const m of Array.isArray(material) ? material : [material]) {
    const map = m?.map;
    if (!map || map.userData.crisp) continue;
    map.magFilter = THREE.NearestFilter;
    map.minFilter = THREE.NearestFilter;
    map.generateMipmaps = false;
    map.userData.crisp = true;
    map.needsUpdate = true;
  }
}

function grassTexture() {
  const tex = canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = "#5f9e4a"; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 3500; i++) {
      ctx.fillStyle = ["#6fb257", "#548f41", "#7bbf62", "#4c8239"][i % 4];
      ctx.fillRect(Math.random() * w, Math.random() * h, 2, 3);
    }
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function shade(hex, amt) {
  const c = new THREE.Color(hex);
  return amt >= 0 ? `#${c.lerp(new THREE.Color("#ffffff"), amt).getHexString()}` : `#${c.lerp(new THREE.Color("#000000"), -amt).getHexString()}`;
}

/** Glowing neon text on a wall (side "n") with a soft colored light. */
function neonSign(text, x, y, z, side, color, glow, size = 1.4) {
  const tex = canvasTexture(512, 128, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.font = "bold 78px 'Lilita One', Impact, sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.shadowColor = glow; ctx.shadowBlur = 24;
    ctx.fillStyle = color; ctx.fillText(text, w / 2, h / 2 + 4);
    ctx.shadowBlur = 8; ctx.fillStyle = "#ffffff"; ctx.globalAlpha = 0.6; ctx.fillText(text, w / 2, h / 2 + 4);
  });
  const g = new THREE.Group();
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(size * 2, size / 2), new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false }));
  sign.userData.flicker = Math.random() * 10;
  g.add(sign);
  const light = new THREE.PointLight(new THREE.Color(color), 1.4, 4, 2);
  light.position.set(0, 0, 0.4);
  g.add(light);
  g.position.set(x, y, z);
  return g;
}

/** Meeting table: dark wood top with a lighter inlay on two chrome legs, sized to the footprint. */
function meetingTable(f) {
  const g = new THREE.Group();
  const w = f.w - 0.2, d = f.d - 0.35;
  const wood = new THREE.MeshStandardMaterial({ color: 0x6b4428, roughness: 0.55 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xc9ced8, metalness: 0.8, roughness: 0.3 });
  g.add(box(w, 0.06, d, null, 0, TABLE_Y - 0.06, 0, wood));
  g.add(box(w - 0.3, 0.005, d - 0.3, "#8a5a36", 0, TABLE_Y, 0));
  for (const x of [-w / 2 + 0.45, w / 2 - 0.45]) {
    g.add(box(0.12, TABLE_Y - 0.06, 0.12, null, x, 0, 0, chrome));
    g.add(box(0.12, 0.03, d - 0.4, null, x, 0, 0, chrome));
  }
  g.position.set(f.c + f.w / 2, 0, f.r + f.d / 2);
  return g;
}

/** Gold cup for the trophy upgrade. */
function trophy(x, y, z) {
  const gold = new THREE.MeshStandardMaterial({ color: 0xffc83d, metalness: 0.8, roughness: 0.25, emissive: 0x3a2600 });
  const pts = [[0, 0], [0.09, 0], [0.09, 0.03], [0.03, 0.05], [0.025, 0.12], [0.1, 0.17], [0.12, 0.3], [0.11, 0.3], [0.09, 0.19], [0, 0.17]].map(([a, b]) => new THREE.Vector2(a, b));
  const cup = new THREE.Mesh(new THREE.LatheGeometry(pts, 24), gold);
  cup.position.set(x, y, z);
  cup.castShadow = true;
  return cup;
}

/** Meeting room screen: shows the coin logo, or a Cookers idle screen. */
function bigScreen(f, renderer) {
  const g = new THREE.Group();
  const len = (f.d || 1) * 0.95;
  renderer.idleScreen = canvasTexture(512, 288, (ctx, w, h) => {
    const grd = ctx.createLinearGradient(0, 0, w, h); grd.addColorStop(0, "#1b1f4a"); grd.addColorStop(1, "#4c1d95");
    ctx.fillStyle = grd; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#ffd166"; ctx.font = "bold 44px 'Lilita One', Impact, sans-serif"; ctx.textAlign = "center"; ctx.fillText("COOKERS", w / 2, h / 2);
    ctx.fillStyle = "#a5b4fc"; ctx.font = "20px sans-serif"; ctx.fillText("next coin cooking…", w / 2, h / 2 + 44);
  });
  renderer.screenMat = new THREE.MeshBasicMaterial({ map: renderer.idleScreen, toneMapped: false });
  g.add(box(0.1, 0.95, len + 0.08, "#15172b", 0, 0.62, 0));
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.86), renderer.screenMat);
  panel.rotation.y = Math.PI / 2; panel.position.set(0.056, 0.62 + 0.475, 0);
  g.add(panel);
  g.add(box(0.06, 0.62, 0.06, "#2b2d42", 0, 0, -len / 3), box(0.06, 0.62, 0.06, "#2b2d42", 0, 0, len / 3));
  g.add(box(0.35, 0.03, len * 0.8, "#2b2d42", 0, 0, 0));
  const light = new THREE.PointLight(0x8b7bff, 1.2, 3.5, 2); light.position.set(0.6, 1.1, 0); g.add(light);
  g.position.set(f.c + 0.2, 0, f.r + (f.d || 1) / 2);
  return g;
}

function whiteboard(f) {
  const g = new THREE.Group();
  const tex = canvasTexture(384, 256, (ctx, w, h) => {
    ctx.fillStyle = "#fbfbf8"; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "#2563eb"; ctx.lineWidth = 5; ctx.beginPath();
    [[20, 200], [80, 170], [130, 185], [190, 120], [250, 140], [320, 60], [360, 40]].forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
    ctx.fillStyle = "#16a34a"; ctx.font = "bold 34px sans-serif"; ctx.fillText("$NEXT ↑", 30, 60);
    ctx.fillStyle = "#dc2626"; ctx.font = "22px sans-serif"; ctx.fillText("trend? meme? photo!", 30, 110);
  });
  g.add(box(1.0, 0.68, 0.05, "#d1d5db", 0, 0.62, 0));
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.94, 0.62), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.4 }));
  face.position.set(0, 0.62 + 0.34, 0.03);
  g.add(face);
  g.add(box(0.05, 0.62, 0.05, "#6b7280", -0.4, 0, 0), box(0.05, 0.62, 0.05, "#6b7280", 0.4, 0, 0));
  g.position.set(f.c + 0.5, 0, f.r + 0.25);
  return g;
}

function clockFace() {
  const g = new THREE.Group();
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.04, 32), new THREE.MeshStandardMaterial({ color: 0x2b2d42 }));
  rim.rotation.x = Math.PI / 2; rim.position.z = 0.02;
  const face = new THREE.Mesh(new THREE.CircleGeometry(0.145, 32), new THREE.MeshStandardMaterial({ color: 0xfdfbf5 }));
  face.position.z = 0.042;
  const hand1 = box(0.018, 0.1, 0.01, "#111", 0, 0, 0.05); hand1.rotation.z = 0.6;
  const hand2 = box(0.014, 0.12, 0.01, "#d62828", 0, 0, 0.052); hand2.rotation.z = -1.9;
  g.add(rim, face, hand1, hand2);
  return g;
}

function framedArt(color, poster) {
  const g = new THREE.Group();
  const w = poster ? 0.5 : 0.42, h = poster ? 0.66 : 0.34;
  g.add(box(w + 0.06, h + 0.06, 0.03, poster ? "#1f2937" : "#8f5e36", 0, -(h + 0.06) / 2, 0.015));
  const tex = canvasTexture(128, 160, (ctx, cw, ch) => {
    const grd = ctx.createLinearGradient(0, 0, cw, ch); grd.addColorStop(0, color); grd.addColorStop(1, shade(color, -0.45));
    ctx.fillStyle = grd; ctx.fillRect(0, 0, cw, ch);
    ctx.fillStyle = "#ffffffcc"; ctx.beginPath(); ctx.arc(cw / 2, ch * 0.42, cw * 0.26, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = shade(color, -0.3); ctx.font = "bold 40px sans-serif"; ctx.textAlign = "center"; ctx.fillText(poster ? "◎" : "$", cw / 2, ch * 0.42 + 14);
    if (poster) { ctx.fillStyle = "#fff"; ctx.font = "bold 16px sans-serif"; ctx.fillText("COOK IT", cw / 2, ch * 0.85); }
  });
  const art = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }));
  art.position.z = 0.032;
  g.add(art);
  return g;
}

function windowPane() {
  const g = new THREE.Group();
  const sky = canvasTexture(128, 128, (ctx, w, h) => {
    const grd = ctx.createLinearGradient(0, 0, 0, h); grd.addColorStop(0, "#7dd3fc"); grd.addColorStop(1, "#fde68a");
    ctx.fillStyle = grd; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#ffffffaa"; ctx.beginPath(); ctx.ellipse(40, 40, 26, 10, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#64748b"; for (let i = 0; i < 6; i++) ctx.fillRect(i * 22, 90 - (i % 3) * 14, 18, 60);
  });
  g.add(box(0.74, 0.62, 0.04, "#f8fafc", 0, -0.31, 0.02));
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.64, 0.52), new THREE.MeshBasicMaterial({ map: sky, toneMapped: false }));
  glass.position.z = 0.045;
  g.add(glass, box(0.03, 0.52, 0.02, "#f8fafc", 0, -0.26, 0.05), box(0.64, 0.03, 0.02, "#f8fafc", 0, -0.015, 0.05));
  return g;
}
