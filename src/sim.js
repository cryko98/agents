// The living office: agents wander, work, chill and gather for dialogue scenes.
import { WALK_SPEED, SCENE_GAP_MIN, SCENE_GAP_MAX, MEETING_EVERY, LINE_MIN_MS, LINE_MAX_MS, LINE_MS_PER_CHAR } from "./config.js";
import { AGENTS } from "../shared/roster.js";
import { findPath, isWalkable, randomWalkable, SEATS, SPOTS, CHAT_SPOTS, roomName } from "./world.js";

const rand = (a, b) => a + Math.random() * (b - a);
const choice = (arr) => arr[Math.floor(Math.random() * arr.length)];
const key = (c, r) => `${c},${r}`;

const ACTIVITY_LABELS = {
  desk: "Working at their desk",
  lounge: "Chilling on the couch",
  kitchen: "Snacking in the kitchen",
  coffee: "Making coffee",
  arcade: "Playing arcade",
  pool: "Shooting pool",
  beanbag: "Sunk into the beanbag",
  whiteboard: "Scribbling on the whiteboard",
  screen: "Staring at the big screen",
  wander: "Wandering around",
};

export class Agent {
  constructor(def, index) {
    this.def = def;
    this.id = def.id;
    this.index = index;
    const seat = SEATS.desk[def.id];
    this.x = seat.c; this.y = seat.r;
    this.facing = seat.facing;
    this.sitting = true;
    this.path = [];
    this.frame = 0;
    this.walkT = 0;
    this.state = "busy";            // idle | moving | busy | scene
    this.activityKind = "desk";
    this.activityLabel = ACTIVITY_LABELS.desk;
    this.until = performance.now() + rand(4000, 15000);
    this.target = null;             // { c, r, facing, sit }
    this.spotKey = key(seat.c, seat.r);
    this.arrived = true;
    this.talking = false;
    this.bubble = null;             // { text, emotion, until }
    this.linesSpoken = 0;
    this.mood = "focused";
  }
  get c() { return Math.round(this.x); }
  get r() { return Math.round(this.y); }

  goTo(target, onArrive) {
    const path = findPath(this.c, this.r, target.c, target.r);
    this.target = target;
    this.onArrive = onArrive;
    this.arrived = false;
    this.sitting = false;
    if (path === null) { this.path = []; this.x = target.c; this.y = target.r; this.finishArrival(); return; }
    this.path = path;
    this.state = "moving";
    if (!path.length) this.finishArrival();
  }

  finishArrival() {
    const t = this.target;
    if (t) { this.x = t.c; this.y = t.r; if (t.facing) this.facing = t.facing; this.sitting = !!t.sit; }
    this.arrived = true;
    this.path = [];
    this.frame = 0;
    const cb = this.onArrive; this.onArrive = null;
    if (cb) cb(this);
  }

  update(dt) {
    if (this.path.length) {
      const next = this.path[0];
      const dx = next.c - this.x, dy = next.r - this.y;
      const dist = Math.hypot(dx, dy);
      const step = WALK_SPEED * dt;
      if (Math.abs(dx) > Math.abs(dy)) this.facing = dx > 0 ? "se" : "nw";
      else if (Math.abs(dy) > 0.001) this.facing = dy > 0 ? "sw" : "ne";
      if (dist <= step) { this.x = next.c; this.y = next.r; this.path.shift(); }
      else { this.x += (dx / dist) * step; this.y += (dy / dist) * step; }
      this.walkT += dt * 7;
      this.frame = 1 + (Math.floor(this.walkT) % 2);
      if (!this.path.length) this.finishArrival();
    } else {
      this.frame = 0;
    }
  }

  describe() {
    if (this.state === "scene") return this.talking ? "Talking" : "In a conversation";
    if (this.state === "moving") return `Heading to the ${roomName(this.target?.c ?? this.c, this.target?.r ?? this.r)}`;
    return this.activityLabel;
  }
}

