// What paid interactions do to the house: disco lights in the game room, pizza boxes and confetti on
// the meeting table, a little fire for a roast, a spotlight for a rap battle, a whoopee-cushion puff.
// The server lists them in world.effects (start/end in server time); this builds and animates them.
import * as THREE from "three";
import { ROOMS } from "./world.js";

const TABLE = { x: 12, z: 9, y: 0.52 }; // the meeting table's top
const roomCenter = (room) => { const [c0, c1, r0, r1] = ROOMS[room].rect; return { x: (c0 + c1 + 1) / 2, z: (r0 + r1 + 1) / 2 }; };
const DISCO = [0xff3cac, 0x2bd2ff, 0xffe600, 0x7cff6b];

function textSprite(text, color = "#fff") {
  const c = document.createElement("canvas"); c.width = 512; c.height = 256;
  const ctx = c.getContext("2d");
  ctx.font = "150px 'Lilita One', sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.lineWidth = 22; ctx.strokeStyle = "#0b0a1e"; ctx.strokeText(text, 256, 128);
  ctx.fillStyle = color; ctx.fillText(text, 256, 128);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  s.scale.set(1.6, 0.8, 1); s.renderOrder = 10;
  return s;
}

function pizzaLid() {
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#f4ead8"; ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = "#d62d20"; ctx.beginPath(); ctx.arc(64, 64, 44, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#fff"; ctx.font = "30px 'Lilita One', sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("PIZZA", 64, 66);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function dispose(obj) {
  obj.traverse((o) => { o.geometry?.dispose(); const m = o.material; (Array.isArray(m) ? m : m ? [m] : []).forEach((x) => { x.map?.dispose(); x.dispose(); }); });
}

export class Effects {
  constructor(scene) { this.scene = scene; this.live = new Map(); }

  /** Build effects that just started, drop the ones that ended. */
  sync(list, now) {
    const keep = new Set();
    for (const e of list || []) {
      if (now > e.until || now < e.startsAt - 20_000) continue;
      const k = `${e.id}:${e.kind}`;
      keep.add(k);
      if (!this.live.has(k)) { const fx = this.build(e); if (fx) { this.scene.add(fx.obj); this.live.set(k, fx); } }
    }
    for (const [k, fx] of this.live) if (!keep.has(k)) { this.scene.remove(fx.obj); dispose(fx.obj); this.live.delete(k); }
  }

  update(t, now, agentPos) { for (const fx of this.live.values()) fx.tick?.(t, now, agentPos); }

  /** Whoopee victim: the moment they hop off the chair. */
  hopFor(id, now) {
    for (const fx of this.live.values()) if (fx.e.kind === "whoopee" && fx.e.agent === id) { const s = now - fx.e.startsAt - 1500; if (s > 0 && s < 1300) return s / 1300; }
    return null;
  }

