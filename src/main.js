import { Renderer } from "./renderer.js";
import { Sim } from "./sim.js";
import { requestScene, addEntry, checkHealth, aiState } from "./dialogue.js";
import { plan, applyPlanUpdate, needsLogo, generateLogo } from "./coin.js";
import { initUI, appendMessage, updateBubbles, updateRoster, updateStatus, renderCoin } from "./ui.js";
import { onLine } from "./dialogue.js";
import { STAGE_INFO } from "../shared/roster.js";

const canvas = document.getElementById("scene");
const renderer = new Renderer(canvas);

const clock = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };

const sim = new Sim({
  requestScript: async (scene) => {
    const script = await requestScene({
      type: scene.type,
      participants: scene.participants.map((a) => a.id),
      location: scene.location,
      plan,
      clock: clock(),
    });
    if (script.source === "offline" && aiState.checked && !aiState.claude && !sessionStorage.getItem("offline-note")) {
      sessionStorage.setItem("offline-note", "1");
      addEntry({ kind: "system", text: "Offline mode: no ANTHROPIC_API_KEY configured, so the agents are using canned lines. Add the key to make them think for real." });
    }
    return script;
  },
  onSceneStart: (scene) => {
    addEntry({ kind: "scene", text: scene.title });
  },
  onLine: (line) => {
    addEntry({ kind: "line", speaker: line.speaker, text: line.text, emotion: line.emotion });
  },
  onSceneEnd: (scene) => {
    if (scene.planUpdate) {
      const before = plan.stage;
      const changed = applyPlanUpdate(scene.planUpdate);
      if (changed.includes("stage")) {
        addEntry({ kind: "system", text: `Plan moved from ${STAGE_INFO[before].label} to ${STAGE_INFO[plan.stage].label}.` });
      } else if (changed.length) {
        addEntry({ kind: "system", text: `Plan updated: ${changed.join(", ")}.` });
      }
      if (changed.includes("name") || changed.includes("ticker")) {
        if (plan.name) addEntry({ kind: "system", text: `The coin has a name: ${plan.name}${plan.ticker ? ` ($${plan.ticker})` : ""}.` });
      }
    }
    maybeRenderLogo();
  },
});

onLine((e) => appendMessage(e));

initUI({ sim, renderer, canvas, onTip: () => { sim.nudge(); renderCoin(); } });

async function maybeRenderLogo() {
  if (!needsLogo()) return;
  if (!aiState.fal) {
    if (!sessionStorage.getItem("fal-note")) {
      sessionStorage.setItem("fal-note", "1");
      addEntry({ kind: "system", text: "Pixel has a logo brief, but FAL_KEY is not configured, so the logo stays a placeholder." });
    }
    return;
  }
  addEntry({ kind: "system", text: "🎨 Pixel is rendering the logo…" });
  const url = await generateLogo();
  if (url) addEntry({ kind: "system", html: `🎨 Logo is up on the big screen. <a href="${url}" target="_blank" rel="noopener">Open full size</a>` });
  else addEntry({ kind: "system", text: "Logo render failed. Pixel will try again later." });
}

checkHealth().then(() => { updateStatus(); maybeRenderLogo(); });
setInterval(() => { checkHealth().then(updateStatus); }, 5 * 60 * 1000);

// ---- main loop ----
let last = performance.now();
let uiTick = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  sim.update(dt, now);
  renderer.render(sim.agents, now);
  updateBubbles(sim, renderer, canvas);
  if (now - uiTick > 500) { uiTick = now; updateRoster(sim); updateStatus(); }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// expose for debugging in the console
window.agentHouse = { sim, renderer, plan };
