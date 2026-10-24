// Before a found photo becomes a coin logo, Claude looks at it: does it actually show the coin's
// subject, and does it work as a logo at thumbnail size? A news search matches headlines, not
// pictures, so the first hit often shows someone or something else.
import Anthropic from "@anthropic-ai/sdk";
import { imagesFor } from "./signals.js";
import { checkImage } from "./image.js";

const MODEL = process.env.ANTHROPIC_LOGO_CHECK_MODEL || process.env.ANTHROPIC_MODEL || "claude-opus-5-5";

async function jpeg(url) {
  const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36" }, signal: AbortSignal.timeout(12_000), redirect: "follow" });
  if (!r.ok) throw new Error(`image ${r.status}`);
  const sharp = (await import("sharp")).default;
  return sharp(Buffer.from(await r.arrayBuffer())).rotate().resize(512, 512, { fit: "inside" }).jpeg({ quality: 80 }).toBuffer();
}

/**
 * The logo photo for a plan: candidates from a search for the named subject, the crew's pick, the story's
 * own photo and a search for the headline; the first one Claude confirms shows the subject wins.
 * Returns { url, shows, reason, rejected: [{ url, shows, reason }] } (url null when none fits).
 */
export async function findLogoPhoto(plan, max = 6) {
  const cands = [];
  const add = (url) => { if (url && !cands.includes(url)) cands.push(url); };
  if (plan.logoSubject) (await imagesFor(plan.logoSubject, 3).catch(() => [])).forEach((h) => add(h.image));
  if (plan.logoSource === "web") add(plan.logoUrl);
  add(plan.source?.image);
  if (plan.source?.title) (await imagesFor(plan.source.title, 2).catch(() => [])).forEach((h) => add(h.image));
  const rejected = [];
  for (const url of cands.slice(0, max)) {
    if (!(await checkImage(url))) continue;
    const v = await photoFits(url, plan);
    if (v.fits) return { url, shows: v.shows, reason: v.reason, rejected };
    rejected.push({ url, shows: v.shows, reason: v.reason });
  }
  return { url: null, rejected };
}

/** { fits, shows, reason } for one candidate photo. No Claude key: everything passes (as before). */
export async function photoFits(url, plan) {
  if (!process.env.ANTHROPIC_API_KEY) return { fits: true, shows: "", reason: "no check without a Claude key" };
  let img;
  try { img = await jpeg(url); } catch (err) { return { fits: false, shows: "", reason: `couldn't load it (${err.message})` }; }
  const subject = plan.logoSubject || plan.name;
  const text = `A memecoin needs a logo photo.
Coin: ${plan.name} ($${plan.ticker})${plan.tagline ? ` - ${plan.tagline}` : ""}
Story: ${plan.source?.title || "-"}
The logo must show: ${subject}

Does the attached photo clearly show that (the right person, animal, object or scene, recognisably), and would it work as a coin logo cropped to a square and seen small?
Reject it if it shows a different person or subject, a generic or unrelated stock picture, a news outlet's logo or a graphic full of text, a collage, or if it is too dark, blurry or cluttered to read small.
Return JSON: {"fits": boolean, "shows": "<what the photo actually shows, a few words>", "reason": "<one short sentence>"}`;
  try {
    const r = await new Anthropic().messages.create({
      model: MODEL, max_tokens: 200,
      messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: img.toString("base64") } }, { type: "text", text }] }],
      output_config: { effort: "low", format: { type: "json_schema", schema: { type: "object", additionalProperties: false, required: ["fits", "shows", "reason"], properties: { fits: { type: "boolean" }, shows: { type: "string" }, reason: { type: "string" } } } } },
    });
    if (r.stop_reason === "refusal") return { fits: false, shows: "", reason: "refused" };
    const out = JSON.parse(r.content.filter((b) => b.type === "text").map((b) => b.text).join(""));
    return { fits: !!out.fits, shows: String(out.shows || "").slice(0, 80), reason: String(out.reason || "").slice(0, 160) };
  } catch (err) {
    return { fits: false, shows: "", reason: `check failed (${err.message.slice(0, 60)})` };
  }
}
