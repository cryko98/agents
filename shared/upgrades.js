// Office upgrades the crew unlocks as the project grows. Shared by the engine and the browser.
// metric names map to lib/stats.js upgradeMetrics().
export const UPGRADES = [
  { id: "neon", name: "Neon COOKERS sign", desc: "A pink neon sign on the workspace wall.", metric: "launched", target: 1, label: "Launch the first coin" },
  { id: "arcade3", name: "Golden arcade cabinet", desc: "A third, very shiny arcade machine.", metric: "donors", target: 1, label: "First holder donation" },
  { id: "trophy", name: "Creator-fee trophy", desc: "A gold cup on the workspace cabinet.", metric: "feesSol", target: 0.01, label: "Collect 0.01 SOL in creator fees" },
  { id: "tradingwall", name: "Trading wall", desc: "Extra chart monitors on the meeting table.", metric: "pnlSol", target: 0.1, label: "Paper PnL above +0.1 SOL" },
  { id: "goldcouch", name: "Golden couch", desc: "The lounge couch, but rich.", metric: "supportSol", target: 0.1, label: "0.1 SOL from fees + donations" },
  { id: "jungle", name: "Plant jungle", desc: "Plants everywhere. Pixel insisted.", metric: "launched", target: 3, label: "Launch 3 coins" },
];
