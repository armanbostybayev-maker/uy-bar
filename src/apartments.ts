// Pure apartment filtering / sorting and the favourites + compare store. No DOM except storage.

export interface IndexedApartment {
  apartmentId: string;
  sourceId: string;
  projectSlug: string;
  projectName: string;
  projectStatus: string;
  projectClass: string | null;
  deadline: string | null;
  district: string | null;
  url: string;
  catalogComplete: boolean;
  number: string | null;
  rooms: number | null;
  area: number | null;
  price: number | null;
  priceM2: number | null;
  floor: number | null;
  floorsMax: number | null;
  status: string;
  planImageUrl: string | null;
  buildingId: string | null;
  sectionId: string | null;
  updatedAt: string;
}

export interface AptFilter {
  rooms: number[]; // 4 = «4+»
  priceMax: number; // млн ₸, 0 = any
  areaMin: number; // м², 0 = any
  floorMin: number; // 0 = any
  notFirst: boolean;
  notLast: boolean;
  project: string; // slug, '' = any
}
export type SortKey = 'price' | 'area' | 'priceM2' | 'floor';
export interface AptSort { key: SortKey; dir: 'asc' | 'desc' }

export const emptyAptFilter = (): AptFilter => ({ rooms: [], priceMax: 0, areaMin: 0, floorMin: 0, notFirst: false, notLast: false, project: '' });
export const isFilterEmpty = (f: AptFilter) => JSON.stringify(f) === JSON.stringify(emptyAptFilter());

type Filterable = Pick<IndexedApartment, 'rooms' | 'price' | 'area' | 'floor' | 'projectSlug'> & { floorsMax?: number | null };

export function matchesApt(a: Filterable, f: AptFilter): boolean {
  if (f.rooms.length && !(a.rooms != null && f.rooms.some((r) => (r >= 4 ? a.rooms! >= 4 : a.rooms === r)))) return false;
  if (f.priceMax && !(a.price != null && a.price <= f.priceMax * 1e6)) return false;
  if (f.areaMin && !(a.area != null && a.area >= f.areaMin)) return false;
  if (f.floorMin && !(a.floor != null && a.floor >= f.floorMin)) return false;
  if (f.notFirst && a.floor === 1) return false;
  if (f.notLast && a.floor != null && a.floorsMax != null && a.floor >= a.floorsMax) return false;
  if (f.project && a.projectSlug !== f.project) return false;
  return true;
}

/** Stable sort; missing values always go last regardless of direction. */
export function sortApts<T extends Partial<Record<SortKey, number | null>> & { apartmentId: string }>(list: T[], s: AptSort): T[] {
  const k = s.key, m = s.dir === 'asc' ? 1 : -1;
  return list
    .map((a, i) => ({ a, i }))
    .sort((x, y) => {
      const vx = x.a[k], vy = y.a[k];
      if (vx == null && vy == null) return x.i - y.i;
      if (vx == null) return 1;
      if (vy == null) return -1;
      return (vx - vy) * m || x.i - y.i;
    })
    .map((x) => x.a);
}

// ---------------------------------------------------------------- favourites & compare
export const COMPARE_MAX = 4;
export const COMPARE_MIN = 2;

export interface Storage { getItem(k: string): string | null; setItem(k: string, v: string): void }
const memory = (): Storage => { const m = new Map<string, string>(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) }; };
function safeStorage(): Storage {
  try { const s = window.localStorage; s.setItem('__t', '1'); s.removeItem('__t'); return s; } catch { return memory(); }
}

export class ShortList {
  private ids: string[];
  constructor(private key: string, private max = Infinity, private storage: Storage = safeStorage(), private listeners: (() => void)[] = []) {
    let parsed: unknown = [];
    try { parsed = JSON.parse(storage.getItem(key) || '[]'); } catch { parsed = []; }
    this.ids = Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string').slice(0, max === Infinity ? undefined : max) : [];
  }
  list() { return [...this.ids]; }
  has(id: string) { return this.ids.includes(id); }
  get size() { return this.ids.length; }
  get full() { return this.ids.length >= this.max; }
  /** returns false when the list is full and `id` is new */
  add(id: string): boolean {
    if (this.has(id)) return true;
    if (this.full) return false;
    this.ids.push(id); this.save(); return true;
  }
  remove(id: string) { const n = this.ids.length; this.ids = this.ids.filter((x) => x !== id); if (n !== this.ids.length) this.save(); }
  toggle(id: string): boolean { if (this.has(id)) { this.remove(id); return true; } return this.add(id); }
  clear() { this.ids = []; this.save(); }
  /** drop ids that no longer exist in the data */
  prune(valid: Set<string>) { const n = this.ids.length; this.ids = this.ids.filter((x) => valid.has(x)); if (n !== this.ids.length) this.save(); }
  onChange(fn: () => void) { this.listeners.push(fn); }
  private save() {
    try { this.storage.setItem(this.key, JSON.stringify(this.ids)); } catch { /* quota / private mode — keep in memory */ }
    this.listeners.forEach((f) => f());
  }
}

/** Rows for the compare table; `diff` marks rows whose values differ between apartments. */
export function compareRows(apts: IndexedApartment[]) {
  const fmt = (v: number | null | undefined, unit = '') => (v == null ? '—' : `${v.toLocaleString('ru-RU')}${unit}`);
  const rows: { label: string; values: string[]; best?: number }[] = [
    { label: 'ЖК', values: apts.map((a) => a.projectName) },
    { label: 'Квартира', values: apts.map((a) => `№${a.number ?? '—'}`) },
    { label: 'Комнат', values: apts.map((a) => (a.rooms == null ? '—' : String(a.rooms))) },
    { label: 'Площадь', values: apts.map((a) => fmt(a.area, ' м²')), best: bestIndex(apts.map((a) => a.area), 'max') },
    { label: 'Этаж', values: apts.map((a) => (a.floor == null ? '—' : `${a.floor}${a.floorsMax ? ` из ${a.floorsMax}` : ''}`)) },
    { label: 'Цена', values: apts.map((a) => fmt(a.price, ' ₸')), best: bestIndex(apts.map((a) => a.price), 'min') },
    { label: 'Цена за м²', values: apts.map((a) => fmt(a.priceM2, ' ₸')), best: bestIndex(apts.map((a) => a.priceM2), 'min') },
    { label: 'Срок сдачи', values: apts.map((a) => a.deadline || '—') },
    { label: 'Район', values: apts.map((a) => a.district || '—') },
    { label: 'Статус', values: apts.map((a) => a.status) },
    { label: 'Корпус / секция', values: apts.map((a) => (a.buildingId || a.sectionId ? `${a.buildingId ?? '—'} / ${a.sectionId ?? '—'}` : 'не опубликованы')) },
    { label: 'Данные на', values: apts.map((a) => a.updatedAt) },
  ];
  return rows.map((r) => ({ ...r, diff: new Set(r.values).size > 1 }));
}
function bestIndex(vals: (number | null)[], mode: 'min' | 'max'): number | undefined {
  const ok = vals.map((v, i) => ({ v, i })).filter((x) => x.v != null) as { v: number; i: number }[];
  if (ok.length < 2) return undefined;
  const best = ok.reduce((b, x) => ((mode === 'min' ? x.v < b.v : x.v > b.v) ? x : b));
  return ok.filter((x) => x.v === best.v).length === 1 ? best.i : undefined;
}
