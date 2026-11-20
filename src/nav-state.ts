// URL ⇄ app state. Pure functions (no DOM) so they can be unit-tested.
// Query keys:
//   st  statuses (b = строится, c = сдан; "-" = none)   cl classes (k, kp, bz)   r rooms (1..4)
//   y   deadline year   bmax budget, млн ₸   d district
//   p   project slug    b building id   s section id   f floor   a apartment source id
//   t   panel tab (district | about)   v view (list | search | fav | compare)   cam lng,lat,zoom,bearing,pitch
//   apartment search / project list:  ar rooms  apx price max  aa area min  af floor min  anf not first  anl not last  ap project  so sort (price|area|priceM2|floor)-(asc|desc)  pv project tab view (list)

import { emptyAptFilter, type AptFilter, type AptSort } from './apartments';

export type View = 'map' | 'list' | 'search' | 'fav' | 'compare';
export interface CameraState { lng: number; lat: number; zoom: number; bearing: number; pitch: number }
export interface AppState {
  statuses: string[];
  classes: string[];
  rooms: number[];
  year: number;
  budget: number;
  district: string;
  project: string | null;
  building: string | null;
  section: string | null;
  floor: number | null;
  apartment: string | null;
  tab: 'apts' | 'district' | 'about';
  view: View;
  camera: CameraState | null;
  aptFilter: AptFilter;
  sort: AptSort;
  /** inside a project: chessboard or sortable list */
  projectView: 'chess' | 'list';
}

// default: all statuses — completed projects are shown (blue) next to the ones under construction (green)
export const DEFAULT_STATUSES: string[] = [];
const STATUS = { строится: 'b', сдан: 'c' } as Record<string, string>;
const CLASS = { Комфорт: 'k', 'Комфорт+': 'kp', Бизнес: 'bz' } as Record<string, string>;
const inv = (m: Record<string, string>) => Object.fromEntries(Object.entries(m).map(([k, v]) => [v, k]));
const STATUS_INV = inv(STATUS), CLASS_INV = inv(CLASS);

export const emptyState = (): AppState => ({
  statuses: [...DEFAULT_STATUSES], classes: [], rooms: [], year: 0, budget: 0, district: '',
  project: null, building: null, section: null, floor: null, apartment: null, tab: 'apts', view: 'map', camera: null,
  aptFilter: emptyAptFilter(), sort: { key: 'price', dir: 'asc' }, projectView: 'chess',
});

const r = (x: number, d: number) => String(Math.round(x * 10 ** d) / 10 ** d);

export function encodeState(s: AppState): string {
  const q = new URLSearchParams();
  const st = [...s.statuses].sort().join(',') === [...DEFAULT_STATUSES].sort().join(',') ? null : s.statuses.length ? s.statuses.map((x) => STATUS[x]).filter(Boolean).join(',') : '-';
  if (st) q.set('st', st);
  if (s.classes.length) q.set('cl', s.classes.map((x) => CLASS[x]).filter(Boolean).join(','));
  if (s.rooms.length) q.set('r', [...s.rooms].sort().join(','));
  if (s.year) q.set('y', String(s.year));
  if (s.budget) q.set('bmax', String(s.budget));
  if (s.district) q.set('d', s.district);
  if (s.view !== 'map') q.set('v', s.view);
  const af = s.aptFilter;
  if (af.rooms.length) q.set('ar', [...af.rooms].sort().join(','));
  if (af.priceMax) q.set('apx', String(af.priceMax));
  if (af.areaMin) q.set('aa', String(af.areaMin));
  if (af.floorMin) q.set('af', String(af.floorMin));
  if (af.notFirst) q.set('anf', '1');
  if (af.notLast) q.set('anl', '1');
  if (af.project) q.set('ap', af.project);
  if (s.sort.key !== 'price' || s.sort.dir !== 'asc') q.set('so', `${s.sort.key}-${s.sort.dir}`);
  if (s.projectView === 'list') q.set('pv', 'list');
  if (s.project) {
    q.set('p', s.project);
    if (s.building) q.set('b', s.building);
    if (s.section) q.set('s', s.section);
    if (s.floor != null) q.set('f', String(s.floor));
    if (s.apartment) q.set('a', s.apartment);
    if (s.tab !== 'apts') q.set('t', s.tab);
  }
  if (s.camera) { const c = s.camera; q.set('cam', [r(c.lng, 5), r(c.lat, 5), r(c.zoom, 2), r(c.bearing, 1), r(c.pitch, 1)].join(',')); }
  const out = q.toString();
  return out ? `?${out}` : '';
}

const ints = (v: string | null, min: number, max: number) => (v ? v.split(',').map(Number).filter((n) => Number.isInteger(n) && n >= min && n <= max) : []);
const slugOk = (v: string | null) => (v && /^[\w.-]{1,80}$/.test(v) ? v : null);

export function decodeState(search: string, hash = ''): AppState {
  const q = new URLSearchParams(search);
  const s = emptyState();
  const st = q.get('st');
  if (st === '-') s.statuses = [];
  else if (st) s.statuses = st.split(',').map((x) => STATUS_INV[x]).filter(Boolean);
  s.classes = (q.get('cl') || '').split(',').map((x) => CLASS_INV[x]).filter(Boolean);
  s.rooms = ints(q.get('r'), 1, 4);
  const y = Number(q.get('y')); if (Number.isInteger(y) && y >= 2000 && y <= 2100) s.year = y;
  const b = Number(q.get('bmax')); if (Number.isFinite(b) && b > 0 && b <= 1000) s.budget = b;
  s.district = (q.get('d') || '').slice(0, 80);
  const v = q.get('v');
  s.view = v === 'list' || v === 'search' || v === 'fav' || v === 'compare' ? v : 'map';
  const num = (k: string, max: number) => { const n = Number(q.get(k)); return q.get(k) && Number.isFinite(n) && n > 0 && n <= max ? n : 0; };
  s.aptFilter = { rooms: ints(q.get('ar'), 1, 4), priceMax: num('apx', 1000), areaMin: num('aa', 1000), floorMin: num('af', 200), notFirst: q.get('anf') === '1', notLast: q.get('anl') === '1', project: slugOk(q.get('ap')) || '' };
  const so = /^(price|area|priceM2|floor)-(asc|desc)$/.exec(q.get('so') || '');
  if (so) s.sort = { key: so[1] as AptSort['key'], dir: so[2] as AptSort['dir'] };
  s.projectView = q.get('pv') === 'list' ? 'list' : 'chess';
  // legacy deep links: #slug
  s.project = slugOk(q.get('p')) || slugOk(decodeURIComponent(hash.replace(/^#/, '')) || null);
  if (s.project) {
    s.building = slugOk(q.get('b')?.replace(/:/g, '.') ?? null) ? q.get('b') : null;
    s.section = slugOk(q.get('s')?.replace(/:/g, '.') ?? null) ? q.get('s') : null;
    const f = Number(q.get('f')); if (q.get('f') && Number.isInteger(f) && f >= 1 && f <= 200) s.floor = f;
    s.apartment = slugOk(q.get('a'));
    const t = q.get('t'); if (t === 'district' || t === 'about') s.tab = t;
  }
  const cam = (q.get('cam') || '').split(',').map(Number);
  if (cam.length === 5 && cam.every(Number.isFinite) && Math.abs(cam[0]) <= 180 && Math.abs(cam[1]) <= 85 && cam[2] >= 0 && cam[2] <= 24 && cam[4] >= 0 && cam[4] <= 85)
    s.camera = { lng: cam[0], lat: cam[1], zoom: cam[2], bearing: cam[3], pitch: cam[4] };
  return s;
}
