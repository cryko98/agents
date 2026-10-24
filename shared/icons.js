// Inline SVG icons (drawn here, no emoji): chunky round strokes with a soft duotone fill (".f"),
// colored with currentColor so they take the text color or an icon class (.i.gold, .i.ok, ...).
const P = {
  house: `<path class="f" d="M5.5 9.5 12 4l6.5 5.5V20h-13Z"/><path d="M3 11.5 12 4l9 7.5M5.5 9.5V20h13V9.5M10 20v-5h4v5"/>`,
  monitor: `<rect class="f" x="3" y="4" width="18" height="12" rx="2"/><path d="M9 20h6M12 16v4"/>`,
  chat: `<path class="f" d="M6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H11l-5 4v-4h.5A2.5 2.5 0 0 1 4 13.5v-8A2.5 2.5 0 0 1 6.5 3Z"/><path d="M8.5 8h7M8.5 11.5h4"/>`,
  coins: `<path class="f" d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/><ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v4c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 10v4c0 1.7 3.1 3 7 3s7-1.3 7-3v-4M5 14v4c0 1.7 3.1 3 7 3s7-1.3 7-3v-4"/>`,
  flask: `<path class="f" d="M7.2 15h9.6l2.6 3.3A1.8 1.8 0 0 1 17.8 21H6.2a1.8 1.8 0 0 1-1.6-2.7Z"/><path d="M9 3h6M10 3v6.2L4.6 18.3A1.8 1.8 0 0 0 6.2 21h11.6a1.8 1.8 0 0 0 1.6-2.7L14 9.2V3M7.2 15h9.6"/>`,
  chef: `<path class="f" d="M7 14.5A4 4 0 0 1 7.6 6.6a4.5 4.5 0 0 1 8.8 0 4 4 0 0 1 .6 7.9V20H7Z"/><path d="M7 14.5A4 4 0 0 1 7.6 6.6a4.5 4.5 0 0 1 8.8 0 4 4 0 0 1 .6 7.9V20H7ZM7 17h10"/>`,
  trophy: `<path class="f" d="M8 4h8v5a4 4 0 0 1-8 0Z"/><path d="M8 4h8v5a4 4 0 0 1-8 0ZM8 6H5v1a3 3 0 0 0 3 3M16 6h3v1a3 3 0 0 1-3 3M12 13v4M9.5 17h5v3h-5ZM8 20h8"/>`,
  robot: `<rect class="f" x="5" y="8" width="14" height="11" rx="3"/><path d="M12 4.5V8M9.5 12.5v1.5M14.5 12.5v1.5M10 16.5h4M3 12.5v3M21 12.5v3"/><circle cx="12" cy="3.5" r="1"/>`,
  zap: `<path class="f" d="M13 2 4.5 13.5H11L10 22l8.5-11.5H12Z"/><path d="M13 2 4.5 13.5H11L10 22l8.5-11.5H12Z"/>`,
  stop: `<path class="f" d="M8.2 3h7.6L21 8.2v7.6L15.8 21H8.2L3 15.8V8.2Z"/><path d="M8.2 3h7.6L21 8.2v7.6L15.8 21H8.2L3 15.8V8.2ZM9.5 9.5l5 5M14.5 9.5l-5 5"/>`,
  rocket: `<path class="f" d="M12 2.5c3 2 4.5 5 4.5 9L14.5 15h-5l-2-3.5c0-4 1.5-7 4.5-9Z"/><path d="M12 2.5c3 2 4.5 5 4.5 9L14.5 15h-5l-2-3.5c0-4 1.5-7 4.5-9ZM7.5 11.5 5 14v3l3.5-2M16.5 11.5 19 14v3l-3.5-2M10.5 18l1.5 3.5 1.5-3.5"/><circle cx="12" cy="9" r="1.6"/>`,
  live: `<circle class="solid" cx="12" cy="12" r="3.5"/><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14"/>`,
  ballot: `<path class="f" d="M8 12V4h8v8"/><rect x="4" y="12" width="16" height="9" rx="2"/><path d="M8 12V4h8v8M9 16.5h6M10 8l1.5 1.5L14 7"/>`,
  checkCircle: `<circle class="f" cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.8 2.8L16.5 9.5"/>`,
  check: `<path d="m5 12.5 4.5 4.5L19 7.5"/>`,
  lock: `<rect class="f" x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5M12 14.5v2"/><rect x="5" y="10.5" width="14" height="10" rx="2.5"/>`,
  radar: `<circle class="f" cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><path d="M12 12l6.4-6.4"/><circle class="solid" cx="12" cy="12" r="1.4"/>`,
  flame: `<path class="f" d="M12 21c-3.9 0-7-2.7-7-6.5 0-3 2-5 3.5-6.5.3 2 1.3 3 2.3 3.5C10.5 8 12 5 14 3c.5 3 5 5.5 5 11.5 0 3.8-3.1 6.5-7 6.5Z"/><path d="M12 21c-3.9 0-7-2.7-7-6.5 0-3 2-5 3.5-6.5.3 2 1.3 3 2.3 3.5C10.5 8 12 5 14 3c.5 3 5 5.5 5 11.5 0 3.8-3.1 6.5-7 6.5Z"/>`,
  back: `<path d="M19 12H5M11 6l-6 6 6 6"/>`,
  chartUp: `<path class="f" d="M3 20V14l5-5 4 4 8-8v15Z"/><path d="M3 20h18M3 14l5-5 4 4 8-8M15 5h5v5"/>`,
  chartDown: `<path class="f" d="M3 20V6l5 5 4-4 8 8v5Z"/><path d="M3 20h18M3 6l5 5 4-4 8 8M15 15h5v-5"/>`,
  image: `<rect class="f" x="3" y="4" width="18" height="16" rx="2.5"/><rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="9" cy="9.5" r="1.8"/><path d="m3.5 18 5.5-5 4 3.5 3-2.5 4.5 4"/>`,
  trash: `<path class="f" d="M6 7h12l-1 13H7Z"/><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5"/>`,
  search: `<circle class="f" cx="10.5" cy="10.5" r="6.5"/><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/>`,
  heart: `<path class="f" d="M12 20s-8-4.6-8-10.5A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 8 2.5C20 15.4 12 20 12 20Z"/><path d="M12 20s-8-4.6-8-10.5A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 8 2.5C20 15.4 12 20 12 20Z"/>`,
  shield: `<path class="f" d="M12 3 4.5 6v5.5c0 4.6 3.2 8 7.5 9.5 4.3-1.5 7.5-4.9 7.5-9.5V6Z"/><path d="M12 3 4.5 6v5.5c0 4.6 3.2 8 7.5 9.5 4.3-1.5 7.5-4.9 7.5-9.5V6Z"/>`,
  wrench: `<path class="f" d="M14.5 3.5a5 5 0 0 0-4.8 6.6L3.5 16.3a2.1 2.1 0 0 0 3 3l6.2-6.2a5 5 0 0 0 6.6-4.8l-3 3-3-.6-.6-3Z"/><path d="M14.5 3.5a5 5 0 0 0-4.8 6.6L3.5 16.3a2.1 2.1 0 0 0 3 3l6.2-6.2a5 5 0 0 0 6.6-4.8l-3 3-3-.6-.6-3Z"/>`,
  refresh: `<path d="M20 11a8 8 0 0 0-14.3-4.5L4 8.5M4 4v4.5h4.5M4 13a8 8 0 0 0 14.3 4.5l1.7-2M20 20v-4.5h-4.5"/>`,
  spark: `<path class="f" d="M12 3c.6 4.2 2.8 6.4 7 7-4.2.6-6.4 2.8-7 7-.6-4.2-2.8-6.4-7-7 4.2-.6 6.4-2.8 7-7Z"/><path d="M12 3c.6 4.2 2.8 6.4 7 7-4.2.6-6.4 2.8-7 7-.6-4.2-2.8-6.4-7-7 4.2-.6 6.4-2.8 7-7ZM18.5 16.5v4M16.5 18.5h4"/>`,
  party: `<path class="f" d="M4 20 8.5 7.5l8 8Z"/><path d="M4 20 8.5 7.5l8 8ZM6.2 14.2l3.6 3.6M13 4c.5 1.5-.5 2.5 1 3.5M19 5l-1.5 1.5M20 11c-1.5-.5-2.5.5-3.5-1M15.5 2.5v1M21.5 8.5h-1"/>`,
  megaphone: `<path class="f" d="M4 10v4h3l8 4V6L7 10Z"/><path d="M4 10v4h3l8 4V6L7 10ZM7 14l1.5 5h2.5L10 15M18 9.5a3.5 3.5 0 0 1 0 5"/>`,
  cup: `<path class="f" d="M5 9h11v6a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4Z"/><path d="M5 9h11v6a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4ZM16 11h1.5a2.5 2.5 0 0 1 0 5H16M8.5 6c-.8-1 .8-1.6 0-3M12.5 6c-.8-1 .8-1.6 0-3"/>`,
  cushion: `<path class="f" d="M4 14c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5-3.6 5.5-8 5.5-8-1.5-8-5.5Z"/><path d="M4 14c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5-3.6 5.5-8 5.5-8-1.5-8-5.5ZM12 7.5V5.5M10.5 4h3M15.5 3.5l1.5-1M8.5 3.5 7 2.5"/>`,
  disco: `<circle class="f" cx="12" cy="13" r="7"/><circle cx="12" cy="13" r="7"/><path d="M12 2v4M5 13h14M12 6c-2.5 2-2.5 12 0 14M12 6c2.5 2 2.5 12 0 14M6.5 9h11M6.5 17h11"/>`,
  mic: `<rect class="f" x="9" y="3" width="6" height="11" rx="3"/><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7"/>`,
  pizza: `<path class="f" d="M12 21 3.5 6.5a17 17 0 0 1 17 0Z"/><path d="M12 21 3.5 6.5a17 17 0 0 1 17 0ZM5 9.2a14 14 0 0 1 14 0"/><circle class="solid" cx="11" cy="12" r="1.2"/><circle class="solid" cx="14" cy="10.5" r="1"/><circle class="solid" cx="12.5" cy="15.5" r="1"/>`,
  xlogo: `<path class="solid" d="M18.9 2H22l-6.8 7.8L23.2 22h-6.3l-4.9-6.4L6.4 22H3.3l7.3-8.3L2.8 2h6.4l4.4 5.8L18.9 2Zm-1.1 18h1.7L8.3 3.9H6.5L17.8 20Z"/>`,
  link: `<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/>`,
  sofa: `<path class="f" d="M4.5 11h15v6h-15Z"/><path d="M6 11V8a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v3M3 11a1.5 1.5 0 0 1 1.5 1.5V17h15v-4.5A1.5 1.5 0 0 1 21 11M5.5 17v2.5M18.5 17v2.5M4.5 14h15"/>`,
  pot: `<path class="f" d="M5 10h14v6a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4Z"/><path d="M5 10h14v6a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4ZM3 10h18M2.5 13H5M19 13h2.5M10 7.5c-1-1.2 1-2 0-3.5M14 7.5c-1-1.2 1-2 0-3.5"/>`,
  users: `<circle class="f" cx="9" cy="8" r="3.5"/><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.4 3.2-5.5 6.5-5.5s5.9 2.1 6.5 5.5M16 4.8a3.3 3.3 0 0 1 0 6.4M18 14.8c2 .7 3.2 2.5 3.5 5.2"/>`,
  gamepad: `<path class="f" d="M7 7h10a5 5 0 0 1 4.9 5.9l-.6 3.4a2.5 2.5 0 0 1-4.3 1.2L15 15H9l-2 2.5a2.5 2.5 0 0 1-4.3-1.2l-.6-3.4A5 5 0 0 1 7 7Z"/><path d="M7 7h10a5 5 0 0 1 4.9 5.9l-.6 3.4a2.5 2.5 0 0 1-4.3 1.2L15 15H9l-2 2.5a2.5 2.5 0 0 1-4.3-1.2l-.6-3.4A5 5 0 0 1 7 7ZM7.5 9.5v4M5.5 11.5h4"/><circle class="solid" cx="15.5" cy="10.5" r="1.1"/><circle class="solid" cx="17.8" cy="12.8" r="1.1"/>`,
};

