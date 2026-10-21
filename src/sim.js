// Client-side mirror of the shared world: agents walk to the spots the server assigned,
// and speech bubbles follow the server's line timestamps so every viewer sees the same thing.
import { WALK_SPEED } from "./config.js";
import { AGENTS } from "../shared/roster.js";
import { findPath, SEATS, roomName } from "./world.js";

export class Agent {
  constructor(def) {
    this.def = def;
    this.id = def.id;
    const seat = SEATS.desk[def.id];
    this.x = seat.c; this.y = seat.r;
    this.facing = seat.facing;
    this.sitting = true;
    this.path = [];
    this.frame = 0;
    this.walkT = 0;
    this.target = null;
    this.targetKey = null;
    this.label = "Working at their desk";
    this.kind = "desk";
    this.talking = false;
    this.bubble = null;
    this.linesSpoken = 0;
    this.mood = "focused";
    this.initialized = false;
  }
  get c() { return Math.round(this.x); }
  get r() { return Math.round(this.y); }

  setTarget(spot, { teleport = false } = {}) {
    const k = `${spot.c},${spot.r},${spot.facing},${spot.sit ? 1 : 0}`;
    if (k === this.targetKey) return;
    this.targetKey = k;
    this.target = spot;
    if (teleport) { this.x = spot.c; this.y = spot.r; this.path = []; this.arrive(); return; }
    const path = findPath(this.c, this.r, spot.c, spot.r);
    this.sitting = false;
    if (path === null) { this.x = spot.c; this.y = spot.r; this.path = []; this.arrive(); return; }
    this.path = path;
    if (!path.length) this.arrive();
  }

  arrive() {
    const t = this.target;
    if (t) { this.x = t.c; this.y = t.r; if (t.facing) this.facing = t.facing; this.sitting = !!t.sit; }
    this.frame = 0;
  }

  update(dt) {
    if (!this.path.length) { this.frame = 0; return; }
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
    if (!this.path.length) this.arrive();
  }

  describe() {
    if (this.talking) return "Talking";
    if (this.path.length) return `Heading to the ${roomName(this.target?.c ?? this.c, this.target?.r ?? this.r)}`;
    return this.label;
  }
}

export class Sim {
  constructor() {
    this.agents = AGENTS.map((d) => new Agent(d));
    this.world = null;
    this.currentLineId = null;
    this.firstApply = true;
  }
  agent(id) { return this.agents.find((a) => a.id === id); }

  applyWorld(world) {
    this.world = world;
    for (const a of this.agents) {
      const act = world.agents?.[a.id]?.activity;
      if (!act) continue;
      a.kind = act.kind;
      a.label = act.label;
      a.setTarget({ c: act.c, r: act.r, facing: act.facing, sit: !!act.sit }, { teleport: this.firstApply });
    }
    this.firstApply = false;
  }

  /** Called every frame: moves agents and shows the line that is playing right now. */
  update(dt, serverNow) {
    for (const a of this.agents) a.update(dt);
    const scene = this.world?.scene;
    let active = null;
    if (scene && serverNow >= scene.startsAt && serverNow < scene.endsAt) {
      active = scene.lines.find((l) => serverNow >= l.at && serverNow < l.until) || null;
    }
    const activeId = active ? `${scene.id}:${active.at}` : null;
    if (activeId !== this.currentLineId) {
      this.currentLineId = activeId;
      for (const a of this.agents) { a.talking = false; a.bubble = null; }
      if (active) {
        const a = this.agent(active.speaker);
        if (a) {
          a.talking = true;
          a.bubble = { text: active.text, emotion: active.emotion };
          a.mood = active.emotion;
          a.linesSpoken++;
          if (scene.type === "chat" && !a.sitting) {
            const other = this.agents.find((o) => scene.participants.includes(o.id) && o !== a);
            if (other) a.facing = other.x > a.x ? "se" : other.y > a.y ? "sw" : other.x < a.x ? "nw" : "ne";
          }
        }
      }
    }
  }
}
