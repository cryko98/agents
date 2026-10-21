import { Renderer } from "./renderer.js";
import { Sim } from "./sim.js";
import { net, onWorld, startPolling, serverNow } from "./net.js";
import { initUI, syncTranscript, updateBubbles, updateRoster, updateStatus, renderTreasury, renderCoin, updateTicker, updateScreenLogo } from "./ui.js";

const canvas = document.getElementById("scene");
const renderer = new Renderer(canvas);
const sim = new Sim();

initUI({ sim, renderer, canvas });
// lines show up in the chat the moment they are spoken; the server archives them later with the same ids
sim.onLine = (line) => syncTranscript([{ id: line.id, kind: "line", speaker: line.speaker, text: line.text, emotion: line.emotion, t: line.at }]);

let lastPlanKey = null, lastTreasuryKey = null;
onWorld((world) => {
  sim.applyWorld(world);
  syncTranscript(world.transcript);
  const planKey = JSON.stringify([world.plan, world.launch]);
  if (planKey !== lastPlanKey) { lastPlanKey = planKey; renderCoin(world); updateScreenLogo(renderer, world.plan.logoUrl); }
  const trKey = JSON.stringify([world.treasury, world.donations, world.perks]);
  if (trKey !== lastTreasuryKey) { lastTreasuryKey = trKey; renderTreasury(world); }
  updateTicker(world);
});

startPolling(4000);

let last = performance.now();
let uiTick = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  sim.update(dt, serverNow());
  renderer.render(sim.agents, now);
  updateBubbles(sim, renderer, canvas);
  if (now - uiTick > 500) { uiTick = now; updateRoster(sim); updateStatus(); }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.agentHouse = { sim, renderer, net };