/** `<svg>` markup for one icon; extra classes color it (gold, ok, bad, pink, sky). */
export function icon(name, cls = "") {
  return `<svg class="i${cls ? ` ${cls}` : ""}" viewBox="0 0 24 24" aria-hidden="true">${P[name] || ""}</svg>`;
}

/** The brand mark: a frying pan with a sunny-side-up egg. */
export const LOGO = `<svg class="logo-svg" viewBox="0 0 32 32" aria-hidden="true">
  <path d="M10 3.5c-1.2 1.4 1.2 2.3 0 3.8M15 2.5c-1.2 1.4 1.2 2.3 0 3.8M20 3.5c-1.2 1.4 1.2 2.3 0 3.8" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" opacity=".85"/>
  <path d="M24.5 17.5h5.5" stroke="#0b0a1e" stroke-width="5" stroke-linecap="round"/>
  <path d="M24.5 17.5h5.5" stroke="#8a5a34" stroke-width="2.4" stroke-linecap="round"/>
  <path d="M2.5 15.5h23v2.5c0 4.7-4.4 8.5-11.5 8.5S2.5 22.7 2.5 18Z" fill="#2a2850" stroke="#0b0a1e" stroke-width="2" stroke-linejoin="round"/>
  <ellipse cx="14" cy="15.5" rx="11.5" ry="4.5" fill="#3d3a78" stroke="#0b0a1e" stroke-width="2"/>
  <path d="M6.5 15.2c0-2 3-3.1 6.5-3s7.5.9 7.5 2.8-3.3 3-7 3-7-.8-7-2.8Z" fill="#fff"/>
  <ellipse cx="13.5" cy="14.6" rx="3" ry="1.9" fill="#ffc83d"/>
  <ellipse cx="12.6" cy="14" rx="1" ry=".55" fill="#fffbe0"/>
</svg>`;
