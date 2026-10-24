// What viewers can buy: fun interactions that make something happen in the house, and time on the
// garden billboard. Shared by the browser (the shop) and the API (prices, validation).

export const INTERACTIONS = [
  { id: "coffee", label: "Coffee round", price: 0.01, icon: "cup",
    blurb: "The whole crew drops everything for a coffee break in the kitchen. On you.", pick: 0 },
  { id: "whoopee", label: "Whoopee cushion", price: 0.01, icon: "cushion",
    blurb: "Hide a whoopee cushion on someone's chair. Pick the victim, watch the fallout.", pick: 1 },
  { id: "ask", label: "Ask a cooker", price: 0.02, icon: "chat",
    blurb: "One question to the cooker of your choice. The answer comes in character.", pick: 1, text: "Your question" },
  { id: "roast", label: "Roast my idea", price: 0.02, icon: "flame",
    blurb: "Pitch a coin idea. The whole crew roasts it at the big table (lovingly).", pick: 0, text: "Your coin idea" },
  { id: "disco", label: "Disco mode", price: 0.03, icon: "disco",
    blurb: "Lights down, disco ball up. The crew hits the dance floor in the game room.", pick: 0 },
  { id: "rap", label: "Rap battle", price: 0.05, icon: "mic",
    blurb: "Pick two cookers and a topic. Bars are traded, a judge picks the winner.", pick: 2, text: "Battle topic" },
  { id: "pizza", label: "Pizza party", price: 0.05, icon: "pizza",
    blurb: "Pizza lands on the meeting table, everybody gathers, confetti flies.", pick: 0 },
];
export const interactionById = Object.fromEntries(INTERACTIONS.map((i) => [i.id, i]));

// Garden billboard: time slots, booked back to back.
export const BILLBOARD_PLANS = [
  { hours: 1, price: 0.02 },
  { hours: 6, price: 0.08 },
  { hours: 24, price: 0.25 },
];
export const BILLBOARD_MAX_AHEAD_H = 72; // how far ahead the board can be booked
export const BILLBOARD_LIMITS = { headline: 48, description: 280, handle: 15 };

/** An X handle without the @, or null. */
export function cleanHandle(h) {
  const s = String(h || "").trim().replace(/^@/, "").replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//i, "").split(/[/?#]/)[0];
  return /^[A-Za-z0-9_]{1,15}$/.test(s) ? s : null;
}

/** An https link, or null. */
export function cleanLink(u) {
  try { const url = new URL(String(u || "").trim()); return url.protocol === "https:" ? url.toString() : null; } catch { return null; }
}
