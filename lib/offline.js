// Canned lines so the crew stays alive when ANTHROPIC_API_KEY is missing or a call fails.
import { STAGES } from "../shared/roster.js";

const CHAT_LINES = {
  nova: ["Okay but imagine the billboard. Picture it.", "We're not building a coin, we're building a moment.", "Small ideas die quietly. Let's not.", "I had another idea at 3am. You'll love it. Probably.", "The treasury doesn't grow itself. Ideas, people."],
  byte: ["How exactly? Walk me through it.", "Mint authority gets revoked on day one or I'm not shipping.", "That's a vibe, not a spec.", "Fine. But I'm writing tests.", "I've seen that pattern rug before. Twice."],
  pixel: ["It needs more glow. Trust me.", "What if the mascot had tiny sunglasses? Hear me out.", "The gradient is wrong and it's keeping me up at night.", "I already drew three versions in my head.", "Pink and teal. Don't argue with me."],
  max: ["SEND IT. We cook today.", "Chart's gonna look like a hockey stick, ser.", "Liquidity first, feelings second.", "I've been awake for 36 hours and I feel amazing.", "Rules say three buys a day. I hate rules. I love rules."],
  sage: ["Who is this actually for? Let's start there.", "Let's make a decision we won't regret in a week.", "Community first. The chart follows.", "I love it. I also have three concerns.", "Max, breathe."],
  juno: ["this is going on the timeline", "ok but what's the SOUND. every coin needs a sound", "i could cut a video of this in four minutes", "lowercase energy only. it's the brand", "we're so back (we were never gone)"],
};

const TIP_REACTIONS = {
  nova: (tip) => `A holder says "${tip}". Honestly? Bold. I respect it.`,
  byte: (tip) => `Someone suggested "${tip}". Define it and I'll tell you if it ships.`,
  pixel: (tip) => `"${tip}"... ooh, I can see the colors already.`,
  max: (tip) => `HOLDER TIP: "${tip}". Chat is cooking today.`,
  sage: (tip) => `A holder suggested "${tip}". Let's actually consider it.`,
  juno: (tip) => `"${tip}" is a meme format waiting to happen.`,
};

const OFFLINE_PLAN = {
  theme: "a tiny glowing cat who refuses to sleep until the chart is green",
  candidates: ["Glowcat ($GLOW)", "Moonloaf ($LOAF)", "Nightshift ($SHIFT)"],
  name: "Glowcat", ticker: "GLOW", tagline: "Never sleeps. Always glows.",
  concept: "Glowcat is a small neon cat that lives in the office server rack and only glows when the community is awake. The mascot for everyone who checks the chart at 4am and tells themselves it's the last time.",
  logoPrompt: "cute pixel-art neon cat face, teal and hot pink glow, round eyes, tiny sunglasses pushed up on its head, memecoin logo, centered, clean dark background, bold shapes, no text",
  tokenomics: ["Fair launch on pump.fun, no presale, no team allocation", "1,000,000,000 supply, mint authority revoked at launch", "The crew never sells its own coin; it earns creator fees only", "No taxes, no hidden fees"],
  roadmap: ["Launch day: 24-hour 'stay awake' stream with the mascot", "Week 1: meme contest judged by Pixel", "Week 2: Glowcat sticker pack and TikTok sounds"],
};

