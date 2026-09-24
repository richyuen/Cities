// All menu styling. Injected once as its own <style> tag (mirrors src/ui/styles.js's pattern, independent sheet,
// own class namespace so it can never collide with ui's). Same Blox-plate visual language, copied not shared.
export const CSS = `
.lc-menu {
  --lc-plate-hi: rgba(84, 91, 103, 0.94);
  --lc-plate-lo: rgba(36, 41, 49, 0.95);
  --lc-bg-soft: rgba(255, 255, 255, 0.07);
  --lc-bg-hover: rgba(255, 255, 255, 0.15);
  --lc-border: rgba(255, 255, 255, 0.24);
  --lc-ring: rgba(0, 0, 0, 0.55);
  --lc-text: #f5f7fa;
  --lc-muted: rgba(230, 236, 244, 0.7);
  --lc-yellow: #F7C948;
  --lc-red: #E3342F;
  --lc-blue: #2D8BD6;
  --lc-green: #5BB55A;
  --lc-radius: 14px;
  --lc-shadow: 0 20px 46px rgba(0, 0, 0, 0.5), 0 4px 10px rgba(0, 0, 0, 0.35);
  --lc-display: "Fredoka", "Arial Rounded MT Bold", "Segoe UI Black", "Arial Black", "Segoe UI", system-ui, sans-serif;
  --lc-item-font: "Rubik", "Segoe UI", system-ui, sans-serif;
  /* !important: index.html's #ui-root > * { pointer-events: auto } rule targets every direct child of #ui-root
     (including this root), so a plain declaration here loses the cascade and the full-viewport wrapper would
     swallow every click in the game even while closed. Descendants (.lc-menu-backdrop, .lc-modal-backdrop) opt
     back into pointer-events themselves via their own .open state, same pattern as ui's .lc-panel elements. */
  position: absolute; inset: 0; pointer-events: none !important; overflow: hidden; isolation: isolate; z-index: 50;
  font-family: "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif;
  font-size: 14px; color: var(--lc-text); line-height: 1.3;
  -webkit-font-smoothing: antialiased; user-select: none;
}
.lc-menu * { box-sizing: border-box; }
.lc-menu button { font: inherit; color: inherit; background: none; border: 0; padding: 0; margin: 0; cursor: pointer; }
.lc-menu button:focus-visible { outline: 2px solid var(--lc-yellow); outline-offset: 2px; }

/* ---------- full-viewport scrim behind title/pause ---------- */
.lc-menu-backdrop {
  position: absolute; inset: 0; pointer-events: none; opacity: 0; display: flex; align-items: center; justify-content: center;
  background: radial-gradient(ellipse at 50% 40%, rgba(8, 10, 14, 0.5) 0%, rgba(8, 10, 14, 0.86) 100%);
  -webkit-backdrop-filter: blur(7px) saturate(105%); backdrop-filter: blur(7px) saturate(105%);
  transition: opacity 0.22s ease;
}
.lc-menu-backdrop.open { pointer-events: auto; opacity: 1; }

/* Title screen: a crisp, mostly-clear view of the living demo street instead of the pause menu's full blur —
   only a directional wash behind the hero lockup (bottom-left) so its text stays legible. */
.lc-menu-backdrop--title {
  background:
    linear-gradient(100deg, rgba(6, 8, 11, 0.86) 0%, rgba(6, 8, 11, 0.6) 26%, rgba(6, 8, 11, 0.16) 50%, rgba(6, 8, 11, 0) 68%),
    linear-gradient(0deg, rgba(4, 5, 7, 0.5) 0%, rgba(4, 5, 7, 0) 38%);
  -webkit-backdrop-filter: none; backdrop-filter: none;
}

/* ---------- title hero (logo + button stack docked over the live street, no boxed card) ---------- */
.lc-menu-title-hero {
  position: absolute; left: 64px; bottom: 72px; width: 380px; max-width: calc(100vw - 96px);
  display: flex; flex-direction: column; gap: 28px;
  transform: translateY(14px); opacity: 0; transition: transform 0.32s ease, opacity 0.32s ease;
}
.lc-menu-backdrop--title.open .lc-menu-title-hero { transform: none; opacity: 1; }
.lc-menu-title-lockup { display: flex; align-items: center; gap: 14px; }
.lc-menu-title-logo { width: 60px; height: 60px; flex: none; filter: drop-shadow(0 4px 8px rgba(0, 0, 0, 0.6)); }
.lc-menu-title-logo svg { width: 100%; height: 100%; }
.lc-menu-title-word { display: flex; flex-direction: column; gap: 2px; }
.lc-menu-title-tag { font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: 2.4px; color: var(--lc-muted); text-shadow: 0 2px 6px rgba(0, 0, 0, 0.7); }
.lc-menu-title-name { font-family: var(--lc-display); font-size: 38px; font-weight: 900; letter-spacing: 0.4px; line-height: 1; text-shadow: 0 3px 0 rgba(0, 0, 0, 0.5), 0 8px 24px rgba(0, 0, 0, 0.65); }
.lc-menu-title-list .lc-menu-item {
  position: relative; height: 52px; padding-left: 22px; justify-content: flex-start; gap: 14px;
  background: rgba(18, 20, 25, 0.58); border-color: rgba(0, 0, 0, 0.3);
  -webkit-backdrop-filter: blur(8px) saturate(140%); backdrop-filter: blur(8px) saturate(140%);
  opacity: 0; transform: translateX(-8px); transition: background 0.12s, transform 0.1s, opacity 0.3s ease, transform 0.3s ease;
}
.lc-menu-backdrop--title.open .lc-menu-title-list .lc-menu-item { opacity: 1; transform: none; }
.lc-menu-backdrop--title.open .lc-menu-title-list .lc-menu-item:disabled { opacity: 0.4; }
.lc-menu-title-list .lc-menu-item:hover { background: rgba(30, 33, 40, 0.72); }
.lc-menu-title-list .lc-menu-item:hover, .lc-menu-title-list .lc-menu-item:focus-visible { transform: translateX(3px); }
.lc-menu-title-list .lc-menu-item.primary { background: linear-gradient(180deg, #ffe37a 0%, #f9cf4f 46%, #e9b224 54%, #f0bd33 100%); }
.lc-menu-title-list .lc-menu-item:nth-child(1) { transition-delay: 0.05s; }
.lc-menu-title-list .lc-menu-item:nth-child(2) { transition-delay: 0.1s; }
.lc-menu-title-list .lc-menu-item:nth-child(3) { transition-delay: 0.15s; }
.lc-menu-title-list .lc-menu-item:nth-child(4) { transition-delay: 0.2s; }
.lc-menu-title-list .lc-menu-item:nth-child(5) { transition-delay: 0.25s; }
.lc-menu-title-list .lc-menu-item::before {
  content: ""; position: absolute; left: 0; top: 50%; width: 3px; height: 0; border-radius: 2px;
  background: var(--lc-yellow); transform: translateY(-50%); transition: height 0.18s ease;
}
.lc-menu-title-list .lc-menu-item:hover::before, .lc-menu-title-list .lc-menu-item:focus-visible::before { height: 60%; }
.lc-menu-title-list .lc-menu-item.primary::before { display: none; }
.lc-menu-title-list .lc-menu-item-icon {
  width: 20px; height: 20px; flex: none; display: grid; place-items: center; color: var(--lc-muted); transition: color 0.15s;
}
.lc-menu-title-list .lc-menu-item-icon svg { width: 100%; height: 100%; }
.lc-menu-title-list .lc-menu-item:hover .lc-menu-item-icon { color: var(--lc-text); }
.lc-menu-title-list .lc-menu-item.primary .lc-menu-item-icon { color: #3a2800; }
.lc-menu-title-list .lc-menu-item-label { font-family: var(--lc-item-font); font-weight: 700; font-size: 15px; letter-spacing: 0.3px; }

/* ui's "Show HUD (H)" pill (src/ui/styles.js) only makes sense as a response to the player's own H-key toggle —
   suppress it while any menu view has hidden the HUD on its own behalf. Targeted via body class rather than a
   sibling selector since ui's root is a DOM sibling that comes BEFORE .lc-menu (init order), which CSS can't select. */
body.lc-menu-open .lc-show-ui { display: none !important; }

/* ---------- panel (Blox-plate card, same chrome as ui's .lc-panel) ---------- */
/* No explicit pointer-events here (inherits from whichever backdrop's .open state currently applies): this class
   is shared by the title/pause panel AND the confirm dialog card, and the confirm host lives permanently in the
   DOM, centered on screen, even while closed — an unconditional auto here would make it swallow clicks meant
   for the game any time no confirm is showing. */
.lc-menu-panel {
  position: relative;
  background: linear-gradient(180deg, var(--lc-plate-hi) 0%, rgba(58, 64, 74, 0.94) 42%, var(--lc-plate-lo) 100%);
  -webkit-backdrop-filter: blur(14px) saturate(140%); backdrop-filter: blur(14px) saturate(140%);
  border: 1px solid var(--lc-border); border-radius: var(--lc-radius);
  box-shadow: 0 0 0 1px var(--lc-ring), 0 3px 0 rgba(0, 0, 0, 0.42), 0 4px 0 1px var(--lc-ring), var(--lc-shadow),
    inset 0 2px 0 rgba(255, 255, 255, 0.2), inset 0 -2px 0 rgba(0, 0, 0, 0.38);
  width: 460px; max-width: calc(100vw - 32px); max-height: calc(100vh - 64px); overflow: auto;
  padding: 30px 32px 26px; display: flex; flex-direction: column; gap: 16px;
  transform: translateY(10px) scale(0.98); opacity: 0; transition: transform 0.22s ease, opacity 0.22s ease;
}
.lc-menu-backdrop.open .lc-menu-panel { transform: none; opacity: 1; }
.lc-menu-panel.lc-menu-wide { width: 620px; }

.lc-menu-title-row { display: flex; align-items: center; gap: 12px; }
.lc-menu-title-row svg { width: 40px; height: 40px; filter: drop-shadow(0 2px 2px rgba(0,0,0,0.4)); flex: none; }
.lc-menu-heading { font-family: var(--lc-display); font-size: 24px; font-weight: 900; letter-spacing: 0.3px; text-shadow: 0 1px 0 rgba(0,0,0,0.6); }
.lc-menu-sub { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.4px; color: var(--lc-muted); }
.lc-menu-back { width: 34px; height: 34px; border-radius: 8px; display: grid; place-items: center; color: var(--lc-muted); flex: none; }
.lc-menu-back:hover { background: var(--lc-bg-hover); color: var(--lc-text); }
.lc-menu-back svg { width: 18px; height: 18px; }
.lc-menu-close { position: absolute; right: 14px; top: 14px; width: 30px; height: 30px; border-radius: 8px; display: grid; place-items: center; color: var(--lc-muted); }
.lc-menu-close:hover { background: var(--lc-bg-hover); color: var(--lc-text); }
.lc-menu-close svg { width: 14px; height: 14px; }

/* ---------- buttons (menu list + generic actions) ---------- */
.lc-menu-list { display: flex; flex-direction: column; gap: 8px; }
.lc-menu-item {
  display: flex; align-items: center; justify-content: space-between; gap: 10px; height: 48px; padding: 0 16px; border-radius: 10px;
  background: linear-gradient(180deg, rgba(255,255,255,0.1), rgba(255,255,255,0.04)); border: 1px solid rgba(0,0,0,0.35);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.12), 0 1px 0 rgba(0,0,0,0.3);
  font-weight: 800; font-size: 14px; letter-spacing: 0.2px; transition: background 0.12s, transform 0.1s;
}
.lc-menu-item:hover { background: linear-gradient(180deg, rgba(255,255,255,0.2), rgba(255,255,255,0.09)); transform: translateY(-1px); }
.lc-menu-item:disabled { opacity: 0.4; pointer-events: none; }
.lc-menu-item.primary {
  background: linear-gradient(180deg, #ffe37a 0%, #f9cf4f 46%, #e9b224 54%, #f0bd33 100%); color: #3a2800;
  border: 1px solid rgba(70, 45, 0, 0.75); text-shadow: 0 1px 0 rgba(255,255,255,0.35);
  box-shadow: inset 0 2px 0 rgba(255,255,255,0.55), inset 0 -3px 0 rgba(120, 75, 0, 0.35), 0 2px 0 rgba(0,0,0,0.45), 0 4px 10px rgba(0,0,0,0.35);
}

.lc-menu-btn {
  height: 40px; padding: 0 18px; border-radius: 9px; font-weight: 800; font-size: 13px;
  background: linear-gradient(180deg, rgba(255,255,255,0.14), rgba(255,255,255,0.05)); border: 1px solid rgba(0,0,0,0.4);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.14), 0 1px 0 rgba(0,0,0,0.3); color: var(--lc-text);
}
.lc-menu-btn:hover { background: linear-gradient(180deg, rgba(255,255,255,0.24), rgba(255,255,255,0.1)); }
.lc-menu-btn:disabled { opacity: 0.4; pointer-events: none; }
.lc-menu-btn-primary {
  background: linear-gradient(180deg, #ffe37a 0%, #f9cf4f 46%, #e9b224 54%, #f0bd33 100%); color: #3a2800;
  border-color: rgba(70, 45, 0, 0.75); text-shadow: 0 1px 0 rgba(255,255,255,0.35);
  box-shadow: inset 0 2px 0 rgba(255,255,255,0.55), inset 0 -3px 0 rgba(120, 75, 0, 0.35), 0 2px 0 rgba(0,0,0,0.45);
}
.lc-menu-btn-danger {
  background: linear-gradient(180deg, #ff8078 0%, #ef4a42 46%, #c8221c 54%, #d92c26 100%); color: #fff;
  border-color: rgba(70, 0, 0, 0.8); text-shadow: 0 1px 0 rgba(0,0,0,0.35);
  box-shadow: inset 0 2px 0 rgba(255,255,255,0.4), inset 0 -3px 0 rgba(90, 0, 0, 0.35), 0 2px 0 rgba(0,0,0,0.45);
}
.lc-menu-btn-ico { width: 40px; padding: 0; display: grid; place-items: center; flex: none; }
.lc-menu-btn-ico svg { width: 16px; height: 16px; }
.lc-menu-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 4px; }

/* ---------- tabs (Options) ---------- */
.lc-menu-tabs { display: flex; gap: 4px; padding: 4px; border-radius: 10px; background: rgba(0,0,0,0.35); box-shadow: inset 0 1px 3px rgba(0,0,0,0.55); }
.lc-menu-tab { flex: 1; padding: 8px 6px; border-radius: 8px; font-size: 12px; font-weight: 800; text-align: center; color: var(--lc-muted); }
.lc-menu-tab:hover { color: var(--lc-text); background: var(--lc-bg-hover); }
.lc-menu-tab.on { color: #fff; background: linear-gradient(180deg, #7bc0f5 0%, #3e9be2 46%, #1f78c2 54%, #2a86d0 100%); box-shadow: 0 2px 0 rgba(0,0,0,0.45); }
.lc-menu-tab-body { display: flex; flex-direction: column; gap: 12px; min-height: 220px; }

/* ---------- form rows ---------- */
.lc-menu-row { display: flex; align-items: center; justify-content: space-between; gap: 14px; font-weight: 600; }
.lc-menu-row > span:first-child { color: var(--lc-muted); font-size: 13px; }
.lc-menu-col { display: flex; flex-direction: column; gap: 6px; }
.lc-menu-seg { display: flex; gap: 2px; padding: 3px; border-radius: 9px; background: rgba(0,0,0,0.35); box-shadow: inset 0 1px 3px rgba(0,0,0,0.55); }
.lc-menu-seg button { padding: 6px 12px; border-radius: 7px; font-size: 12px; font-weight: 800; color: var(--lc-muted); }
.lc-menu-seg button:hover { color: var(--lc-text); background: var(--lc-bg-hover); }
.lc-menu-seg button.on { color: #fff; background: linear-gradient(180deg, #7bc0f5 0%, #3e9be2 46%, #1f78c2 54%, #2a86d0 100%); }
.lc-menu-switch { width: 44px; height: 24px; border-radius: 12px; background: rgba(0,0,0,0.45); position: relative; box-shadow: inset 0 1px 3px rgba(0,0,0,0.6); border: 1px solid rgba(0,0,0,0.5); flex: none; }
.lc-menu-switch::after { content: ""; position: absolute; top: 2px; left: 2px; width: 18px; height: 18px; border-radius: 50%; background: radial-gradient(circle at 40% 32%, #fff, #d5dbe3 60%, #a9b2bd); transition: transform 0.15s; box-shadow: 0 1px 2px rgba(0,0,0,0.5); }
.lc-menu-switch.on { background: linear-gradient(180deg, #7ccb7b, #3f9a3e); }
.lc-menu-switch.on::after { transform: translateX(20px); }
.lc-menu-slider { -webkit-appearance: none; appearance: none; width: 150px; height: 10px; border-radius: 5px; background: rgba(0,0,0,0.4); box-shadow: inset 0 1px 3px rgba(0,0,0,0.6); border: 1px solid rgba(0,0,0,0.5); }
.lc-menu-slider::-webkit-slider-thumb { -webkit-appearance: none; width: 16px; height: 16px; border-radius: 50%; background: radial-gradient(circle at 40% 32%, #fff, #ffe27a 45%, #e0a51c); border: 2px solid rgba(50,32,0,0.85); box-shadow: 0 2px 4px rgba(0,0,0,0.5); }
.lc-menu-input {
  height: 36px; padding: 0 12px; border-radius: 8px; background: rgba(0,0,0,0.35); border: 1px solid rgba(0,0,0,0.5); color: var(--lc-text);
  box-shadow: inset 0 1px 3px rgba(0,0,0,0.55); font: inherit; font-weight: 600; width: 100%;
}
.lc-menu-input:focus-visible { outline: 2px solid var(--lc-yellow); outline-offset: 1px; }
.lc-menu-select { height: 36px; padding: 0 10px; border-radius: 8px; background: rgba(0,0,0,0.35); border: 1px solid rgba(0,0,0,0.5); color: var(--lc-text); font: inherit; font-weight: 700; }
.lc-menu-hint { font-size: 12px; color: var(--lc-muted); }
.lc-menu-keys { display: grid; grid-template-columns: auto 1fr; gap: 6px 12px; font-size: 12px; color: var(--lc-muted); align-items: center; }
.lc-menu-key { display: inline-block; min-width: 22px; padding: 2px 6px; border-radius: 5px; text-align: center; font-size: 11px; font-weight: 800; color: var(--lc-text);
  background: linear-gradient(180deg, rgba(255,255,255,0.18), rgba(255,255,255,0.08)); border: 1px solid rgba(0,0,0,0.5); }

/* ---------- save/load slot list ---------- */
.lc-menu-slotlist { display: flex; flex-direction: column; gap: 8px; max-height: 320px; overflow-y: auto; }
.lc-menu-slot { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 10px; background: var(--lc-bg-soft); border: 1px solid rgba(0,0,0,0.35); }
.lc-menu-slot-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.lc-menu-slot-name { font-weight: 800; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lc-menu-slot-meta { font-size: 11px; color: var(--lc-muted); }
.lc-menu-slot-actions { display: flex; gap: 6px; flex: none; }
.lc-menu-empty { text-align: center; padding: 24px 10px; color: var(--lc-muted); font-size: 13px; }

/* ---------- confirm dialog (stacks above the title/pause panel) ---------- */
.lc-modal-backdrop {
  position: absolute; inset: 0; pointer-events: none; opacity: 0; display: flex; align-items: center; justify-content: center;
  background: rgba(4, 6, 9, 0.55); transition: opacity 0.18s ease; z-index: 2;
}
.lc-modal-backdrop.open { pointer-events: auto; opacity: 1; }
.lc-menu-confirm { width: 360px; }
.lc-menu-confirm-title { margin: 0; font-family: var(--lc-display); font-size: 17px; font-weight: 900; }
.lc-menu-confirm-body { font-size: 13px; color: var(--lc-muted); }

/* ---------- credits ---------- */
.lc-menu-credits { font-size: 13px; color: var(--lc-muted); display: flex; flex-direction: column; gap: 8px; }
.lc-menu-credits b { color: var(--lc-text); }
`;