export class Sim {
  constructor(hooks = {}) {
    this.hooks = hooks;
    this.agents = AGENTS.map((def, i) => new Agent(def, i));
    this.reserved = new Map();
    for (const a of this.agents) this.reserved.set(a.spotKey, a.id);
    this.scene = null;
    this.sceneCount = 0;
    this.nextSceneAt = performance.now() + rand(9000, 16000);
    this.tipBoost = false;
  }

  agent(id) { return this.agents.find((a) => a.id === id); }

  // ---- reservations ----
  reserve(a, c, r) { this.release(a); a.spotKey = key(c, r); this.reserved.set(a.spotKey, a.id); }
  release(a) { if (a.spotKey && this.reserved.get(a.spotKey) === a.id) this.reserved.delete(a.spotKey); a.spotKey = null; }
  isFree(c, r, a) { const who = this.reserved.get(key(c, r)); return !who || who === a.id; }

  // ---- everyday life ----
  pickActivity(a, now) {
    const favs = a.def.favorites;
    const kinds = ["desk", "lounge", "kitchen", "coffee", "arcade", "pool", "beanbag", "whiteboard", "screen", "wander"];
    const kind = Math.random() < 0.55 ? choice(favs) : choice(kinds);
    let spot = null, sit = false;
    const free = (list) => list.filter((s) => this.isFree(s.c, s.r, a) && isWalkable(s.c, s.r));
    switch (kind) {
      case "desk": spot = SEATS.desk[a.id]; sit = true; break;
      case "lounge": spot = choice(free(SEATS.lounge) || []); sit = true; break;
      case "kitchen": spot = choice(free(SEATS.kitchen) || []); sit = true; break;
      case "beanbag": spot = choice(free(SEATS.beanbag) || []); sit = true; break;
      case "coffee": spot = choice(free(SPOTS.coffee) || []); break;
      case "arcade": spot = choice(free(SPOTS.arcade) || []); break;
      case "pool": spot = choice(free(SPOTS.pool) || []); break;
      case "whiteboard": spot = choice(free(SPOTS.whiteboard) || []); break;
      case "screen": spot = choice(free(SPOTS.screen) || []); break;
      default: { const w = randomWalkable(new Set(this.reserved.keys())); spot = { c: w.c, r: w.r, facing: choice(["se", "sw"]) }; }
    }
    if (!spot) { const w = randomWalkable(new Set(this.reserved.keys())); spot = { c: w.c, r: w.r, facing: "sw" }; }
    this.reserve(a, spot.c, spot.r);
    a.activityKind = kind;
    a.activityLabel = ACTIVITY_LABELS[kind] || "Hanging out";
    const duration = kind === "wander" ? rand(2000, 6000) : rand(14000, 45000);
    a.goTo({ ...spot, sit }, () => {
      a.state = "busy";
      a.until = performance.now() + duration;
    });
    this.hooks.onActivity?.(a);
  }

  // ---- scenes ----
  startScene(now) {
    this.sceneCount++;
    const wantMeeting = this.sceneCount % MEETING_EVERY === 0 || this.tipBoost;
    this.tipBoost = false;
    if (wantMeeting) {
      const participants = this.agents.slice();
      const spots = SEATS.meeting;
      this.scene = { type: "meeting", participants, location: "the big table in the meeting room", title: "Team meeting", phase: "gathering", gatherUntil: now + 26000, lines: null, lineIdx: 0, lineUntil: 0, startedAt: now };
      participants.forEach((a, i) => this.sendToScene(a, { ...spots[i], sit: true }));
    } else {
      const [a, b] = this.agents.slice().sort(() => Math.random() - 0.5).slice(0, 2);
      const options = CHAT_SPOTS.filter((cs) => cs.spots.every((s) => { const who = this.reserved.get(key(s.c, s.r)); return !who || who === a.id || who === b.id; }));
      const place = choice(options.length ? options : CHAT_SPOTS);
      this.scene = { type: "chat", participants: [a, b], location: place.name, title: `${a.def.name} & ${b.def.name} at ${place.name}`, phase: "gathering", gatherUntil: now + 22000, lines: null, lineIdx: 0, lineUntil: 0, startedAt: now };
      this.sendToScene(a, place.spots[0]);
      this.sendToScene(b, place.spots[1]);
    }
    this.hooks.onSceneStart?.(this.scene);
  }