const MEETING_SCRIPTS = {
  brainstorm: [["nova", "Okay, team. Brainstorm. No idea is too dumb. Go."], ["juno", "a cat. but it glows. and it never sleeps. like max"], ["max", "I'm honored. And I'm in."], ["pixel", "Ooh. Neon teal cat with pink glow. I can SEE it."], ["byte", "A cat coin. Original. But fine, cats work."], ["sage", "Three candidates on the board: Glowcat, Moonloaf, Nightshift. We pick next time."]],
  concept: [["sage", "Decision time. Glowcat, Moonloaf or Nightshift?"], ["max", "GLOW. Ticker's clean, four letters, sends itself."], ["pixel", "Glowcat. The others don't have a face yet."], ["juno", "'never sleeps. always glows.' that's the tagline"], ["byte", "Glowcat. $GLOW. Fine. Lock it."], ["nova", "Locked. Glowcat lives in the server rack and glows when we're awake."]],
  branding: [["pixel", "Logo time. Pixel cat face, teal and hot pink, round eyes, tiny sunglasses on its head."], ["max", "Sunglasses. Respect."], ["nova", "Make it glow like it owes us money."], ["byte", "Clean background. No text. Text always renders wrong."], ["juno", "it needs to work as a 32px emoji or it's cooked"], ["pixel", "Clean dark background, bold shapes, centered. Rendering it now."]],
  tokenomics: [["byte", "Tokenomics. Fair launch, no presale, no team allocation. Non-negotiable."], ["max", "One billion supply, mint revoked day one."], ["sage", "And we never sell our own coin. Creator fees only. Say it out loud."], ["nova", "We never sell our own coin."], ["byte", "Mint revoked day one."], ["juno", "launch day 24h 'stay awake' stream. the cat watches you. you watch the cat"]],
  "launch-ready": [["nova", "We're launch-ready. Now we make noise."], ["juno", "meme contest week one. pixel judges. i already have four entries"], ["sage", "Launch goes out the moment the checklist is green. Until then, we trade smart and thank the holders."], ["max", "Treasury up only. Within the rules. Mostly within the rules."], ["byte", "Launch checklist is green. Don't touch anything."], ["pixel", "The sticker pack is drawn. The sunglasses stay."]],
};

const DESK_LINES = [
  ["max", "Desk is open. Let's see what's moving."],
  ["byte", "Nothing on the list passes my filters today. We hold."],
  ["sage", "Holding is a position too. The treasury lives to fight tomorrow."],
  ["nova", "Fine. But next session I want a thesis, not a shrug."],
  ["juno", "clip it: 'the agents did nothing and it was the right call'"],
  ["pixel", "I'll draw the chart we didn't lose money on."],
];

const EMOTIONS = ["neutral", "happy", "excited", "thinking", "laughing"];
const emo = () => EMOTIONS[Math.floor(Math.random() * EMOTIONS.length)];
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export function offlineScene({ type, participants, plan, tips = [] }) {
  const lines = [];
  if (type === "meeting") {
    const stage = STAGES.includes(plan?.stage) ? plan.stage : "brainstorm";
    for (const [speaker, text] of MEETING_SCRIPTS[stage] || MEETING_SCRIPTS["launch-ready"]) lines.push({ speaker, text, emotion: emo() });
    if (tips.length) lines.splice(2, 0, { speaker: "sage", text: TIP_REACTIONS.sage(tips[0]), emotion: "thinking" });
    const next = STAGES[Math.min(STAGES.indexOf(stage) + 1, STAGES.length - 1)];
    const planUpdate = {};
    if (stage === "brainstorm") Object.assign(planUpdate, { theme: OFFLINE_PLAN.theme, candidates: OFFLINE_PLAN.candidates, stage: next });
    else if (stage === "concept") Object.assign(planUpdate, { name: OFFLINE_PLAN.name, ticker: OFFLINE_PLAN.ticker, tagline: OFFLINE_PLAN.tagline, concept: OFFLINE_PLAN.concept, stage: next });
    else if (stage === "branding") Object.assign(planUpdate, { logoPrompt: OFFLINE_PLAN.logoPrompt, stage: next });
    else if (stage === "tokenomics") Object.assign(planUpdate, { tokenomics: OFFLINE_PLAN.tokenomics, roadmap: OFFLINE_PLAN.roadmap, stage: next });
    return { lines, planUpdate, source: "offline" };
  }
  if (type === "desk") {
    for (const [speaker, text] of DESK_LINES) lines.push({ speaker, text, emotion: emo() });
    return { lines, orders: [], thesis: "No candidate passed the safety filters; the desk is holding cash.", source: "offline" };
  }
  const [a, b] = participants;
  if (tips.length) {
    lines.push({ speaker: a, text: TIP_REACTIONS[a](tips[0]), emotion: "thinking" });
    lines.push({ speaker: b, text: pick(CHAT_LINES[b]), emotion: emo() });
  }
  for (const id of [a, b, a, b]) lines.push({ speaker: id, text: pick(CHAT_LINES[id]), emotion: emo() });
  return { lines: lines.slice(0, 5), planUpdate: null, source: "offline" };
}
