// The care game is intentionally separate from the room planner's scoring model.
export const DAY = 86400000;
export const WATER_DAYS = Object.freeze({ aloe: 14, banana: 2, seedling: 2, tomato: 2, eggplant: 3, pepper: 3, flowering_basil: 2, herb_bush: 3, curry_leaf: 5, plectranthus: 5, broadleaf_shrub: 7, raised_planter: 3 });
export const ACTIONS = Object.freeze({ water: { field: 'watered', days: 0, coins: 3, xp: 8 }, feed: { field: 'fed', days: 28, coins: 4, xp: 10 }, trim: { field: 'trimmed', days: 14, coins: 2, xp: 6 }, check: { field: 'checked', days: 1, coins: 1, xp: 3 } });
export const dayKey = (now = Date.now()) => { const d = new Date(now); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export const waterDays = (plant) => WATER_DAYS[plant.family] || 5;
export const layoutKey = (plants) => plants.map((p) => `${p.id}:${Math.round(p.x * 40)},${Math.round(p.z * 40)},${p.rot || 0}`).sort().join('|');
export function freshProgress() { return { v: 1, revision: 0, updated: 0, xp: 0, coins: 0, care: {}, log: [], achievements: [], streak: 0, lastVisit: '', bestScore: null, arrangementTier: null, days: {}, muted: false }; }
export function normalize(raw) {
  const p = freshProgress();
  if (!raw || raw.v !== 1) return p;
  for (const k of ['revision', 'updated', 'xp', 'coins', 'streak']) if (Number.isFinite(raw[k])) p[k] = Math.max(0, raw[k]);
  for (const k of ['bestScore', 'arrangementTier']) if (Number.isFinite(raw[k])) p[k] = raw[k];
  p.care = raw.care && typeof raw.care === 'object' && !Array.isArray(raw.care) ? raw.care : {};
  p.days = raw.days && typeof raw.days === 'object' && !Array.isArray(raw.days) ? raw.days : {};
  p.log = Array.isArray(raw.log) ? raw.log.slice(-128) : [];
  p.achievements = Array.isArray(raw.achievements) ? raw.achievements.filter((x) => typeof x === 'string') : [];
  p.lastVisit = typeof raw.lastVisit === 'string' ? raw.lastVisit : '';
  p.muted = !!raw.muted;
  return p;
}
export function due(plant, record, action, now = Date.now()) {
  const a = ACTIONS[action]; if (!a) return false;
  const interval = action === 'water' ? waterDays(plant) : a.days;
  return !record?.[a.field] || now - record[a.field] >= interval * DAY;
}
export function condition(plant, progress, warns = [], now = Date.now(), night = false) {
  const c = progress.care[plant.id] || {};
  const thirsty = due(plant, c, 'water', now), hungry = due(plant, c, 'feed', now), unchecked = due(plant, c, 'check', now);
  const crowded = warns.some((w) => w.startsWith(`${plant.name} overlaps `) || w.endsWith(` overlaps ${plant.name}`));
  const sat = Number.isFinite(plant._sat) ? Math.max(0, Math.min(1, plant._sat)) : 0;
  const hydration = c.watered ? Math.max(0, 1 - Math.max(0, (now - c.watered) / (waterDays(plant) * DAY) - 0.65) / 1.35) : 0;
  const health = Math.max(0, Math.min(100, Math.round(sat * 55 + hydration * 25 + (hungry ? 0 : 10) + (unchecked ? 0 : 10) - (crowded ? 20 : 0))));
  const mood = thirsty ? (health < 30 ? 'sad' : 'thirsty') : health < 50 ? 'sad' : night ? 'sleepy' : health >= 85 && !crowded ? 'happy' : 'content';
  const need = thirsty ? 'water' : sat < 0.99 ? 'sun' : crowded ? 'space' : hungry ? 'feed' : due(plant, c, 'trim', now) ? 'trim' : unchecked ? 'check' : null;
  return { health, mood, need, thirsty, hungry, crowded, sat, waterDays: waterDays(plant), watered: c.watered || 0, fed: c.fed || 0, checked: c.checked || 0 };
}
export function visit(p, plants, now = Date.now()) {
  const today = dayKey(now);
  if (p.lastVisit !== today) {
    p.streak = p.lastVisit === dayKey(now - DAY) ? p.streak + 1 : 1;
    p.lastVisit = today;
  }
  if (!p.days[today]) p.days[today] = { thirsty: plants.filter((it) => due(it, p.care[it.id], 'water', now)).map((it) => it.id), watered: [], start: layoutKey(plants), arranged: false, light: false, claims: [] };
  const keys = Object.keys(p.days).sort(); for (const k of keys.slice(0, -14)) delete p.days[k];
  return p.days[today];
}
export function level(xp) { const n = Math.floor(Math.sqrt(xp / 60)) + 1, floor = 60 * (n - 1) ** 2, next = 60 * n ** 2; return { n, floor, next, fraction: (xp - floor) / (next - floor) }; }
export function performCare(p, plant, action, now = Date.now()) {
  const a = ACTIONS[action]; if (!a) return { ok: false, reason: 'Unknown care action' };
  const record = p.care[plant.id] || {};
  if (!due(plant, record, action, now)) return { ok: false, reason: action === 'water' ? `Already watered · check again in ${waterDays(plant)} days` : 'Already cared for · let it grow' };
  const d = visit(p, [plant], now);
  record[a.field] = now; record.checked = now; p.care[plant.id] = record;
  if (action === 'water' && !d.watered.includes(plant.id)) d.watered.push(plant.id);
  p.xp += a.xp; p.coins += a.coins;
  p.log.push({ id: plant.id, action, at: now }); p.log = p.log.slice(-128);
  return { ok: true, action, coins: a.coins, xp: a.xp };
}
export function quests(p, plants, now = Date.now()) {
  const d = visit(p, plants, now), active = new Set(plants.map((it) => it.id));
  const targets = d.thirsty.filter((id) => active.has(id)), watered = targets.filter((id) => d.watered.includes(id)).length;
  return [
    { id: 'water', title: 'Water the thirsty plants', detail: targets.length ? `${watered} / ${targets.length} cared for` : 'No thirsty plants today', done: watered === targets.length, fraction: targets.length ? watered / targets.length : 1 },
    { id: 'light', title: 'A little sunshine for everyone', detail: 'Get every plant to 100% light', done: d.light, fraction: plants.length ? plants.filter((it) => it._sat >= 0.99).length / plants.length : 0 },
    { id: 'arrange', title: 'Try a new arrangement', detail: 'Move a plant in Edit, or apply a suggestion', done: d.arranged, fraction: d.arranged ? 1 : 0 },
  ].map((q) => ({ ...q, claimed: d.claims.includes(q.id) }));
}
// Conflict recovery preserves care timestamps and daily completions from both tabs.
export function mergeProgress(local, remote) {
  const a = normalize(local), b = normalize(remote), newer = a.updated > b.updated ? a : b;
  const p = { ...newer, revision: b.revision, xp: Math.max(a.xp, b.xp), coins: Math.max(a.coins, b.coins), achievements: [...new Set([...a.achievements, ...b.achievements])], care: {}, days: {} };
  for (const id of new Set([...Object.keys(a.care), ...Object.keys(b.care)])) {
    p.care[id] = {}; for (const field of ['watered', 'fed', 'trimmed', 'checked']) p.care[id][field] = Math.max(a.care[id]?.[field] || 0, b.care[id]?.[field] || 0);
  }
  for (const date of new Set([...Object.keys(a.days), ...Object.keys(b.days)])) {
    const x = a.days[date], y = b.days[date];
    p.days[date] = !x ? y : !y ? x : { ...y, thirsty: [...new Set([...x.thirsty, ...y.thirsty])], watered: [...new Set([...x.watered, ...y.watered])], claims: [...new Set([...x.claims, ...y.claims])], arranged: x.arranged || y.arranged, light: x.light || y.light };
  }
  p.log = [...new Map([...a.log, ...b.log].map((e) => [`${e.id}:${e.action}:${e.at}`, e])).values()].sort((x, y) => x.at - y.at).slice(-128);
  p.bestScore = Math.max(a.bestScore ?? -Infinity, b.bestScore ?? -Infinity); if (!Number.isFinite(p.bestScore)) p.bestScore = null;
  p.arrangementTier = Math.max(a.arrangementTier ?? -Infinity, b.arrangementTier ?? -Infinity); if (!Number.isFinite(p.arrangementTier)) p.arrangementTier = null;
  return p;
}
