// Hand-drawn inline SVG icons (24x24 viewBox). One style across the set: solid Lego-coloured silhouettes with a 2 px
// dark outline (paint-order: stroke, so the outline sits behind the fill), no strokes thinner than 2 px so nothing
// turns to mush at 28 px. `currentColor` for monochrome UI glyphs.
const svg = (body, extra = '') => `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" ${extra}>${body}</svg>`;

const ROAD = '#3f454c', ASPHALT = '#2b3036', WHITE = '#f4f4f4', YEL = '#F7C948', RED = '#E3342F', BLUE = '#2D8BD6',
  GREEN = '#5BB55A', DGREEN = '#2f8f47', ORANGE = '#F58624', GREY = '#9BA19D', BROWN = '#5C2E0F', TAN = '#DEC69C', INK = '#1a1e25';
// cartoon outline: drawn behind the fill so the shape keeps its full colour
const O = `stroke="${INK}" stroke-width="2" stroke-linejoin="round" paint-order="stroke"`;

export const icons = {
  // ---- brand ----
  logo: svg(`
    <path d="M4 9.5 12 6l8 3.5v8L12 21l-8-3.5z" fill="#c4281c" ${O}/>
    <path d="M4 9.5 12 13v8l-8-3.5z" fill="#a52117"/>
    <path d="M12 13l8-3.5v8L12 21z" fill="#7f1911"/>
    <ellipse cx="8.5" cy="9" rx="1.9" ry="1" fill="#e45a4f"/><ellipse cx="8.5" cy="8.3" rx="1.9" ry="1" fill="#f07064"/>
    <ellipse cx="15.5" cy="9" rx="1.9" ry="1" fill="#e45a4f"/><ellipse cx="15.5" cy="8.3" rx="1.9" ry="1" fill="#f07064"/>
    <ellipse cx="12" cy="6.9" rx="1.9" ry="1" fill="#e45a4f"/><ellipse cx="12" cy="6.2" rx="1.9" ry="1" fill="#f07064"/>
    <ellipse cx="12" cy="11.2" rx="1.9" ry="1" fill="#e45a4f"/><ellipse cx="12" cy="10.5" rx="1.9" ry="1" fill="#f07064"/>`),

  // ---- stats ----
  money: svg(`<circle cx="12" cy="12" r="9.5" fill="#f2c94c" stroke="#7a5200" stroke-width="2"/><circle cx="12" cy="12" r="6.5" fill="none" stroke="#d09a12" stroke-width="2"/>
    <path d="M12 6.8v10.4M14.6 9.3c-.4-1.1-1.4-1.6-2.6-1.6-1.5 0-2.6.8-2.6 2 0 2.6 5.2 1.3 5.2 4 0 1.3-1.2 2.1-2.6 2.1-1.4 0-2.5-.7-2.8-1.9" stroke="#7a5200" stroke-width="2" stroke-linecap="round"/>`),
  pop: svg(`<rect x="7" y="5" width="10" height="11" rx="3.5" fill="#f2c94c" stroke="#7a5200" stroke-width="2"/><rect x="9.2" y="2.6" width="5.6" height="3.2" rx="1" fill="#f2c94c" stroke="#7a5200" stroke-width="2" paint-order="stroke"/>
    <circle cx="10" cy="9.5" r="1.1" fill="#2a2a2a"/><circle cx="14" cy="9.5" r="1.1" fill="#2a2a2a"/>
    <path d="M9.4 12.3c1.6 1.7 3.6 1.7 5.2 0" stroke="#2a2a2a" stroke-width="2" stroke-linecap="round"/>
    <path d="M5.5 22v-3.2c0-1.4 1-2.4 2.4-2.4h8.2c1.4 0 2.4 1 2.4 2.4V22z" fill="${BLUE}" stroke="#123d66" stroke-width="2" paint-order="stroke"/>`),
  jobs: svg(`<rect x="3" y="7.5" width="18" height="12.5" rx="2.5" fill="#c77b2a" stroke="#6a3a0a" stroke-width="2" paint-order="stroke"/><rect x="3" y="7.5" width="18" height="5" rx="2.5" fill="#e69138"/>
    <path d="M9 7.5V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1.5" stroke="#6a3a0a" stroke-width="2.2"/><rect x="10.5" y="11" width="3" height="2.6" rx="0.6" fill="#f4f4f4"/>`),
  happy: (mood = 2) => svg(`<circle cx="12" cy="12" r="9.5" fill="#f2c94c" stroke="#7a5200" stroke-width="2"/><circle cx="8.8" cy="10" r="1.3" fill="#2a2a2a"/><circle cx="15.2" cy="10" r="1.3" fill="#2a2a2a"/>
    <path d="${mood >= 2 ? 'M7.6 13.6c2.2 3.4 6.6 3.4 8.8 0' : mood === 1 ? 'M8.4 15h7.2' : 'M7.8 16.6c2.2-3 6.2-3 8.4 0'}" stroke="#2a2a2a" stroke-width="2" stroke-linecap="round"/>`),

  // ---- weather ----
  sun: svg(`<circle cx="12" cy="12" r="4.4" fill="#ffd34d"/><g stroke="#ffd34d" stroke-width="2" stroke-linecap="round"><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/></g>`),
  moon: svg(`<path d="M15.5 3.5a8.5 8.5 0 1 0 5 15.2A9 9 0 0 1 15.5 3.5z" fill="#dfe8ff"/><circle cx="8" cy="9" r="1.2" fill="#b7c4e6"/><circle cx="11" cy="15" r="1.7" fill="#b7c4e6"/>`),
  cloudy: svg(`<circle cx="15.5" cy="8.5" r="3.6" fill="#ffd34d"/><path d="M7 19.5h9.5a4 4 0 0 0 .6-7.95A5.5 5.5 0 0 0 6.5 12.6 3.5 3.5 0 0 0 7 19.5z" fill="#e9eef5"/>`),
  rain: svg(`<path d="M7 15.5h9.5a4 4 0 0 0 .6-7.95A5.5 5.5 0 0 0 6.5 8.6 3.5 3.5 0 0 0 7 15.5z" fill="#cfd8e6"/><g stroke="#6fb7ff" stroke-width="2" stroke-linecap="round"><path d="M8.5 17.5l-1 3M12.5 17.5l-1 3M16.5 17.5l-1 3"/></g>`),
  fog: svg(`<path d="M7 13.5h9.5a4 4 0 0 0 .6-7.95A5.5 5.5 0 0 0 6.5 6.6 3.5 3.5 0 0 0 7 13.5z" fill="#cfd8e6"/><g stroke="#aeb9c9" stroke-width="2" stroke-linecap="round"><path d="M4 17h14M7 20.5h11"/></g>`),

  // ---- speed / ui glyphs ----
  pause: svg(`<rect x="6" y="5" width="4" height="14" rx="1.2" fill="currentColor"/><rect x="14" y="5" width="4" height="14" rx="1.2" fill="currentColor"/>`),
  play: svg(`<path d="M7 5.2v13.6a1 1 0 0 0 1.5.86l11-6.8a1 1 0 0 0 0-1.72l-11-6.8A1 1 0 0 0 7 5.2z" fill="currentColor"/>`),
  fast: svg(`<path d="M3 6v12l8-6zM12 6v12l8-6z" fill="currentColor"/>`),
  faster: svg(`<path d="M2 6.5v11l6-5.5zM9 6.5v11l6-5.5zM16 6.5v11l6-5.5z" fill="currentColor"/>`),
  gear: svg(`<path d="M12 8.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6zm8.4 5.1-1.9.6a6.9 6.9 0 0 1-.7 1.7l1 1.7-2.4 2.4-1.7-1a6.9 6.9 0 0 1-1.7.7l-.6 1.9h-3.4l-.6-1.9a6.9 6.9 0 0 1-1.7-.7l-1.7 1-2.4-2.4 1-1.7a6.9 6.9 0 0 1-.7-1.7l-1.9-.6v-3.4l1.9-.6c.2-.6.4-1.2.7-1.7l-1-1.7 2.4-2.4 1.7 1c.5-.3 1.1-.5 1.7-.7l.6-1.9h3.4l.6 1.9c.6.2 1.2.4 1.7.7l1.7-1 2.4 2.4-1 1.7c.3.5.5 1.1.7 1.7l1.9.6z" fill="currentColor"/>`),
  close: svg(`<path d="M5 5l14 14M19 5L5 19" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>`),
  info: svg(`<circle cx="12" cy="12" r="9" fill="none" stroke="#fff" stroke-width="2"/><path d="M12 10.5v6" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="7.6" r="1.3" fill="#fff"/>`),
  check: svg(`<path d="M5 12.5l4.5 4.5L19 7.5" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`),
  warn: svg(`<path d="M12 3.5 21.5 20h-19z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M12 9.5v5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="17" r="1.2" fill="currentColor"/>`),

  // ---- tools: roads (road plates seen from above, grass verges as Lego green) ----
  'road:street': svg(`<rect x="2" y="2" width="20" height="20" rx="2" fill="${GREEN}" ${O}/>
    <rect x="6" y="2" width="12" height="20" fill="${ROAD}"/>
    <path d="M12 4.5v3.5M12 10.3v3.5M12 16v3.5" stroke="${YEL}" stroke-width="2" stroke-linecap="round"/>`),
  'road:avenue': svg(`<rect x="2" y="2" width="20" height="20" rx="2" fill="${ROAD}" ${O}/>
    <rect x="11" y="2" width="2" height="20" fill="${GREEN}"/>
    <path d="M6.5 4.5v3M6.5 10.5v3M6.5 16.5v3M17.5 4.5v3M17.5 10.5v3M17.5 16.5v3" stroke="${WHITE}" stroke-width="2" stroke-linecap="round"/>`),
  'road:highway': svg(`<rect x="2" y="2" width="20" height="20" rx="2" fill="${ASPHALT}" ${O}/>
    <rect x="4" y="2" width="2" height="20" fill="${GREY}"/><rect x="18" y="2" width="2" height="20" fill="${GREY}"/>
    <rect x="11" y="2" width="2" height="20" fill="${YEL}"/>
    <path d="M8.5 4.5v3M8.5 10.5v3M8.5 16.5v3M15.5 4.5v3M15.5 10.5v3M15.5 16.5v3" stroke="${WHITE}" stroke-width="2" stroke-linecap="round"/>
    <rect x="3" y="7.5" width="18" height="6" rx="1.2" fill="#2a8a4a" ${O}/><rect x="6" y="9.5" width="12" height="2" rx="1" fill="#fff"/>`),
  'road:path': svg(`<rect x="2" y="2" width="20" height="20" rx="2" fill="${GREEN}" ${O}/>
    <path d="M3 19.5h6.5v-6h6v-6H21" stroke="${INK}" stroke-width="7" stroke-linejoin="round"/>
    <path d="M3 19.5h6.5v-6h6v-6H21" stroke="${TAN}" stroke-width="4.5" stroke-linejoin="round"/>
    <circle cx="7" cy="7.5" r="3.4" fill="${DGREEN}" ${O}/><rect x="6" y="9.5" width="2" height="3" fill="${BROWN}"/>`),

  // ---- tools: zones ----
  'zone:r': svg(`<rect x="2" y="19.5" width="20" height="3" rx="1" fill="${GREEN}" ${O}/><path d="M5.2 11v9h13.6v-9" fill="${WHITE}" ${O}/>
    <path d="M3.5 11 12 4l8.5 7z" fill="${RED}" ${O}/>
    <rect x="10.3" y="14" width="3.4" height="6" rx="0.6" fill="${BLUE}"/><rect x="6.6" y="12.6" width="2.6" height="2.6" fill="#a6d8ec"/><rect x="14.8" y="12.6" width="2.6" height="2.6" fill="#a6d8ec"/>`),
  'zone:c': svg(`<rect x="2" y="19.5" width="20" height="3" rx="1" fill="${BLUE}" ${O}/><rect x="4" y="8" width="16" height="12" fill="${WHITE}" ${O}/>
    <rect x="5" y="2.5" width="14" height="3.5" rx="1" fill="${YEL}" ${O}/>
    <path d="M3 6h18v3H3z" fill="${BLUE}" ${O}/><path d="M3 9c1 2.4 2.6 2.4 3.6 0 1 2.4 2.6 2.4 3.6 0 1 2.4 2.6 2.4 3.6 0 1 2.4 2.6 2.4 3.6 0 1 2.4 2.6 2.4 3.6 0V8.6H3z" fill="#7cc0f4"/>
    <rect x="6" y="12.5" width="5" height="4" fill="#a6d8ec"/><rect x="13.5" y="12.5" width="4" height="7.5" rx="0.5" fill="${RED}"/>`),
  'zone:i': svg(`<rect x="2" y="19.5" width="20" height="3" rx="1" fill="${ORANGE}" ${O}/><path d="M3 20V10.5l5 3.2v-3.2l5 3.2v-3.2l5 3.2V20z" fill="${GREY}" ${O}/>
    <rect x="15.5" y="3" width="3.2" height="9" fill="${ORANGE}" ${O}/><rect x="15.5" y="3" width="3.2" height="2" fill="#c9631a"/>
    <circle cx="19.8" cy="3.2" r="1.7" fill="#d9dde3"/><circle cx="21.5" cy="1.8" r="1.2" fill="#d9dde3"/><rect x="5" y="15.5" width="2.6" height="2.6" fill="#f2c94c"/><rect x="10" y="15.5" width="2.6" height="2.6" fill="#f2c94c"/>`),
  // dezone: a grey 2x2 plate seen from above (same outline treatment as the other bricks) with a red "no" slash across it
  'zone:none': svg(`<path d="M3 15v-5l9-5 9 5v5l-9 5z" fill="#b6bcb8" ${O}/>
    <path d="M3 10l9 5v5l-9-5z" fill="#8a908c"/><path d="M12 15l9-5v5l-9 5z" fill="#727876"/>
    <ellipse cx="7.5" cy="9.6" rx="2.1" ry="1.05" fill="#8f958f"/><ellipse cx="7.5" cy="8.8" rx="2.1" ry="1.05" fill="#d8ded9"/>
    <ellipse cx="16.5" cy="9.6" rx="2.1" ry="1.05" fill="#8f958f"/><ellipse cx="16.5" cy="8.8" rx="2.1" ry="1.05" fill="#d8ded9"/>
    <ellipse cx="12" cy="7.2" rx="2.1" ry="1.05" fill="#8f958f"/><ellipse cx="12" cy="6.4" rx="2.1" ry="1.05" fill="#d8ded9"/>
    <ellipse cx="12" cy="12.1" rx="2.1" ry="1.05" fill="#8f958f"/><ellipse cx="12" cy="11.3" rx="2.1" ry="1.05" fill="#d8ded9"/>
    <path d="M4.5 21 19.5 4.5" stroke="${INK}" stroke-width="5" stroke-linecap="round"/><path d="M4.5 21 19.5 4.5" stroke="${RED}" stroke-width="3" stroke-linecap="round"/>`),

  // ---- tools: parks ----
  park: svg(`<rect x="2" y="19.5" width="20" height="3" rx="1" fill="${DGREEN}" ${O}/><rect x="10.6" y="13" width="2.8" height="7" fill="${BROWN}" ${O}/>
    <rect x="5" y="12" width="14" height="4" rx="1.5" fill="${GREEN}" ${O}/><rect x="6.5" y="8" width="11" height="4" rx="1.5" fill="#6fc26e" ${O}/><rect x="8.5" y="4" width="7" height="4" rx="1.5" fill="#86d385" ${O}/>
    <circle cx="9.5" cy="4" r="1" fill="#a3e3a2"/><circle cx="12" cy="4" r="1" fill="#a3e3a2"/><circle cx="14.5" cy="4" r="1" fill="#a3e3a2"/>`),
  trees: svg(`<rect x="2" y="19.5" width="20" height="3" rx="1" fill="${DGREEN}" ${O}/>
    <rect x="5.3" y="14" width="2" height="6" fill="${BROWN}" ${O}/><rect x="3" y="9" width="6.4" height="5.5" rx="1.4" fill="${GREEN}" ${O}/><rect x="4" y="6" width="4.4" height="3.5" rx="1.2" fill="#86d385" ${O}/>
    <rect x="11" y="13" width="2" height="7" fill="${BROWN}" ${O}/><rect x="8.5" y="7" width="7" height="6.5" rx="1.5" fill="${GREEN}" ${O}/><rect x="9.6" y="3.4" width="4.8" height="4" rx="1.3" fill="#86d385" ${O}/>
    <rect x="16.7" y="14" width="2" height="6" fill="${BROWN}" ${O}/><rect x="14.6" y="9" width="6.4" height="5.5" rx="1.4" fill="${GREEN}" ${O}/><rect x="15.6" y="6" width="4.4" height="3.5" rx="1.2" fill="#86d385" ${O}/>`),
  plaza: svg(`<rect x="2" y="2" width="20" height="20" rx="2" fill="#a88d62" ${O}/>
    <rect x="3.5" y="3.5" width="8" height="8" rx="1" fill="${TAN}"/><rect x="12.5" y="3.5" width="8" height="8" rx="1" fill="${TAN}"/><rect x="3.5" y="12.5" width="8" height="8" rx="1" fill="${TAN}"/><rect x="12.5" y="12.5" width="8" height="8" rx="1" fill="${TAN}"/>
    <circle cx="12" cy="12" r="4.2" fill="#6fb7ff" ${O}/><circle cx="12" cy="12" r="1.8" fill="#dff1ff"/>`),

  // ---- tools: utilities ----
  'utility:power': svg(`<rect x="3.5" y="11" width="17" height="9.5" rx="1.5" fill="${GREY}" ${O}/><rect x="14.5" y="4.5" width="3.2" height="7.5" rx="1" fill="${GREY}" ${O}/>
    <path d="M12.6 10.5 9 16h2.6L10 21l5.4-6.8h-2.7l2.3-3.7z" fill="${YEL}" ${O}/>`),
  'utility:water': svg(`<path d="M6.5 21 9 12" stroke="${GREY}" stroke-width="2.3" stroke-linecap="round"/><path d="M17.5 21 15 12" stroke="${GREY}" stroke-width="2.3" stroke-linecap="round"/>
    <path d="M8 16.5h8" stroke="${GREY}" stroke-width="2" stroke-linecap="round"/>
    <rect x="6.5" y="6" width="11" height="7.5" rx="2" fill="${BLUE}" ${O}/><ellipse cx="12" cy="6" rx="5.5" ry="2.1" fill="#6fb7ff" ${O}/>`),
  'utility:firedept': svg(`<rect x="3.5" y="9" width="17" height="11" rx="1.5" fill="${RED}" ${O}/>
    <path d="M3 9 12 3l9 6" fill="${RED}" ${O}/>
    <rect x="9.4" y="13" width="5.2" height="7" rx="0.8" fill="${WHITE}" ${O}/>
    <circle cx="12" cy="6.2" r="1.3" fill="${YEL}" ${O}/>`),

  // ---- tools: hazards ----
  'hazard:fire': svg(`<path d="M12 2c-1 3-4.5 4.7-4.5 9A4.5 4.5 0 0 0 12 15.5 4.5 4.5 0 0 0 16.5 11c0-1.6-1-2.6-1.7-3.4.2 1.4-.5 2.2-1.2 2.2-1 0-1-1-.6-2 .5-1.6-.2-3.6-1-5.8z" fill="${ORANGE}" ${O}/>
    <path d="M12 9.5c-.4 1.3-2 2-2 3.8a2 2 0 0 0 4 0c0-.7-.3-1.1-.6-1.5.05.6-.2 1-.5 1-.5 0-.4-.5-.2-.9.3-.7 0-1.6-.7-2.4z" fill="${YEL}"/>`),

  // ---- tools: misc ----
  bulldoze: svg(`<rect x="8" y="9" width="10" height="7.5" rx="1.6" fill="${YEL}" ${O}/><rect x="10" y="5.5" width="6" height="4.5" rx="1" fill="${YEL}" ${O}/><rect x="11" y="6.6" width="4" height="2.3" fill="#a6d8ec"/>
    <path d="M8 12.5H5.2V18" stroke="${GREY}" stroke-width="2.4" stroke-linecap="round"/><rect x="2.4" y="11.5" width="3" height="7.5" fill="#8d9296" ${O}/>
    <rect x="7" y="16" width="12.5" height="4.6" rx="2.3" fill="${ROAD}" ${O}/><circle cx="10" cy="18.3" r="1.3" fill="#8b9299"/><circle cx="16.5" cy="18.3" r="1.3" fill="#8b9299"/>`),
  // magnifier over a yellow 2x2 brick
  select: svg(`<rect x="3" y="12" width="18" height="9.5" rx="1.5" fill="${YEL}" ${O}/><rect x="3" y="12" width="18" height="3" fill="#ffe27a"/>
    <rect x="5.5" y="9.5" width="5" height="2.5" rx="0.8" fill="${YEL}" ${O}/><rect x="13.5" y="9.5" width="5" height="2.5" rx="0.8" fill="${YEL}" ${O}/>
    <path d="M13.8 10.8 20 17" stroke="${INK}" stroke-width="5" stroke-linecap="round"/><path d="M13.8 10.8 20 17" stroke="#cfd6de" stroke-width="2.4" stroke-linecap="round"/>
    <circle cx="10" cy="7.5" r="5.2" fill="#a6d8ec" stroke="${INK}" stroke-width="2.4"/><circle cx="10" cy="7.5" r="3.2" fill="none" stroke="#fff" stroke-width="2" stroke-dasharray="6 20" stroke-linecap="round"/>`),
  keyboard: svg(`<rect x="2.5" y="6" width="19" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M6 10h1.5M9.5 10H11M13 10h1.5M16.5 10H18M6 13.5h1.5M9 13.5h6M16.5 13.5H18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`),
  map: svg(`<path d="M3 6.5 9 4l6 2.5 6-2.5v13l-6 2.5-6-2.5-6 2.5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M9 4v13M15 6.5v13" stroke="currentColor" stroke-width="2"/>`),
};
