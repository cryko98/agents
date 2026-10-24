import { Renderer } from "./renderer3d.js";
import { Sim } from "./sim.js";
import { net, onWorld, startPolling, serverNow } from "./net.js";
import { initUI, syncTranscript, updateBubbles, updateRoster, updateStatus, renderTreasury, renderCoin, updateTicker, updateScreenLogo, renderLeaderboard } from "./ui.js";

const canvas = document.getElementById("scene");
const renderer = new Renderer(canvas);
const sim = new Sim();

initUI({ sim, renderer, canvas });
// lines show up in the chat the moment they are spoken; the server archives them later with the same ids
sim.onLine = (line) => syncTranscript([{ id: line.id, kind: "line", speaker: line.speaker, text: line.text, emotion: line.emotion, t: line.at }]);

let lastPlanKey = null, lastTreasuryKey = null, lastBoardKey = null;
onWorld((world) => {
  sim.applyWorld(world);
  renderer.world = world; // desk monitors draw from it
  syncTranscript(world.transcript);
  renderer.upgrades = new Set(world.upgrades || []);
  // the vote countdown changes every minute, so the coin lab re-renders then too
  const minute = world.poll?.status === "open" ? Math.floor(world.serverNow / 60000) : null;
  const planKey = JSON.stringify([world.plan, world.launch, world.launches, world.poll, minute]);
  if (planKey !== lastPlanKey) { lastPlanKey = planKey; renderCoin(world); updateScreenLogo(renderer, world.plan.logoUrl); }
  const trKey = JSON.stringify([world.treasury, world.donations, world.perks, world.upgrades, world.upgradeMetrics]);
  if (trKey !== lastTreasuryKey) { lastTreasuryKey = trKey; renderTreasury(world); }
  const boardKey = JSON.stringify(world.leaderboard);
  if (boardKey !== lastBoardKey) { lastBoardKey = boardKey; renderLeaderboard(world); }
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
