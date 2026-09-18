// Pure localStorage CRUD for save slots. No DOM, no ctx — easy to reason about/unit-test standalone.
const INDEX_KEY = 'lc:saves:index';
const slotKey = (id) => `lc:save:${id}`;
const MAX_SLOT_BYTES = 2 * 1024 * 1024; // 2MB soft cap per slot, well inside typical ~5-10MB/origin budgets

function readIndex() {
  try { return JSON.parse(localStorage.getItem(INDEX_KEY) || '[]'); }
  catch { return []; }
}
function writeIndex(list) {
  localStorage.setItem(INDEX_KEY, JSON.stringify(list));
}

export function listSlots() {
  return readIndex().sort((a, b) => b.savedAt - a.savedAt);
}

export function readSlot(id) {
  try { return JSON.parse(localStorage.getItem(slotKey(id)) || 'null'); }
  catch { return null; }
}

/** Returns { ok: true, id } or { ok: false, reason }. */
export function writeSlot(id, data) {
  let json;
  try { json = JSON.stringify(data); }
  catch (e) { return { ok: false, reason: `could not serialize save: ${e.message}` }; }
  if (json.length > MAX_SLOT_BYTES) return { ok: false, reason: 'save too large — try a smaller city' };
  try {
    localStorage.setItem(slotKey(id), json);
  } catch (e) {
    return { ok: false, reason: /quota/i.test(e.name || '') ? 'browser storage is full — delete an old save first' : `save failed: ${e.message}` };
  }
  const list = readIndex().filter((s) => s.slotId !== id);
  list.push({ slotId: id, name: data.name, savedAt: data.savedAt, seed: data.seed, cityName: data.name, demoActive: data.demoActive !== false });
  writeIndex(list);
  return { ok: true, id };
}

export function deleteSlot(id) {
  localStorage.removeItem(slotKey(id));
  writeIndex(readIndex().filter((s) => s.slotId !== id));
}

export function renameSlot(id, name) {
  const data = readSlot(id);
  if (!data) return false;
  data.name = name;
  const list = readIndex().map((s) => (s.slotId === id ? { ...s, name } : s));
  writeIndex(list);
  localStorage.setItem(slotKey(id), JSON.stringify(data));
  return true;
}

export function newSlotId() {
  return (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
}