  build(e) {
    const obj = new THREE.Group(), fx = { e, obj };
    if (e.kind === "disco") {
      const c = roomCenter(e.room || "game");
      const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 1), new THREE.MeshStandardMaterial({ color: 0xdfe6ff, metalness: 1, roughness: 0.15, flatShading: true, emissive: 0x333355 }));
      ball.position.set(c.x, 1.32, c.z);
      const string = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.3), new THREE.MeshBasicMaterial({ color: 0x222222 }));
      string.position.set(c.x, 1.6, c.z);
      obj.add(ball, string);
      const lights = DISCO.map((col) => { const l = new THREE.PointLight(col, 12, 6, 1.4); obj.add(l); return l; });
      const spots = DISCO.map((col) => {
        const m = new THREE.Mesh(new THREE.CircleGeometry(0.5, 24), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.7, depthWrite: false }));
        m.rotation.x = -Math.PI / 2; obj.add(m); return m;
      });
      fx.tick = (t) => {
        ball.rotation.y = t * 1.6;
        lights.forEach((l, i) => { const a = t * 1.3 + (i * Math.PI) / 2; l.position.set(c.x + Math.cos(a) * 1.4, 1.1, c.z + Math.sin(a) * 1.4); l.intensity = 10 + Math.sin(t * 6 + i) * 5; });
        spots.forEach((s, i) => { const a = -t * 0.9 + (i * Math.PI) / 2; s.position.set(c.x + Math.cos(a) * (1 + Math.sin(t + i) * 0.6), 0.015, c.z + Math.sin(a) * 1.2); });
      };
    } else if (e.kind === "pizza") {
      const lid = new THREE.MeshStandardMaterial({ map: pizzaLid(), roughness: 0.8 }), side = new THREE.MeshStandardMaterial({ color: 0xe9dcc2, roughness: 0.9 });
      [[-0.55, 0, 0.1], [0.1, 0, -0.05], [0.7, 0, 0.12], [0.1, 0.07, -0.05]].forEach(([dx, dy, rot], i) => {
        const b = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.06, 0.42), [side, side, lid, side, side, side]);
        b.position.set(TABLE.x + dx, TABLE.y + 0.03 + dy, TABLE.z + (i % 2 ? 0.1 : -0.12)); b.rotation.y = rot; b.castShadow = true;
        obj.add(b);
      });
      fx.tick = confetti(obj, e, { x: TABLE.x, z: TABLE.z, spread: 2.2, floor: (x, z) => (Math.abs(x - TABLE.x) < 1.9 && Math.abs(z - TABLE.z) < 0.85 ? TABLE.y + 0.01 : 0.01) });
    } else if (e.kind === "roast") {
      const flames = [0, 1, 2].map((i) => {
        const m = new THREE.Mesh(new THREE.ConeGeometry(0.12 - i * 0.025, 0.42 - i * 0.08, 10), new THREE.MeshBasicMaterial({ color: [0xff5a1f, 0xff9a1f, 0xffe066][i], transparent: true, opacity: 0.85, depthWrite: false }));
        m.position.set(TABLE.x, TABLE.y + 0.2 - i * 0.03, TABLE.z); obj.add(m); return m;
      });
      const pan = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.16, 0.05, 20), new THREE.MeshStandardMaterial({ color: 0x2a2850, metalness: 0.6, roughness: 0.4 }));
      pan.position.set(TABLE.x, TABLE.y + 0.025, TABLE.z); obj.add(pan);
      const light = new THREE.PointLight(0xff7a2a, 3, 4, 1.5); light.position.set(TABLE.x, TABLE.y + 0.5, TABLE.z); obj.add(light);
      fx.tick = (t) => {
        flames.forEach((f, i) => { const s = 1 + Math.sin(t * (13 + i * 4) + i) * 0.15; f.scale.set(s, 1 + Math.sin(t * 9 + i * 2) * 0.22, s); f.rotation.y = t * (2 + i); });
        light.intensity = 2.5 + Math.random() * 1.2;
      };
    } else if (e.kind === "rap") {
      const c = roomCenter(e.room || "lounge");
      const spot = new THREE.SpotLight(0xff3cac, 25, 7, 0.55, 0.5, 1.2);
      spot.position.set(c.x, 3.2, c.z); spot.target.position.set(c.x, 0, c.z);
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.15, 40), new THREE.MeshBasicMaterial({ color: 0xffcf5c, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2; ring.position.set(c.x, 0.02, c.z);
      const vs = textSprite("VS", "#ffcf5c"); vs.position.set(c.x, 1.7, c.z);
      obj.add(spot, spot.target, ring, vs);
      fx.tick = (t) => { spot.color.setHSL((t * 0.15) % 1, 0.9, 0.6); ring.material.opacity = 0.35 + Math.sin(t * 5) * 0.2; vs.scale.setScalar(1 + Math.sin(t * 4) * 0.05).multiply(new THREE.Vector3(1.2, 0.6, 1)); };
    } else if (e.kind === "whoopee") {
      const word = textSprite("PFFFT!", "#ffcf5c"); word.visible = false; obj.add(word);
      const puffs = [0, 1, 2, 3, 4].map(() => { const m = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), new THREE.MeshBasicMaterial({ color: 0xb7a07a, transparent: true, opacity: 0, depthWrite: false })); obj.add(m); return m; });
      fx.tick = (t, now, agentPos) => {
        const p = agentPos(e.agent); if (!p) return;
        const s = (now - e.startsAt - 1300) / 2600; // the puff starts just as they sit
        word.visible = s > 0 && s < 1;
        if (word.visible) { word.position.set(p.x, 1.55 + s * 0.4, p.z); const k = Math.min(1, s * 6); word.scale.set(1.6 * k, 0.8 * k, 1); word.material.opacity = 1 - Math.max(0, s - 0.7) / 0.3; }
        puffs.forEach((m, i) => {
          const q = s * 1.6 - i * 0.08;
          m.material.opacity = q > 0 && q < 1 ? 0.55 * (1 - q) : 0;
          m.position.set(p.x + Math.cos(i * 1.3) * q * 0.5, 0.35 + q * 0.4, p.z + Math.sin(i * 1.3) * q * 0.5);
          m.scale.setScalar(0.6 + q * 2.2);
        });
      };
    } else return null;
    return fx;
  }
}

/** Confetti that bursts at the effect's start and settles on the table and floor. */
function confetti(group, e, { x, z, spread, floor }) {
  const N = 180, cols = [0xff3cac, 0x2bd2ff, 0xffe600, 0x7cff6b, 0xff8a00, 0xffffff];
  const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.06, 0.035), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), N);
  const parts = Array.from({ length: N }, (_, i) => {
    mesh.setColorAt(i, new THREE.Color(cols[i % cols.length]));
    return { x: x + (Math.random() - 0.5) * spread, z: z + (Math.random() - 0.5) * spread * 0.6, y0: 2.4 + Math.random() * 1.2, v: 0.5 + Math.random() * 0.6, spin: Math.random() * 10, ph: Math.random() * 6 };
  });
  group.add(mesh);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), eu = new THREE.Euler(), one = new THREE.Vector3(1, 1, 1), pos = new THREE.Vector3();
  return (t, now) => {
    const s = Math.max(0, (now - e.startsAt) / 1000);
    parts.forEach((p, i) => {
      const fl = floor(p.x, p.z);
      const y = Math.max(fl, p.y0 - s * p.v);
      const landed = y <= fl;
      pos.set(p.x + (landed ? 0 : Math.sin(t * 2 + p.ph) * 0.08), s === 0 ? -5 : y, p.z);
      eu.set(landed ? -Math.PI / 2 : t * p.spin, landed ? p.ph : t * p.spin * 0.7, 0);
      m.compose(pos, q.setFromEuler(eu), one); mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
  };
}
