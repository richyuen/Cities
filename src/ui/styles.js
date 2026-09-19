// All HUD styling. Injected once as a single <style> tag by index.js. No external fonts or files.
// Art direction: panels are glossy dark-stone-grey Lego plates with a real stud row along the top edge, a bevelled top
// highlight, a dark bottom lip and a 1 px dark outer ring; primary actions are glossy Lego-yellow / red bricks.

// 16x12 stud tile (inline SVG), 10 px cylinder at 16 px pitch: the plate's own plastic seen from above — top face in
// the plate-hi tone with a crisp specular arc, side in the plate-lo tone, only a 0.6 px 30 % edge (no heavy outline).
const STUD_TILE = encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='16' height='12' viewBox='0 0 16 12'>
<defs><linearGradient id='t' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='#7b838f'/><stop offset='1' stop-color='#5b626e'/></linearGradient>
<linearGradient id='s' x1='0' y1='0' x2='1' y2='0'><stop offset='0' stop-color='#242930'/><stop offset='.45' stop-color='#343a44'/><stop offset='1' stop-color='#1f242b'/></linearGradient></defs>
<path d='M3 4.8v4a5 2.4 0 0 0 10 0v-4z' fill='url(#s)'/>
<path d='M3 4.8v4a5 2.4 0 0 0 10 0v-4' fill='none' stroke='rgba(0,0,0,.3)' stroke-width='.6'/>
<ellipse cx='8' cy='4.8' rx='5' ry='2.4' fill='url(#t)' stroke='rgba(0,0,0,.3)' stroke-width='.6'/>
<path d='M4.2 4.2a4.3 1.8 0 0 1 7.6 0' fill='none' stroke='#fff' stroke-opacity='.85' stroke-width='1.1' stroke-linecap='round'/>
<ellipse cx='6.8' cy='4.9' rx='1.7' ry='.6' fill='rgba(255,255,255,.2)'/>
</svg>`);

// 20x20 stud tile for coloured brick swatches (white highlight / dark shadow only, so it works over any colour).
// The stud is centred in the tile so `background-repeat: space` can lay whole studs in both axes.
const SWATCH_STUD = encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 20 20'>
<path d='M4.5 9.6v2.6a5.5 2.6 0 0 0 11 0V9.6z' fill='rgba(0,0,0,.3)'/>
<ellipse cx='10' cy='9.6' rx='5.5' ry='2.6' fill='rgba(255,255,255,.14)' stroke='rgba(0,0,0,.3)' stroke-width='.6'/>
<path d='M6 8.9a4.4 1.9 0 0 1 8 0' fill='none' stroke='rgba(255,255,255,.6)' stroke-width='.9' stroke-linecap='round'/>
<ellipse cx='8.6' cy='9.3' rx='1.8' ry='.6' fill='rgba(255,255,255,.3)'/>
</svg>`);