  sendToScene(a, spot) {
    this.release(a);
    this.reserve(a, spot.c, spot.r);
    a.state = "scene";
    a.activityLabel = "In a conversation";
    a.goTo({ c: spot.c, r: spot.r, facing: spot.facing, sit: !!spot.sit }, () => { a.state = "scene"; });
  }

  async runScript(now) {
    const s = this.scene;
    s.phase = "requesting";
    try {
      const script = await this.hooks.requestScript(s);
      if (this.scene !== s) return;
      s.lines = script?.lines || [];
      s.source = script?.source;
      s.planUpdate = script?.planUpdate || null;
    } catch (err) {
      console.warn("script failed", err);
      s.lines = [];
    }
    if (!s.lines.length) { this.endScene(performance.now()); return; }
    s.phase = "talking";
    s.lineIdx = -1;
    this.nextLine(performance.now());
  }

  nextLine(now) {
    const s = this.scene;
    const prev = s.lines[s.lineIdx];
    if (prev) { const pa = this.agent(prev.speaker); if (pa) { pa.talking = false; pa.bubble = null; } }
    s.lineIdx++;
    if (s.lineIdx >= s.lines.length) { this.endScene(now); return; }
    const line = s.lines[s.lineIdx];
    const a = this.agent(line.speaker);
    const dur = Math.max(LINE_MIN_MS, Math.min(LINE_MAX_MS, 1400 + line.text.length * LINE_MS_PER_CHAR));
    s.lineUntil = now + dur;
    if (a) {
      a.talking = true;
      a.bubble = { text: line.text, emotion: line.emotion, until: s.lineUntil };
      a.linesSpoken++;
      a.mood = line.emotion;
      // face the other participant(s) loosely: look toward the viewer side
      if (s.type === "chat") {
        const other = s.participants.find((p) => p !== a);
        if (other && !a.sitting) a.facing = other.x > a.x ? "se" : other.y > a.y ? "sw" : other.x < a.x ? "nw" : "ne";
      }
    }
    this.hooks.onLine?.(line, a, s);
  }

  endScene(now) {
    const s = this.scene;
    if (!s) return;
    for (const a of s.participants) { a.talking = false; a.bubble = null; a.state = "idle"; a.until = now + rand(1500, 6000); }
    this.scene = null;
    this.hooks.onSceneEnd?.(s);
    this.nextSceneAt = now + rand(SCENE_GAP_MIN, SCENE_GAP_MAX);
  }

  /** Called when a holder drops a tip: bring the next scene forward. */
  nudge() {
    const now = performance.now();
    this.nextSceneAt = Math.min(this.nextSceneAt, now + 4000);
  }

  update(dt, now) {
    for (const a of this.agents) {
      a.update(dt);
      if (a.bubble && now > a.bubble.until) a.bubble = null;
      if (a.state === "busy" && now >= a.until) { a.state = "idle"; }
      if (a.state === "idle" && !a.path.length) {
        if (now >= (a.until || 0)) this.pickActivity(a, now);
      }
    }
    const s = this.scene;
    if (!s && now >= this.nextSceneAt) this.startScene(now);
    if (s) {
      if (s.phase === "gathering") {
        const all = s.participants.every((a) => a.arrived && !a.path.length);
        if (all || now >= s.gatherUntil) {
          for (const a of s.participants) if (!a.arrived) { a.path = []; a.finishArrival(); }
          this.runScript(now);
        }
      } else if (s.phase === "talking" && now >= s.lineUntil) {
        this.nextLine(now);
      }
    }
  }
}
