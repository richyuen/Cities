// A small subset of icons, private to the menu module (same hand-drawn outline convention as src/ui/icons.js,
// deliberately not imported from there — every DOM-building module owns its own icon set).
const svg = (body, extra = '') => `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" ${extra}>${body}</svg>`;
const INK = '#1a1e25';

export const icons = {
  logo: svg(`
    <path d="M4 9.5 12 6l8 3.5v8L12 21l-8-3.5z" fill="#c4281c" stroke="${INK}" stroke-width="2" stroke-linejoin="round" paint-order="stroke"/>
    <path d="M4 9.5 12 13v8l-8-3.5z" fill="#a52117"/>
    <path d="M12 13l8-3.5v8L12 21z" fill="#7f1911"/>
    <ellipse cx="8.5" cy="9" rx="1.9" ry="1" fill="#e45a4f"/><ellipse cx="8.5" cy="8.3" rx="1.9" ry="1" fill="#f07064"/>
    <ellipse cx="15.5" cy="9" rx="1.9" ry="1" fill="#e45a4f"/><ellipse cx="15.5" cy="8.3" rx="1.9" ry="1" fill="#f07064"/>
    <ellipse cx="12" cy="6.9" rx="1.9" ry="1" fill="#e45a4f"/><ellipse cx="12" cy="6.2" rx="1.9" ry="1" fill="#f07064"/>
    <ellipse cx="12" cy="11.2" rx="1.9" ry="1" fill="#e45a4f"/><ellipse cx="12" cy="10.5" rx="1.9" ry="1" fill="#f07064"/>`),
  close: svg(`<path d="M5 5l14 14M19 5L5 19" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>`),
  back: svg(`<path d="M15 5l-7 7 7 7" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`),
  trash: svg(`<path d="M5 7h14M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-9 0 1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M10 11v6M14 11v6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`),
  check: svg(`<path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`),
  warn: svg(`<path d="M12 3.5 21.5 20h-19z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M12 9.5v5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="17" r="1.2" fill="currentColor"/>`),
  dice: svg(`<rect x="4" y="4" width="16" height="16" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="8.5" cy="8.5" r="1.4" fill="currentColor"/><circle cx="15.5" cy="8.5" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="8.5" cy="15.5" r="1.4" fill="currentColor"/><circle cx="15.5" cy="15.5" r="1.4" fill="currentColor"/>`),
};
