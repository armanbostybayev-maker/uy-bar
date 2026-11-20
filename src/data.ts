export type LngLat = [number, number];

export interface BuildingGeom {
  buildingId: string;
  ring: LngLat[];
  floors: number;
  name: string;
  facades?: [string, string] | null;
  geometry?: { source: 'overrides' | 'osm' | 'schematic'; accuracy: 'manual' | 'footprint' | 'schematic'; osmId: number | null };
}

/** Coverage of the apartment catalogue for one project (null total = not published). */
export interface Catalog { total: number | null; loaded: number; complete: boolean; updatedAt: string }
export interface Provenance { provider: string; method: string; url: string; fetchedAt: string }

export interface Project {
  slug: string;
  name: string;
  class: string | null;
  status: string;
  deadline: string | null;
  deadlineYear: number | null;
  address: string | null;
  district: string | null;
  url: string;
  image: string | null;
  images: string[];
  description: string | null;
  priceFrom: number | null;
  priceFromM2: number | null;
  rooms: number[];
  coords: LngLat;
  coordsFlags: string[];
  floorsMax: number | null;
  apartmentsTotal: number | null;
  apartmentsLoaded: number;
  tour3d: string | null;
  geometrySource: 'overrides' | 'osm' | 'schematic';
  buildingCount: number;
  buildings: BuildingGeom[];
  osmIds?: number[];
  catalog: Catalog;
  /** floors / sections / entrances quoted in the text of the svoydom.kz project page */
  siteFacts: { floorsMin: number | null; floorsMax: number | null; sections: number | null; entrances: number | null; quotes: string[] } | null;
}

/** Strict topology: project → building → section → floor → apartment. One apartmentId everywhere. */
export interface Apartment {
  apartmentId: string;
  sourceId: string;
  xmlId: string | null;
  projectSlug: string;
  buildingId: string | null;
  sectionId: string | null;
  floorId: string | null;
  floor: number | null;
  position: number | null;
  /** 'floor-only' = only the floor number is known; never draw it as an exact unit on the building */
  topology: 'floor-only' | 'unit';
  number: string | null;
  rooms: number | null;
  type: string | null;
  area: number | null;
  price: number | null;
  priceM2: number | null;
  status: 'свободна' | 'бронь' | 'продана' | 'недоступна';
  planImageUrl: string | null;
  provenance: Provenance;
  updatedAt: string;
}

export interface Section { sectionId: string; buildingId: string; name: string }
export interface ProjectDetail {
  schema: 'svoydom3d/detail@2';
  slug: string;
  updatedAt: string;
  catalog: Catalog & { source: Provenance };
  buildings: BuildingGeom[];
  sections: Section[];
  apartments: Apartment[];
}
export interface Poi { id: string; cat: 'school' | 'kindergarten' | 'medicine' | 'shop' | 'park' | 'stop'; name: string | null; coords: LngLat; d: number }

const base = import.meta.env.BASE_URL + 'data/';
const cache = new Map<string, Promise<unknown>>();
function load<T>(file: string): Promise<T> {
  if (!cache.has(file)) cache.set(file, fetch(base + file).then((r) => { if (!r.ok) throw new Error(`${file}: HTTP ${r.status}`); return r.json(); }).catch((e) => { cache.delete(file); throw e; }));
  return cache.get(file) as Promise<T>;
}

export const loadProjects = () => load<{ fetchedAt: string; projects: Project[] }>('projects.json');
export const loadDetail = (slug: string) => load<ProjectDetail>(`apts/${slug}.json`);
export const forgetDetail = (slug: string) => cache.delete(`apts/${slug}.json`);
export const loadIndex = () => load<{ schema: string; updatedAt: string; apartments: import('./apartments').IndexedApartment[] }>('apartments-index.json');
export const loadDistrict = (slug: string) => load<Poi[]>(`district/${slug}.json`).catch(() => [] as Poi[]);

export const fmtMln = (v: number | null | undefined) => (v == null ? '—' : (v / 1e6).toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + ' млн');
export const fmtTg = (v: number | null | undefined) => (v == null ? '—' : Math.round(v).toLocaleString('ru-RU') + ' ₸');
export const fmtDate = (iso: string) => iso.split('-').reverse().join('.');
export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
