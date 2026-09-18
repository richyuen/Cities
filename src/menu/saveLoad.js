import { h, setText } from './dom.js';
import { icons } from './icons.js';
import { listSlots, writeSlot, deleteSlot, renameSlot, newSlotId } from './storage.js';
import { serializeSave } from './serialize.js';

function fmtDate(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function renderSaveLoad(ctx, nav) {
  const nameInput = h('input', { class: 'lc-menu-input', type: 'text', maxlength: '40', placeholder: 'Save name', value: ctx.params?.get('city') || 'Brickport' });
  const saveBtn = h('button', { class: 'lc-menu-btn lc-menu-btn-primary', onclick: () => {
    const name = nameInput.value.trim() || 'Untitled City';
    const data = serializeSave(ctx, { name });
    const res = writeSlot(newSlotId(), data);
    if (res.ok) { nav.notify(`Saved "${name}"`, 'success'); refreshList(); }
    else nav.notify(res.reason, 'error');
  } }, 'Save');

  const list = h('div', { class: 'lc-menu-slotlist' });

  function refreshList() {
    list.innerHTML = '';
    const slots = listSlots();
    if (!slots.length) { list.append(h('div', { class: 'lc-menu-empty' }, 'No saved cities yet.')); return; }
    for (const s of slots) list.append(buildRow(s));
  }

  function buildRow(slot) {
    const nameEl = h('div', { class: 'lc-menu-slot-name' }, slot.name);
    nameEl.addEventListener('click', () => startRename(slot, nameEl));
    const metaEl = h('div', { class: 'lc-menu-slot-meta' }, `${fmtDate(slot.savedAt)} · seed ${slot.seed}`);
    const loadBtn = h('button', { class: 'lc-menu-btn', title: 'Load', onclick: async () => {
      const ok = await nav.confirm({ title: `Load "${slot.name}"?`, body: 'Your current, unsaved progress will be lost unless you save it first.', okLabel: 'Load', danger: true });
      if (ok) nav.reloadLoadCity(slot);
    } }, 'Load');
    const overwriteBtn = h('button', { class: 'lc-menu-btn lc-menu-btn-ico', title: 'Overwrite with current city', html: icons.check, onclick: async () => {
      const ok = await nav.confirm({ title: `Overwrite "${slot.name}"?`, body: 'This replaces the saved city with your current one.', okLabel: 'Overwrite', danger: true });
      if (!ok) return;
      const data = serializeSave(ctx, { name: slot.name });
      const res = writeSlot(slot.slotId, data);
      if (res.ok) { nav.notify(`Overwrote "${slot.name}"`, 'success'); refreshList(); }
      else nav.notify(res.reason, 'error');
    } });
    const deleteBtn = h('button', { class: 'lc-menu-btn lc-menu-btn-ico', title: 'Delete', html: icons.trash, onclick: async () => {
      const ok = await nav.confirm({ title: `Delete "${slot.name}"?`, body: 'This cannot be undone.', okLabel: 'Delete', danger: true });
      if (!ok) return;
      deleteSlot(slot.slotId);
      refreshList();
    } });
    return h('div', { class: 'lc-menu-slot' },
      h('div', { class: 'lc-menu-slot-info' }, nameEl, metaEl),
      h('div', { class: 'lc-menu-slot-actions' }, loadBtn, overwriteBtn, deleteBtn));
  }

  function startRename(slot, nameEl) {
    const input = h('input', { class: 'lc-menu-input', value: slot.name });
    nameEl.replaceWith(input);
    input.focus(); input.select();
    const commit = () => {
      const v = input.value.trim();
      if (v && v !== slot.name) { renameSlot(slot.slotId, v); slot.name = v; }
      setText(nameEl, slot.name);
      input.replaceWith(nameEl);
    };
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); if (e.key === 'Escape') { input.replaceWith(nameEl); } });
  }

  refreshList();

  return h('div', { class: 'lc-menu-panel lc-menu-wide' },
    h('div', { class: 'lc-menu-title-row' },
      h('button', { class: 'lc-menu-back', title: 'Back', html: icons.back, onclick: () => nav.back() }),
      h('div', { class: 'lc-menu-heading' }, 'Save / Load')),
    h('div', { class: 'lc-menu-col' }, h('span', { class: 'lc-menu-hint' }, 'Save current city as'),
      h('div', { style: 'display:flex;gap:8px' }, nameInput, saveBtn)),
    h('div', { class: 'lc-menu-hint' }, 'Saved cities'),
    list);
}
