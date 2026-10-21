// Shared world state: shape, defaults and a few helpers used by the engine and the API.
import { AGENTS, emptyPlan } from "../shared/roster.js";
import { SEATS } from "../src/world.js";
import { leaderboard } from "./stats.js";

export const WORLD_KEY = "ah:world:v1";
export const LOCK_KEY = "ah:lock";
export const TIPS_KEY = "ah:tips";
export const VIEWER_KEY = "ah:viewer";
export const SEEN_SIGS_KEY = "ah:donations:seen";

export const TICK_INTERVAL_MS = Number(process.env.TICK_INTERVAL_MS || 45_000);
export const DESK_INTERVAL_MS = Number(process.env.DESK_INTERVAL_MS || 5 * 60_000);
export const IDLE_AFTER_MS = Number(process.env.IDLE_AFTER_MS || 10 * 60_000); // no viewers -> no chat scenes
export const TRANSCRIPT_LIMIT = 200;

export function tradingMode() {
  return process.env.TRADING_MODE === "live" ? "live" : "paper";
}

export function emptyWorld(now = Date.now()) {
  const agents = {};
  for (const a of AGENTS) {
    const seat = SEATS.desk[a.id];
    agents[a.id] = { activity: { kind: "desk", label: "Working at their desk", c: seat.c, r: seat.r, facing: seat.facing, sit: true, since: now, until: now + 20_000 } };
  }
  const startSol = Number(process.env.PAPER_START_SOL || 2);
  return {
    v: 1,
    createdAt: now,
    updatedAt: now,
    tickCount: 0,
    agents,
    scene: null,
    sceneCount: 0,
    nextSceneAt: now + 15_000,
    transcript: [
      { id: `sys-${now}`, kind: "system", text: "The kitchen is open. Six cookers, one wallet, one mission: grow the treasury.", t: now },
    ],
    plan: emptyPlan(),
    treasury: {
      mode: tradingMode(),
      address: process.env.AGENT_WALLET_PUBLIC || null,
      startSol,
      sol: startSol,            // paper cash
      realSol: null,            // live wallet balance from RPC
      positions: {},
      trades: [],
      equitySol: startSol,
      pnlSol: 0,
      pnlPct: 0,
      dayKey: dayKey(now),
      dayStartEquity: startSol,
      tradesToday: 0,
      halted: null,
      lastDeskAt: 0,
      nextDeskAt: now + 3 * 60_000,
      solUsd: null,
      thesis: null,
    },
    donations: { address: process.env.AGENT_WALLET_PUBLIC || null, totalSol: 0, wall: [], lastScanAt: 0 },
    perks: { gallery: [], pending: [] },
    launch: { status: "none" },
    events: [],
  };
}

export function dayKey(t = Date.now()) {
  return new Date(t).toISOString().slice(0, 10);
}

export function pushTranscript(world, entry) {
  const e = { id: `${entry.kind[0]}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, t: Date.now(), ...entry };
  world.transcript.push(e);
  if (world.transcript.length > TRANSCRIPT_LIMIT) world.transcript.splice(0, world.transcript.length - TRANSCRIPT_LIMIT);
  return e;
}

export function pushEvent(world, type, data = {}) {
  world.events.push({ t: Date.now(), type, ...data });
  if (world.events.length > 60) world.events.splice(0, world.events.length - 60);
}

/** What the browser is allowed to see. */
export function publicView(world) {
  return {
    serverNow: Date.now(),
    tickCount: world.tickCount,
    updatedAt: world.updatedAt,
    agents: world.agents,
    scene: world.scene,
    transcript: world.transcript.slice(-120),
    plan: { ...world.plan, story: undefined, research: undefined },
    treasury: world.treasury,
    donations: world.donations,
    perks: world.perks,
    launch: world.launch,
    launches: world.launches || [],
    research: world.research ? { at: world.research.at, trends: world.research.trends || [], ideas: world.research.ideas || [], avoid: world.research.avoid || [], searches: world.research.searches, error: world.research.error || null } : null,
    events: (world.events || []).slice(-12),
    poll: world.poll || null,
    scalper: world.scalper ? { stats: world.scalper.stats, allTime: world.scalper.allTime, bySetup: world.scalper.bySetup || {}, candidates: world.scalper.candidates || [], scanned: world.scalper.scanned || 0, freshMigrations: world.scalper.freshMigrations || 0, lastScanAt: world.scalper.lastScanAt, lastRunAt: world.scalper.lastRunAt } : null,
    leaderboard: leaderboard(world),
    upgrades: world.upgrades || [],
    upgradeMetrics: world.upgradeMetrics || null,
    nextSceneAt: world.nextSceneAt,
    nextTickAt: world.updatedAt + TICK_INTERVAL_MS,
  };
}
