// localStorage persistence for the viewer's copy of the house state.
import { STORAGE_KEY } from "./config.js";

let cache = null;

export function loadState() {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    cache = raw ? JSON.parse(raw) : {};
  } catch {
    cache = {};
  }
  return cache;
}

let saveTimer = null;
export function saveState(patch) {
  const state = Object.assign(loadState(), patch);
  cache = state;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* storage unavailable */ }
  }, 300);
}

export function clearState() {
  cache = {};
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}