export const CSS = `
.lc-hud {
  --lc-plate-hi: rgba(84, 91, 103, 0.94);
  --lc-plate-lo: rgba(36, 41, 49, 0.95);
  --lc-bg: rgba(20, 25, 33, 0.92);
  --lc-bg-soft: rgba(255, 255, 255, 0.07);
  --lc-bg-hover: rgba(255, 255, 255, 0.15);
  --lc-border: rgba(255, 255, 255, 0.24);
  --lc-ring: rgba(0, 0, 0, 0.55);
  --lc-text: #f5f7fa;
  --lc-muted: rgba(230, 236, 244, 0.7);
  --lc-red: #E3342F;
  --lc-yellow: #F7C948;
  --lc-blue: #2D8BD6;
  --lc-green: #5BB55A;
  --lc-orange: #F58624;
  --lc-radius: 12px;
  --lc-shadow: 0 12px 28px rgba(0, 0, 0, 0.42), 0 2px 4px rgba(0, 0, 0, 0.3);
  --lc-display: "Arial Rounded MT Bold", "Segoe UI Black", "Arial Black", "Segoe UI", system-ui, sans-serif;
  position: absolute; inset: 0; pointer-events: none; overflow: hidden; isolation: isolate;
  font-family: "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif;
  font-size: 13px; color: var(--lc-text); line-height: 1.25;
  -webkit-font-smoothing: antialiased; user-select: none;
}
.lc-hud * { box-sizing: border-box; }
.lc-hud.lc-hidden > *:not(.lc-show-ui) { display: none !important; }
.lc-hud svg { display: block; }
:where(.lc-hud) button { font: inherit; color: inherit; background: none; border: 0; padding: 0; margin: 0; cursor: pointer; }
.lc-hud button:focus-visible { outline: 2px solid var(--lc-yellow); outline-offset: 2px; }
.lc-num { font-family: var(--lc-display); font-weight: 900; font-variant-numeric: tabular-nums; letter-spacing: 0.2px; text-shadow: 0 1px 0 rgba(0,0,0,0.6), 0 2px 3px rgba(0,0,0,0.35); }

/* ---------- Lego plate ---------- */
/* stacking tiers (all inside the isolated .lc-hud root): plates 1, info card 2, toasts 3, settings popover 5, tooltip 8 */
.lc-panel {
  position: absolute; pointer-events: auto; isolation: isolate; z-index: 1;
  background: linear-gradient(180deg, var(--lc-plate-hi) 0%, rgba(58, 64, 74, 0.94) 42%, var(--lc-plate-lo) 100%);
  -webkit-backdrop-filter: blur(14px) saturate(140%); backdrop-filter: blur(14px) saturate(140%);
  border: 1px solid var(--lc-border); border-radius: var(--lc-radius);
  box-shadow: 0 0 0 1px var(--lc-ring), 0 3px 0 rgba(0, 0, 0, 0.42), 0 4px 0 1px var(--lc-ring), var(--lc-shadow),
    inset 0 2px 0 rgba(255, 255, 255, 0.2), inset 0 -2px 0 rgba(0, 0, 0, 0.38);
}
/* gloss: a soft specular band across the top third of every plate */
.lc-panel::before {
  content: ""; position: absolute; inset: 1px; border-radius: calc(var(--lc-radius) - 2px); pointer-events: none; z-index: -1;
  background: linear-gradient(180deg, rgba(255,255,255,0.13) 0%, rgba(255,255,255,0.05) 34%, rgba(255,255,255,0) 52%);
}
/* stud row on the top edge of a plate (half above the edge, half rooted in it). space-repeat lays N whole 16 px tiles across
   the strip and spreads the remainder into the gaps, so no plate ever shows a partial stud; the strip starts past the
   corner radius (+ 4 px) so the first stud is clear of the corner tangent. */
.lc-studs {
  position: absolute; left: calc(var(--lc-radius) + 4px); right: calc(var(--lc-radius) + 4px); top: -8px; height: 12px; pointer-events: none; z-index: 1;
  background: url("data:image/svg+xml,${STUD_TILE}") left top / 16px 12px space no-repeat;
  filter: drop-shadow(0 1px 0 rgba(0,0,0,0.35));
}
.lc-divider { width: 1px; align-self: stretch; margin: 6px 4px; background: linear-gradient(180deg, transparent, var(--lc-border) 30%, var(--lc-border) 70%, transparent); flex: none; }

/* glossy brick buttons (yellow = primary / active, red = danger, blue = option, green = on) */
.lc-brick, .lc-speed button.on, .lc-tool.on, .lc-seg button.on, .lc-gear.on, .lc-toast-more {
  background: linear-gradient(180deg, #ffe37a 0%, #f9cf4f 46%, #e9b224 54%, #f0bd33 100%); color: #3a2800;
  border: 1px solid rgba(70, 45, 0, 0.75) !important;
  box-shadow: inset 0 2px 0 rgba(255,255,255,0.55), inset 0 -3px 0 rgba(120, 75, 0, 0.35), 0 2px 0 rgba(0,0,0,0.45), 0 4px 10px rgba(0,0,0,0.35);
  text-shadow: 0 1px 0 rgba(255,255,255,0.35);
}
.lc-brick.red, .lc-speed button.on.pause, .lc-tool.danger.on {
  background: linear-gradient(180deg, #ff8078 0%, #ef4a42 46%, #c8221c 54%, #d92c26 100%); color: #fff;
  border-color: rgba(70, 0, 0, 0.8) !important; text-shadow: 0 1px 0 rgba(0,0,0,0.35);
  box-shadow: inset 0 2px 0 rgba(255,255,255,0.4), inset 0 -3px 0 rgba(90, 0, 0, 0.35), 0 2px 0 rgba(0,0,0,0.45), 0 4px 10px rgba(0,0,0,0.35);
}
.lc-seg button.on {
  background: linear-gradient(180deg, #7bc0f5 0%, #3e9be2 46%, #1f78c2 54%, #2a86d0 100%); color: #fff;
  border-color: rgba(0, 30, 70, 0.8) !important; text-shadow: 0 1px 0 rgba(0,0,0,0.35);
  box-shadow: inset 0 2px 0 rgba(255,255,255,0.4), inset 0 -3px 0 rgba(0, 40, 90, 0.35), 0 2px 0 rgba(0,0,0,0.45);
}

/* ---------- top-left: brand + stats ---------- */
.lc-top-left { left: 16px; top: 18px; height: 62px; display: flex; align-items: center; gap: 6px; padding: 0 14px 0 10px; }
.lc-brand { display: flex; align-items: center; gap: 9px; padding-right: 6px; }
.lc-brand svg { width: 32px; height: 32px; filter: drop-shadow(0 2px 2px rgba(0,0,0,0.4)); }
.lc-city { display: flex; flex-direction: column; }
.lc-city-name { font-family: var(--lc-display); font-size: 16px; font-weight: 900; letter-spacing: 0.2px; text-shadow: 0 1px 0 rgba(0,0,0,0.6); }
.lc-city-sub { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.2px; color: var(--lc-muted); }
.lc-stat { display: flex; align-items: center; gap: 9px; padding: 0 10px; height: 44px; border-radius: 10px; }
.lc-stat-ico { width: 32px; height: 32px; border-radius: 8px; display: grid; place-items: center; border: 1px solid rgba(0,0,0,0.5);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.35), inset 0 -2px 0 rgba(0,0,0,0.25), 0 1px 0 rgba(0,0,0,0.4); }
.lc-stat-ico svg { width: 20px; height: 20px; filter: drop-shadow(0 1px 1px rgba(0,0,0,0.35)); }
.lc-stat-ico.money { background: linear-gradient(180deg, #ffd964, #e0a91e); }
.lc-stat-ico.pop { background: linear-gradient(180deg, #5fa9e6, #1f6fb5); }
.lc-stat-ico.jobs { background: linear-gradient(180deg, #ff9d45, #d56a12); }
.lc-stat-ico.happy { background: linear-gradient(180deg, #7ccb7b, #3f9a3e); }
.lc-stat-txt { display: flex; flex-direction: column; min-width: 60px; }
.lc-stat-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: var(--lc-muted); }
.lc-stat-value { font-size: 16px; }
.lc-stat-value.neg { color: #ff8a80; }

/* ---------- top-right: weather, clock, speed, tod, settings ---------- */
.lc-top-right { right: 16px; top: 18px; height: 62px; display: flex; align-items: center; gap: 6px; padding: 0 8px 0 14px; }
.lc-weather { display: flex; align-items: center; gap: 8px; padding-right: 6px; }
.lc-weather svg { width: 26px; height: 26px; filter: drop-shadow(0 1px 1px rgba(0,0,0,0.4)); }
.lc-weather-txt { font-size: 13px; font-weight: 700; }
.lc-clock { display: flex; flex-direction: column; align-items: flex-end; padding: 0 8px; min-width: 78px; }
.lc-day { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: var(--lc-muted); }
.lc-time { font-size: 20px; letter-spacing: 0.5px; }
.lc-speed { display: flex; gap: 3px; padding: 4px; border-radius: 10px; background: rgba(0,0,0,0.35); box-shadow: inset 0 1px 3px rgba(0,0,0,0.6), 0 1px 0 rgba(255,255,255,0.1); }
.lc-speed button { width: 34px; height: 32px; border-radius: 8px; display: grid; place-items: center; color: var(--lc-muted); border: 1px solid transparent; transition: background 0.12s, color 0.12s; }
.lc-speed button svg { width: 18px; height: 18px; }
.lc-speed button:hover { background: var(--lc-bg-hover); color: var(--lc-text); }
.lc-tod { display: flex; align-items: center; gap: 6px; padding: 0 6px; }
.lc-tod svg { width: 16px; height: 16px; opacity: 0.85; }
.lc-tod input[type=range] {
  -webkit-appearance: none; appearance: none; width: 150px; height: 12px; border-radius: 6px; margin: 0; cursor: pointer;
  background: linear-gradient(90deg, #17203d 0%, #2a2f5e 18%, #f19a5b 25%, #9fd3ff 40%, #bfe6ff 50%, #9fd3ff 62%, #f58624 75%, #3a2455 83%, #17203d 100%);
  box-shadow: inset 0 1px 2px rgba(0,0,0,0.55), 0 1px 0 rgba(255,255,255,0.1); border: 1px solid rgba(0,0,0,0.5);
}
.lc-tod input[type=range]::-webkit-slider-thumb {
  -webkit-appearance: none; width: 18px; height: 18px; border-radius: 50%; background: radial-gradient(circle at 40% 32%, #fff, #ffe27a 45%, #e0a51c);
  border: 2px solid rgba(50,32,0,0.85); box-shadow: 0 2px 4px rgba(0,0,0,0.5), inset 0 -2px 0 rgba(120,75,0,0.35);
}
.lc-gear { width: 40px; height: 40px; border-radius: 9px; display: grid; place-items: center; color: var(--lc-muted); border: 1px solid transparent; transition: background 0.12s, color 0.12s; }
.lc-gear svg { width: 22px; height: 22px; transition: transform 0.3s; }
.lc-gear:hover { background: var(--lc-bg-hover); color: var(--lc-text); }
.lc-gear.on svg { transform: rotate(60deg); }

/* ---------- settings popover (anchored under the gear, with a caret) ---------- */
.lc-settings { right: 16px; top: 94px; width: 300px; padding: 16px 16px 14px; display: none; flex-direction: column; gap: 12px; z-index: 5; }
.lc-settings.open { display: flex; }
.lc-caret { position: absolute; right: 18px; top: -9px; width: 16px; height: 16px; transform: rotate(45deg); border-radius: 3px 0 0 0;
  background: var(--lc-plate-hi); border-left: 1px solid var(--lc-border); border-top: 1px solid var(--lc-border); box-shadow: -1px -1px 0 var(--lc-ring); }
.lc-settings h3 { margin: 0; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 1.4px; color: var(--lc-muted); }
.lc-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; font-weight: 600; }
.lc-seg { display: flex; gap: 2px; padding: 3px; border-radius: 9px; background: rgba(0,0,0,0.35); box-shadow: inset 0 1px 3px rgba(0,0,0,0.55); }
.lc-seg button { padding: 5px 11px; border-radius: 7px; font-size: 12px; font-weight: 800; color: var(--lc-muted); border: 1px solid transparent; }
.lc-seg button:hover { color: var(--lc-text); background: var(--lc-bg-hover); }
.lc-switch { width: 44px; height: 24px; border-radius: 12px; background: rgba(0,0,0,0.45); position: relative; box-shadow: inset 0 1px 3px rgba(0,0,0,0.6), 0 1px 0 rgba(255,255,255,0.1); transition: background 0.15s; border: 1px solid rgba(0,0,0,0.5); }
.lc-switch::after { content: ""; position: absolute; top: 2px; left: 2px; width: 18px; height: 18px; border-radius: 50%; background: radial-gradient(circle at 40% 32%, #fff, #d5dbe3 60%, #a9b2bd); transition: transform 0.15s; box-shadow: 0 1px 2px rgba(0,0,0,0.5); }
.lc-switch.on { background: linear-gradient(180deg, #7ccb7b, #3f9a3e); }
.lc-switch.on::after { transform: translateX(20px); }
.lc-keys { display: grid; grid-template-columns: auto 1fr; gap: 5px 10px; font-size: 12px; color: var(--lc-muted); align-items: center; }
.lc-key { display: inline-block; min-width: 22px; padding: 2px 6px; border-radius: 5px; text-align: center; font-size: 11px; font-weight: 800; color: var(--lc-text);
  background: linear-gradient(180deg, rgba(255,255,255,0.18), rgba(255,255,255,0.08)); border: 1px solid rgba(0,0,0,0.5); box-shadow: 0 2px 0 rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.25); font-family: inherit; }
/* the open popover pushes the inspect card below itself (hud.js sets --lc-info-top to the popover's bottom + 12 px) */

/* ---------- toasts (top-centre; max 3 visible + "+N" pill, one line each) ---------- */
.lc-toasts { position: absolute; top: 96px; left: 50%; transform: translateX(-50%); display: flex; flex-direction: column; gap: 8px; align-items: flex-start; pointer-events: none; width: 360px; z-index: 3; }
.lc-toast {
  pointer-events: auto; display: flex; align-items: center; gap: 10px; width: 360px; height: 40px; padding: 0 14px 0 8px;
  background: linear-gradient(180deg, rgba(70, 76, 87, 0.95), rgba(34, 39, 47, 0.96)); -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px);
  border: 1px solid var(--lc-border); border-radius: 10px;
  box-shadow: 0 0 0 1px var(--lc-ring), 0 2px 0 rgba(0,0,0,0.4), 0 3px 0 1px var(--lc-ring), 0 8px 20px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.2);
  font-weight: 700; font-size: 13px; animation: lc-toast-in 0.28s cubic-bezier(.2,.9,.3,1.2);
}
.lc-toast > div:last-child { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.lc-toast.out { animation: lc-toast-out 0.25s ease-in forwards; }
.lc-toast.lc-hid { display: none; }
.lc-toast-ico { width: 26px; height: 26px; border-radius: 7px; display: grid; place-items: center; flex: none; border: 1px solid rgba(0,0,0,0.5);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.35), inset 0 -2px 0 rgba(0,0,0,0.25); }
.lc-toast-ico svg { width: 16px; height: 16px; }
.lc-toast.info .lc-toast-ico { background: linear-gradient(180deg, #5fa9e6, #1f6fb5); }
.lc-toast.success .lc-toast-ico { background: linear-gradient(180deg, #7ccb7b, #3f9a3e); }
.lc-toast.warn .lc-toast-ico { background: linear-gradient(180deg, #ffd964, #e0a91e); color: #3a2800; }
.lc-toast.error .lc-toast-ico { background: linear-gradient(180deg, #ff7068, #c8221c); }
.lc-toast-more { pointer-events: auto; display: none; height: 24px; padding: 0 12px; border-radius: 12px; font-size: 12px; font-weight: 800; align-items: center; }
.lc-toast-more.open { display: flex; }
@keyframes lc-toast-in { from { opacity: 0; transform: translateY(-14px) scale(0.96); } to { opacity: 1; transform: none; } }
@keyframes lc-toast-out { to { opacity: 0; transform: translateY(-8px); } }

/* ---------- info panel (right) ---------- */
.lc-info { right: 16px; top: var(--lc-info-top, 96px); width: 320px; max-height: calc(100% - 300px - var(--lc-info-top, 96px)); display: none; flex-direction: column; overflow: visible; z-index: 2; transition: top 0.15s ease, max-height 0.15s ease; }
.lc-info.open { display: flex; }
.lc-info-head { display: flex; align-items: center; justify-content: space-between; padding: 12px 10px 8px 16px; border-bottom: 1px solid rgba(0,0,0,0.4); box-shadow: 0 1px 0 rgba(255,255,255,0.08); }
.lc-info-title { font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 1.4px; color: var(--lc-muted); }
.lc-close { width: 28px; height: 28px; border-radius: 7px; display: grid; place-items: center; color: var(--lc-muted); }
.lc-close:hover { background: var(--lc-bg-hover); color: var(--lc-text); }
.lc-close svg { width: 14px; height: 14px; }
.lc-info-body { padding: 14px 16px 16px; overflow: auto; font-size: 13px; border-radius: 0 0 var(--lc-radius) var(--lc-radius); }
.lc-info-body h2 { margin: 0 0 3px; font-family: var(--lc-display); font-size: 18px; font-weight: 900; text-shadow: 0 1px 0 rgba(0,0,0,0.6); }
.lc-info-body h4 { margin: 12px 0 6px; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 1.2px; color: var(--lc-muted); }
.lc-info-body p { margin: 4px 0; color: var(--lc-muted); }
.lc-info-body .lc-kv { display: grid; grid-template-columns: 1fr auto; gap: 6px 12px; font-weight: 600; }
.lc-info-body .lc-kv span:nth-child(even) { font-weight: 800; font-variant-numeric: tabular-nums; text-align: right; }
.lc-info-body .lc-tag { display: inline-block; padding: 2px 8px; border-radius: 6px; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.8px; color: #fff;
  border: 1px solid rgba(0,0,0,0.5); box-shadow: inset 0 1px 0 rgba(255,255,255,0.35), 0 1px 0 rgba(0,0,0,0.4); text-shadow: 0 1px 0 rgba(0,0,0,0.3); }
.lc-info-body .lc-tag.r { background: linear-gradient(180deg, #7ccb7b, #3f9a3e); } .lc-info-body .lc-tag.c { background: linear-gradient(180deg, #5fa9e6, #1f6fb5); } .lc-info-body .lc-tag.i { background: linear-gradient(180deg, #ff9d45, #d56a12); }
.lc-info-body .lc-bar { height: 10px; border-radius: 5px; background: rgba(0,0,0,0.4); overflow: hidden; margin: 4px 0 8px; box-shadow: inset 0 1px 2px rgba(0,0,0,0.6); }
.lc-info-body .lc-bar > i { display: block; height: 100%; border-radius: 5px; background: linear-gradient(180deg, #8fdc8e, var(--lc-green) 55%, #3f9a3e); box-shadow: inset 0 1px 0 rgba(255,255,255,0.4); }
/* brick swatch: colour via --lc-sw (or a plain background); studded top face (60 px = 3 whole 20 px stud rows, whole
   studs across via space-repeat) + darker 20 px side face */
.lc-info-body .lc-swatch { --lc-sw: #c4281c; position: relative; width: 100%; height: 80px; border-radius: 8px; margin: 6px 0 12px; overflow: hidden;
  background: linear-gradient(180deg, rgba(255,255,255,0.26) 0, rgba(255,255,255,0.08) 60px, rgba(0,0,0,0.24) 60px, rgba(0,0,0,0.44) 100%), var(--lc-sw);
  border: 1px solid rgba(0,0,0,0.55); box-shadow: 0 2px 0 rgba(0,0,0,0.4), 0 6px 14px rgba(0,0,0,0.35); }
.lc-info-body .lc-swatch::before { content: ""; position: absolute; left: 4px; right: 4px; top: 0; height: 60px;
  background: url("data:image/svg+xml,${SWATCH_STUD}") left top / 20px 20px space; }

/* ---------- RCI demand (bottom-left) ---------- */
.lc-rci { left: 16px; bottom: 16px; width: 124px; padding: 12px 12px 10px; display: flex; flex-direction: column; gap: 8px; }
.lc-rci-title { font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 1.3px; color: var(--lc-muted); text-align: center; }
.lc-rci-bars { display: flex; justify-content: space-between; align-items: flex-end; height: 92px; padding: 0 6px; }
.lc-rci-col { display: flex; flex-direction: column; align-items: center; gap: 5px; height: 100%; justify-content: flex-end; }
.lc-rci-track { width: 18px; height: 72px; border-radius: 5px; background: rgba(0,0,0,0.42); box-shadow: inset 0 1px 3px rgba(0,0,0,0.65), 0 1px 0 rgba(255,255,255,0.1); position: relative; overflow: hidden; border: 1px solid rgba(0,0,0,0.5); }
.lc-rci-fill { position: absolute; left: 0; right: 0; bottom: 0; height: 0%; border-radius: 4px; transition: height 0.4s ease; box-shadow: inset 0 2px 0 rgba(255,255,255,0.4), inset 0 -2px 0 rgba(0,0,0,0.25); }
.lc-rci-col.r .lc-rci-fill { background: linear-gradient(180deg, #8ad989, var(--lc-green)); }
.lc-rci-col.c .lc-rci-fill { background: linear-gradient(180deg, #74b9f2, var(--lc-blue)); }
.lc-rci-col.i .lc-rci-fill { background: linear-gradient(180deg, #ffb46a, var(--lc-orange)); }
.lc-rci-lbl { font-family: var(--lc-display); font-size: 12px; font-weight: 900; text-shadow: 0 1px 0 rgba(0,0,0,0.6); }
.lc-rci-col.r .lc-rci-lbl { color: #8ad989; } .lc-rci-col.c .lc-rci-lbl { color: #74b9f2; } .lc-rci-col.i .lc-rci-lbl { color: #ffb46a; }

/* ---------- utilities coverage (stacked above RCI, bottom-left) ---------- */
.lc-utilities { left: 16px; bottom: 168px; width: 124px; padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; }
.lc-util-row { display: flex; align-items: center; justify-content: space-between; font-size: 12px; font-weight: 700; }
.lc-util-lbl { color: var(--lc-muted); }
.lc-util-pct { font-family: var(--lc-display); font-weight: 900; }

/* ---------- status line: bottom-centre, directly above the toolbar (never under it) ---------- */
.lc-status { position: absolute; left: 50%; bottom: 126px; transform: translateX(-50%); pointer-events: auto; display: none; align-items: center; gap: 8px; height: 32px; padding: 0 14px 0 10px;
  max-width: min(640px, calc(100vw - 420px)); background: linear-gradient(180deg, rgba(70, 76, 87, 0.95), rgba(34, 39, 47, 0.96)); -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px);
  border: 1px solid var(--lc-border); border-radius: 9px; box-shadow: 0 0 0 1px var(--lc-ring), 0 2px 0 rgba(0,0,0,0.4), 0 3px 0 1px var(--lc-ring), 0 6px 16px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.2);
  font-weight: 700; font-size: 13px; white-space: nowrap; }
.lc-status.open { display: flex; }
.lc-status::before { content: ""; flex: none; width: 9px; height: 9px; border-radius: 50%; background: radial-gradient(circle at 40% 35%, #fff2b0, var(--lc-yellow) 55%, #d69d12); box-shadow: 0 0 8px var(--lc-yellow), 0 0 0 1px rgba(0,0,0,0.5); }
.lc-status > span { overflow: hidden; text-overflow: ellipsis; min-width: 0; }

/* ---------- toolbar (bottom-centre) ---------- */
.lc-toolbar { left: 50%; bottom: 16px; transform: translateX(-50%); display: flex; align-items: flex-end; gap: 2px; padding: 10px 10px 10px; }
.lc-group { display: flex; flex-direction: column; align-items: center; gap: 5px; padding: 0 4px; }
.lc-group-lbl { font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: 1.3px; color: var(--lc-muted); }
.lc-group-btns { display: flex; gap: 4px; }
.lc-tool { width: 64px; height: 60px; border-radius: 10px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px;
  background: linear-gradient(180deg, rgba(255,255,255,0.1), rgba(255,255,255,0.04)); border: 1px solid rgba(0,0,0,0.35);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.12), 0 1px 0 rgba(0,0,0,0.3); transition: background 0.12s, transform 0.12s, box-shadow 0.15s, border-color 0.12s; }
.lc-tool svg { width: 28px; height: 28px; filter: drop-shadow(0 1px 1px rgba(0,0,0,0.55)); }
.lc-tool span { font-size: 12px; font-weight: 700; letter-spacing: 0.1px; color: var(--lc-text); text-shadow: 0 1px 0 rgba(0,0,0,0.5); }
.lc-tool:hover { background: linear-gradient(180deg, rgba(255,255,255,0.2), rgba(255,255,255,0.09)); transform: translateY(-2px); border-color: rgba(0,0,0,0.5); }
.lc-tool.on { transform: translateY(-2px); }
.lc-tool.on span { color: #3a2800; text-shadow: 0 1px 0 rgba(255,255,255,0.35); }
.lc-tool.danger.on span { color: #fff; text-shadow: 0 1px 0 rgba(0,0,0,0.35); }
.lc-toolbar .lc-divider { margin: 18px 5px 2px; height: 60px; align-self: flex-end; }

/* ---------- minimap (bottom-right) ---------- */
.lc-minimap { right: 16px; bottom: 16px; padding: 10px 10px 8px; display: flex; flex-direction: column; gap: 7px; width: 216px; }
.lc-minimap canvas { width: 194px; height: 194px; border-radius: 7px; display: block; cursor: crosshair; border: 1px solid rgba(0,0,0,0.6);
  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.12), 0 2px 0 rgba(0,0,0,0.35), 0 3px 8px rgba(0,0,0,0.4); }
.lc-minimap-foot { display: flex; justify-content: space-between; align-items: center; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 1.2px; color: var(--lc-muted); padding: 0 2px; }
.lc-legend { display: grid; grid-template-columns: repeat(3, 1fr); gap: 3px 8px; padding: 0 2px; font-size: 11px; font-weight: 700; color: var(--lc-muted); }
.lc-legend span { display: flex; align-items: center; gap: 5px; white-space: nowrap; }
.lc-legend i { display: inline-block; width: 9px; height: 9px; border-radius: 2px; border: 1px solid rgba(0,0,0,0.55); box-shadow: inset 0 1px 0 rgba(255,255,255,0.35); flex: none; }
.lc-legend i.hatch { background: repeating-linear-gradient(45deg, #146e5a 0 2px, #2a9478 2px 4px) !important; }

/* ---------- tooltip ---------- */
.lc-tooltip { position: absolute; left: 0; top: 0; pointer-events: none; display: none; padding: 6px 10px; border-radius: 7px; font-size: 12px; font-weight: 700; white-space: nowrap;
  background: rgba(16, 20, 27, 0.94); border: 1px solid var(--lc-border); box-shadow: 0 0 0 1px var(--lc-ring), var(--lc-shadow); color: var(--lc-text); z-index: 8; will-change: transform; }
.lc-tooltip.open { display: block; }
.lc-tooltip .lc-key { margin-left: 8px; }

/* ---------- show-ui pill (when HUD hidden) ---------- */
.lc-show-ui { position: absolute; right: 16px; top: 16px; pointer-events: auto; display: none; padding: 7px 12px; border-radius: 9px; font-weight: 800; font-size: 12px; color: #3a2800; }
.lc-hud.lc-hidden .lc-show-ui { display: block; }
`;
