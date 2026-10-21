// POST /api/scene - ask Claude to write the next dialogue scene for the house.
import Anthropic from "@anthropic-ai/sdk";
import { json, clientIp, readBody, paused } from "../lib/http.js";
import { rateLimit } from "../lib/ratelimit.js";
import { systemPrompt, userPrompt, outputSchema, AGENT_IDS, STAGES } from "../lib/prompt.js";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5-5";
const SYSTEM = systemPrompt();

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "POST only" });
  if (!process.env.ANTHROPIC_API_KEY) return json(res, 503, { error: "ANTHROPIC_API_KEY not configured" });
  if (paused()) return json(res, 503, { error: "AI is paused" });

  const rl = rateLimit(`scene:${clientIp(req)}`, 24, 10 * 60 * 1000);
  if (!rl.ok) return json(res, 429, { error: `Too many scenes, try again in ${rl.retryAfter}s` });

  const body = await readBody(req);
  const type = body.type === "meeting" ? "meeting" : "chat";
  const participants = Array.isArray(body.participants) ? body.participants.filter((id) => AGENT_IDS.includes(id)).slice(0, 6) : [];
  if (participants.length < 2) return json(res, 400, { error: "need at least two participants" });
  const location = String(body.location || "the office").slice(0, 80);
  const clock = String(body.clock || "").slice(0, 8);
  const tips = (Array.isArray(body.tips) ? body.tips : []).map((t) => String(t).slice(0, 200)).slice(0, 5);
  const transcript = (Array.isArray(body.transcript) ? body.transcript : [])
    .filter((l) => l && AGENT_IDS.includes(l.speaker) && typeof l.text === "string")
    .map((l) => ({ speaker: l.speaker, text: l.text.slice(0, 220) }))
    .slice(-24);
  const plan = sanitizePlan(body.plan);

  const client = new Anthropic();
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4000,
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: userPrompt({ type, participants, location, plan, transcript, tips, clock }) }],
      output_config: { effort: "low", format: { type: "json_schema", schema: outputSchema(participants) } },
    });

    if (response.stop_reason === "refusal") {
      return json(res, 502, { error: "The model declined to write this scene", category: response.stop_details?.category || null });
    }
    const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    let parsed;
    try { parsed = JSON.parse(text); } catch { return json(res, 502, { error: "Model returned invalid JSON" }); }

    const lines = (parsed.lines || [])
      .filter((l) => l && participants.includes(l.speaker) && typeof l.text === "string" && l.text.trim())
      .map((l) => ({ speaker: l.speaker, text: l.text.trim().slice(0, 220), emotion: l.emotion || "neutral" }))
      .slice(0, 14);
    const planUpdate = parsed.planUpdate && typeof parsed.planUpdate === "object" ? parsed.planUpdate : null;
    if (planUpdate && planUpdate.stage && !STAGES.includes(planUpdate.stage)) planUpdate.stage = null;

    return json(res, 200, {
      lines,
      planUpdate,
      model: response.model,
      usage: { input: response.usage.input_tokens, output: response.usage.output_tokens, cached: response.usage.cache_read_input_tokens || 0 },
    });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return json(res, 429, { error: "Claude rate limit, slow down" });
    if (err instanceof Anthropic.AuthenticationError) return json(res, 500, { error: "Invalid ANTHROPIC_API_KEY" });
    if (err instanceof Anthropic.APIError) return json(res, 502, { error: `Claude error ${err.status}: ${err.message}` });
    console.error(err);
    return json(res, 500, { error: "Scene generation failed" });
  }
}

function sanitizePlan(p) {
  const s = (v, n = 400) => (typeof v === "string" ? v.slice(0, n) : null);
  const list = (v) => (Array.isArray(v) ? v.map((x) => String(x).slice(0, 200)).slice(0, 8) : []);
  p = p && typeof p === "object" ? p : {};
  return {
    stage: STAGES.includes(p.stage) ? p.stage : "brainstorm",
    theme: s(p.theme), candidates: list(p.candidates), name: s(p.name, 60), ticker: s(p.ticker, 8),
    tagline: s(p.tagline, 160), concept: s(p.concept, 600), logoPrompt: s(p.logoPrompt, 500),
    hasLogo: !!p.logoUrl, tokenomics: list(p.tokenomics), roadmap: list(p.roadmap), notes: s(p.notes, 400),
  };
}
