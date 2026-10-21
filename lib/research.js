// The research desk: before the crew brainstorms a coin, Sage and Juno browse the web
// (Claude's server-side web search) for what is actually moving right now, so the concept
// can ride a real trend instead of defaulting to another cat coin.
import Anthropic from "@anthropic-ai/sdk";
import { pushTranscript, pushEvent } from "./state.js";

const MODEL = process.env.ANTHROPIC_RESEARCH_MODEL || process.env.ANTHROPIC_DESK_MODEL || process.env.ANTHROPIC_MODEL || "claude-opus-5-5";
export const RESEARCH_TTL_MS = Number(process.env.RESEARCH_TTL_MS || 2 * 3_600_000); // fresh trends every 2h for the launch sprints
const MAX_SEARCHES = Number(process.env.RESEARCH_MAX_SEARCHES || 6);

// Haiku and older models only have the basic web search variant.
const toolType = () => (/haiku|4-5|3-/.test(MODEL) ? "web_search_20250305" : "web_search_20260209");

export function researchDue(world) {
  const r = world.research;
  if (!r) return true;
  if (r.failedAt && Date.now() - r.failedAt < 30 * 60_000) return false;
  return Date.now() - (r.at || 0) > RESEARCH_TTL_MS;
}

const PROMPT = `You are the research desk of COOKERS, six AI agents who are about to design a Solana memecoin they will launch on pump.fun. Your job: browse the web and find out what is genuinely trending RIGHT NOW so the crew can build a concept that rides a real wave, not a generic animal coin.

Search for (use several distinct searches): the most-talked-about internet moments and memes of the last few days; the most-discussed news, tech, science, sports, gaming, music or pop-culture stories; what is currently hot in crypto / Solana / pump.fun (narratives, viral launches, what format is working); and any cultural moment that could become a joke, a mascot or a movement.

Then write a brief for the crew as JSON only (no prose before or after):
{
  "trends": [ { "title": "...", "why": "one or two sentences: what it is and why people care this week", "source": "https://..." } ],   // 5-8 items, varied topics, newest first
  "ideas": [ { "name": "...", "ticker": "3-6 uppercase letters", "hook": "one sentence: the concept and which trend it rides", "format": "mascot | movement | joke | tool | event | other" } ],   // 5 concrete, original coin concepts, NOT cat/dog/frog unless the twist is truly new
  "avoid": [ "..." ]   // 2-4 tired patterns to avoid right now
}
Rules: cite a real URL per trend; be specific (names, numbers, dates); concepts must be fun, explainable in one sentence and non-defamatory; no real private individuals; no claims of returns.`;

export async function runResearch(world) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const client = new Anthropic();
  const started = Date.now();
  try {
    const messages = [{ role: "user", content: PROMPT }];
    let response, rounds = 0;
    do {
      response = await client.messages.create({
        model: MODEL,
        max_tokens: 8000,
        tools: [{ type: toolType(), name: "web_search", max_uses: MAX_SEARCHES }],
        messages,
        output_config: { effort: "low" },
      });
      if (response.stop_reason === "pause_turn") { messages.push({ role: "assistant", content: response.content }); rounds++; }
    } while (response.stop_reason === "pause_turn" && rounds < 3);

    if (response.stop_reason === "refusal") throw new Error(`refusal: ${response.stop_details?.category || "unknown"}`);
    const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
    const searches = response.content.filter((b) => b.type === "server_tool_use").length;
    const parsed = extractJSON(text);
    if (!parsed?.trends?.length) throw new Error("no trends in research output");
    world.research = {
      at: Date.now(),
      model: response.model,
      searches,
      trends: parsed.trends.slice(0, 8).map((t) => ({ title: s(t.title, 120), why: s(t.why, 300), source: s(t.source, 300) })),
      ideas: (parsed.ideas || []).slice(0, 6).map((i) => ({ name: s(i.name, 60), ticker: s(i.ticker, 8).toUpperCase().replace(/[^A-Z0-9]/g, ""), hook: s(i.hook, 240), format: s(i.format, 20) })),
      avoid: (parsed.avoid || []).slice(0, 4).map((a) => s(a, 120)),
      ms: Date.now() - started,
      usage: { in: response.usage.input_tokens, out: response.usage.output_tokens },
    };
    // keep a copy with the plan: it becomes part of the coin's birth record
    if (["brainstorm", "concept"].includes(world.plan.stage)) world.plan.research = { at: world.research.at, trends: world.research.trends, ideas: world.research.ideas };
    pushTranscript(world, { kind: "system", text: `🔎 Sage and Juno browsed the web (${searches} searches). Fresh trends are on the whiteboard: ${world.research.trends.slice(0, 3).map((t) => t.title).join(" · ")}` });
    pushEvent(world, "research", { searches, ms: world.research.ms });
    return world.research;
  } catch (err) {
    world.research = { ...(world.research || {}), failedAt: Date.now(), error: err.message };
    pushEvent(world, "research-error", { error: err.message });
    return null;
  }
}

function extractJSON(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidates = [fenced?.[1], text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)];
  for (const c of candidates) { if (!c) continue; try { return JSON.parse(c); } catch { /* try next */ } }
  return null;
}
const s = (v, n) => String(v ?? "").trim().slice(0, n);

/** Compact text block for the meeting prompt. */
export function researchBlock(world) {
  const r = world.research;
  if (!r?.trends?.length) return "MARKET RESEARCH: none yet (the crew hasn't browsed the web this session).";
  const age = Math.round((Date.now() - r.at) / 3_600_000);
  return `MARKET RESEARCH (the crew browsed the web ${age}h ago; build on this, name the trend you ride):
Trends:
${r.trends.map((t) => `- ${t.title}: ${t.why}`).join("\n")}
Concept seeds from the research desk (use, remix or beat them):
${r.ideas.map((i) => `- ${i.name} ($${i.ticker}) [${i.format}]: ${i.hook}`).join("\n")}
Avoid: ${r.avoid.join("; ") || "generic animal coins"}`;
}
