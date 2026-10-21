// Isometric tile metrics (screen pixels)
export const TW = 64;        // tile width
export const TH = 32;        // tile height
export const WALL_H = 56;    // exterior wall height
export const PART_H = 14;    // interior partition height
export const S = 3;          // sprite pixel scale

export const COLS = 18;
export const ROWS = 13;

// Timing (ms)
export const WALK_SPEED = 2.2;          // tiles per second
export const SCENE_GAP_MIN = 28000;     // min wait between dialogue scenes
export const SCENE_GAP_MAX = 55000;
export const MEETING_EVERY = 3;         // every Nth scene is a team meeting
export const API_MIN_INTERVAL = 25000;  // client-side floor between API calls
export const LINE_MIN_MS = 2600;
export const LINE_MAX_MS = 7000;
export const LINE_MS_PER_CHAR = 48;

export const STORAGE_KEY = "agenthouse.v1";
export const TRANSCRIPT_LIMIT = 160;
