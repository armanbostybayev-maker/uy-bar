import maplibregl, { Map as MLMap, GeoJSONSource, MapGeoJSONFeature } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import './style-p2.css';
import './style-layers.css';
import { mapStyle } from './style-map';
import { loadProjects, loadDetail, loadDistrict, forgetDetail, loadIndex, esc, fmtMln, fmtTg, fmtDate, type Project, type ProjectDetail, type Apartment, type Poi, type LngLat } from './data';
import { floorsGeoJSON, floorAvailability, buildingHeight, bbox, circle, pointInRing, distM, type FloorAvailability } from './geo';
import { mortgageWidget } from './mortgage';
import { encodeState, decodeState, emptyState, type AppState, type View } from './nav-state';
import { ShortList, COMPARE_MAX, emptyAptFilter, matchesApt, sortApts, type IndexedApartment, type AptFilter, type AptSort } from './apartments';
import { renderSearch, renderFavs, renderCompare, renderViewError, aptFilterForm, bindAptFilter, aptRow, type ViewCtx } from './views';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const isMobile = () => window.matchMedia('(max-width: 760px)').matches;
// prefers-reduced-motion: camera moves become instant, the intro turn is skipped
const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const dur = (ms: number) => (reduceMotion() ? 0 : ms);

// status colours: under construction = green, completed = blue
const COLORS = {
  building: '#2fbf71', completed: '#4f7cff', buildingSchematic: '#9fe0bb', completedSchematic: '#a9bcff',
  accent: '#3a5bff', mixed: '#7f8a96',
  dim: '#d9d5cc', free: '#22b07d', none: '#6b7280', noData: '#d8d4cb', hover: '#ffc94d', selected: '#ff6b2c',
};
const POI_META: Record<Poi['cat'], { label: string; color: string }> = {
  school: { label: 'Школы', color: '#5b6cff' },
  kindergarten: { label: 'Детские сады', color: '#f08a5d' },
  medicine: { label: 'Медицина и аптеки', color: '#e04f6a' },
  shop: { label: 'Магазины', color: '#9b6bd6' },
  park: { label: 'Парки', color: '#3fa36b' },
  stop: { label: 'Остановки', color: '#7d8590' },
};
const WALK = (d: number) => Math.max(1, Math.round((d * 1.3) / 80)); // по прямой ×1.3, 80 м/мин

// ---------------------------------------------------------------- state
interface Filters { classes: Set<string>; statuses: Set<string>; year: number | 0; rooms: Set<number>; budget: number; district: string }
const state = {
  projects: [] as Project[],
  fetchedAt: '',
  filters: { classes: new Set(), statuses: new Set(), year: 0, rooms: new Set(), budget: 0, district: '' } as Filters,
  sel: null as Project | null,
  detail: null as ProjectDetail | null,
  selFloor: null as number | null,
  hoverFloor: null as number | null,
  tab: 'apts' as 'apts' | 'district' | 'about',
  apt: null as Apartment | null,
  aptFilter: emptyAptFilter() as AptFilter,
  sort: { key: 'price', dir: 'asc' } as AptSort,
  projectView: 'chess' as 'chess' | 'list',
};

const matches = (p: Project) => {
  const f = state.filters;
  if (f.classes.size && !f.classes.has(p.class || '')) return false;
  if (f.statuses.size && !f.statuses.has(p.status)) return false;
  if (f.year && !(p.deadlineYear && p.deadlineYear <= f.year)) return false;
  if (f.rooms.size && !p.rooms.some((r) => f.rooms.has(r))) return false;
  if (f.budget && !(p.priceFrom && p.priceFrom <= f.budget * 1e6)) return false;
  if (f.district && p.district !== f.district) return false;
  return true;
};

// ---------------------------------------------------------------- URL / history
// Levels pushed to history: city → project → apartment. Filters, floor, tab and camera are
// replaced in place, so Back walks the levels and each entry remembers its camera.
let viewMode: View = 'map';
let restoring = true; // true while applying a URL (and until the first one is applied) — suppresses history writes
function currentState(): AppState {
  const f = state.filters;
  const c = mapOK && map.getCenter ? map.getCenter() : null;
  return {
    ...emptyState(),
    statuses: [...f.statuses], classes: [...f.classes], rooms: [...f.rooms], year: f.year, budget: f.budget, district: f.district,
    project: state.sel?.slug ?? null, building: null, section: null,
    floor: state.selFloor, apartment: state.apt?.sourceId ?? null, tab: state.tab, view: viewMode,
    aptFilter: state.aptFilter, sort: state.sort, projectView: state.projectView,
    camera: c ? { lng: c.lng, lat: c.lat, zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() } : null,
  };
}
const nav = {
  depth(): number { return (history.state as { depth?: number } | null)?.depth ?? 0; },
  url() { return location.pathname + encodeState(currentState()); },
  push() { if (!restoring) history.pushState({ depth: nav.depth() + 1 }, '', nav.url()); },
  replace() { if (!restoring) history.replaceState({ depth: nav.depth() }, '', nav.url()); },
  /** Go up one level: real history Back when we pushed it, otherwise do it in place. */
  back(fallback: () => void) {
    if (nav.depth() > 0) history.back();
    else { fallback(); nav.replace(); }
  },
};
let camTimer = 0;
const saveCameraSoon = () => { clearTimeout(camTimer); camTimer = window.setTimeout(() => nav.replace(), 350); };

const announce = (msg: string) => { const el = document.getElementById('live'); if (el) { el.textContent = ''; requestAnimationFrame(() => (el.textContent = msg)); } };
const focusHeading = () => (document.querySelector('#panel-body [data-focus-heading]') as HTMLElement | null)?.focus({ preventScroll: false });

// ---------------------------------------------------------------- map
// If WebGL is unavailable the app keeps working as a list: `map` becomes an inert stand-in
// whose every method is a no-op, and the list view is forced on.
function inertMap(): MLMap {
  const f: unknown = new Proxy(function () {}, {
    get: (_t, k) => (k === 'then' ? undefined : k === Symbol.toPrimitive ? () => 0 : f),
    apply: () => f,
  });
  return f as MLMap;
}
const initialUrl = decodeState(location.search, location.hash);
let mapOK = !new URLSearchParams(location.search).has('nomap');
let map: MLMap;
try {
  if (!mapOK) throw new Error('map disabled by ?nomap');
  map = new maplibregl.Map({
    container: 'map',
    style: mapStyle,
    center: initialUrl.camera ? [initialUrl.camera.lng, initialUrl.camera.lat] : [71.43, 51.125],
    zoom: initialUrl.camera?.zoom ?? 10.2,
    pitch: initialUrl.camera?.pitch ?? 20,
    bearing: initialUrl.camera?.bearing ?? 0,
    maxPitch: 75,
    minZoom: 9,
    maxBounds: [[70.9, 50.85], [72.0, 51.45]],
    // ODbL requires crediting OpenStreetMap — kept as a compact ⓘ that expands on click
    attributionControl: { compact: true },
    fadeDuration: 150,
    boxZoom: false, // Shift+drag is a navigation modifier here, not box-zoom
  });
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), isMobile() ? 'top-right' : 'bottom-right');
} catch (err) {
  console.warn('3D map unavailable, list mode only:', err);
  mapOK = false;
  map = inertMap();
  document.body.classList.add('no-map');
}
if (import.meta.env.DEV) (window as unknown as { __map: MLMap }).__map = map;

// Desktop scene navigation. The left button works in one of two modes, chosen in the
// on-screen switch: «Двигать» (pan, MapLibre native) or «Вращать» (horizontal drag =
// bearing, vertical drag = pitch 0–75°). Holding Shift temporarily swaps the mode;
// the right button always rotates/pitches (MapLibre native). Touch is untouched.
type DragMode = 'pan' | 'rotate';
const DRAG_KEY = 'svoydom3d-drag-mode';
let dragMode: DragMode = 'pan';
try { if (localStorage.getItem(DRAG_KEY) === 'rotate') dragMode = 'rotate'; } catch { /* storage unavailable */ }
function setDragMode(m: DragMode) {
  dragMode = m;
  try { localStorage.setItem(DRAG_KEY, m); } catch { /* ignore */ }
  document.querySelectorAll<HTMLButtonElement>('[data-drag-mode]').forEach((b) => {
    const on = b.dataset.dragMode === m;
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-pressed', String(on));
  });
  const hint = document.getElementById('drag-hint');
  if (hint) hint.textContent = m === 'pan' ? 'Shift + ЛКМ — вращение и наклон' : 'Shift + ЛКМ — перемещение';
}
document.querySelectorAll<HTMLButtonElement>('[data-drag-mode]').forEach((b) => (b.onclick = () => setDragMode(b.dataset.dragMode as DragMode)));
setDragMode(dragMode);

type SceneDrag = { startX: number; startY: number; bearing: number; pitch: number; moved: boolean; button: number };
let sceneDrag: SceneDrag | null = null;
let suppressSceneClick = false;
const mapCanvas = map.getCanvas();

mapCanvas.addEventListener('mousedown', (e) => {
  if (e.ctrlKey || e.altKey || e.metaKey) return;
  // middle button (wheel pressed) always rotates/pitches the scene; left button follows the mode switch
  const rotate = e.button === 1 || (e.button === 0 && (dragMode === 'rotate') !== e.shiftKey);
  if (!rotate) return; // let MapLibre pan natively
  sceneDrag = { startX: e.clientX, startY: e.clientY, bearing: map.getBearing(), pitch: map.getPitch(), moved: false, button: e.button };
  mapCanvas.classList.add('is-scene-dragging');
  e.preventDefault();
  e.stopImmediatePropagation();
}, { capture: true });

window.addEventListener('mousemove', (e) => {
  if (!sceneDrag) return;
  const dx = e.clientX - sceneDrag.startX;
  const dy = e.clientY - sceneDrag.startY;
  if (!sceneDrag.moved && Math.hypot(dx, dy) < 3) return;
  sceneDrag.moved = true;
  map.jumpTo({
    bearing: sceneDrag.bearing + dx * 0.28,
    pitch: Math.max(0, Math.min(75, sceneDrag.pitch - dy * 0.24)),
  });
  e.preventDefault();
  e.stopImmediatePropagation();
}, { capture: true });

window.addEventListener('mouseup', (e) => {
  if (!sceneDrag || e.button !== sceneDrag.button) return;
  suppressSceneClick = sceneDrag.moved;
  sceneDrag = null;
  mapCanvas.classList.remove('is-scene-dragging');
  if (suppressSceneClick) {
    e.preventDefault();
    e.stopImmediatePropagation();
  }
}, { capture: true });

// no browser autoscroll / paste on middle click over the map
mapCanvas.addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); });
mapCanvas.addEventListener('click', (e) => {
  if (!suppressSceneClick) return;
  suppressSceneClick = false;
  e.preventDefault();
  e.stopImmediatePropagation();
}, { capture: true });

window.addEventListener('blur', () => {
  sceneDrag = null;
  mapCanvas.classList.remove('is-scene-dragging');
});

function pointsData(match = true): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: state.projects.filter((p) => matches(p) === match).map((p) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: p.coords },
      properties: {
        slug: p.slug, name: p.name, status: p.status, match: matches(p),
        label: p.status === 'строится' && p.priceFromM2 ? `${p.name}\nот ${Math.round(p.priceFromM2 / 1000)} тыс ₸/м²` : p.name,
      },
    })),
  };
}
function zhkData(): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const p of state.projects) {
    p.buildings.forEach((b, i) => features.push({
      type: 'Feature', id: features.length,
      geometry: { type: 'Polygon', coordinates: [b.ring] },
      properties: { slug: p.slug, status: p.status, match: matches(p), h: buildingHeight(b.floors), schematic: p.geometrySource === 'schematic', i },
    }));
  }
  return { type: 'FeatureCollection', features };
}

function addLayers() {
  map.addSource('zhk', { type: 'geojson', data: zhkData() });
  map.addSource('pts', { type: 'geojson', data: pointsData(), cluster: true, clusterMaxZoom: 11, clusterRadius: 46, clusterProperties: { building: ['+', ['case', ['==', ['get', 'status'], 'строится'], 1, 0]] } });
  map.addSource('pts-dim', { type: 'geojson', data: pointsData(false) });
  map.addSource('floors', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addSource('pois', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addSource('iso', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });

  map.addLayer({ id: 'iso-fill', type: 'fill', source: 'iso', paint: { 'fill-color': COLORS.accent, 'fill-opacity': ['match', ['get', 'min'], 5, 0.1, 10, 0.06, 0.035] } }, 'osm-buildings');
  map.addLayer({ id: 'iso-line', type: 'line', source: 'iso', paint: { 'line-color': COLORS.accent, 'line-opacity': 0.5, 'line-width': 1.2, 'line-dasharray': [2, 2] } }, 'osm-buildings');
  map.addLayer({ id: 'iso-label', type: 'symbol', source: 'iso', filter: ['==', ['geometry-type'], 'Point'], layout: { 'text-field': ['concat', ['to-string', ['get', 'min']], ' мин'], 'text-font': ['Noto Sans Regular'], 'text-size': 11 }, paint: { 'text-color': COLORS.accent, 'text-halo-color': '#fff', 'text-halo-width': 1.5 } });

  map.addLayer({
    id: 'zhk-3d', type: 'fill-extrusion', source: 'zhk', minzoom: 11,
    paint: {
      'fill-extrusion-color': ['case', ['!', ['get', 'match']], COLORS.dim, ['boolean', ['feature-state', 'hover'], false], COLORS.hover, ['get', 'schematic'], ['case', ['==', ['get', 'status'], 'строится'], COLORS.buildingSchematic, COLORS.completedSchematic], ['==', ['get', 'status'], 'строится'], COLORS.building, COLORS.completed],
      'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 11, 0, 12.5, ['get', 'h']],
      'fill-extrusion-opacity': 0.92,
      'fill-extrusion-vertical-gradient': true,
    },
  });
  map.addLayer({
    id: 'floors-solid', type: 'fill-extrusion', source: 'floors',
    paint: {
      'fill-extrusion-color': ['case', ['boolean', ['feature-state', 'hover'], false], COLORS.hover, ['boolean', ['feature-state', 'sel'], false], COLORS.selected, ['==', ['get', 'availability'], 'free'], COLORS.free, ['==', ['get', 'availability'], 'none'], COLORS.none, COLORS.noData],
      'fill-extrusion-base': ['get', 'base'], 'fill-extrusion-height': ['get', 'top'], 'fill-extrusion-opacity': 0.96,
    },
  });
  map.addLayer({
    id: 'floors-ghost', type: 'fill-extrusion', source: 'floors', filter: ['==', ['get', 'floor'], -1],
    paint: { 'fill-extrusion-color': '#cfd6ff', 'fill-extrusion-base': ['get', 'base'], 'fill-extrusion-height': ['get', 'top'], 'fill-extrusion-opacity': 0.16 },
  });

  map.addLayer({ id: 'pois', type: 'circle', source: 'pois', paint: { 'circle-radius': 5, 'circle-color': ['get', 'color'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 } });

  map.addLayer({ id: 'pts-dim', type: 'circle', source: 'pts-dim', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 3, 14, 5], 'circle-color': '#b9b5ac', 'circle-opacity': 0.6, 'circle-stroke-color': '#fff', 'circle-stroke-width': 1 } });
  map.addLayer({
    id: 'clusters', type: 'circle', source: 'pts', filter: ['has', 'point_count'],
    paint: { 'circle-color': ['case', ['==', ['get', 'building'], ['get', 'point_count']], COLORS.building, ['==', ['get', 'building'], 0], COLORS.completed, COLORS.mixed], 'circle-opacity': 0.9, 'circle-radius': ['interpolate', ['linear'], ['get', 'point_count'], 2, 17, 20, 30], 'circle-stroke-color': 'rgba(255,255,255,.9)', 'circle-stroke-width': 3 },
  });
  map.addLayer({ id: 'cluster-count', type: 'symbol', source: 'pts', filter: ['has', 'point_count'], layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-font': ['Noto Sans Bold'], 'text-size': 13 }, paint: { 'text-color': '#fff' } });
  map.addLayer({
    id: 'pts', type: 'circle', source: 'pts', filter: ['!', ['has', 'point_count']],
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 5, 14, 7],
      'circle-color': ['case', ['!', ['get', 'match']], '#c9c5bc', ['==', ['get', 'status'], 'строится'], COLORS.building, COLORS.completed],
      'circle-stroke-color': '#fff', 'circle-stroke-width': 2,
      'circle-opacity': ['case', ['get', 'match'], 1, 0.55],
      'circle-stroke-opacity': ['case', ['get', 'match'], 1, 0.55],
    },
  });
  map.addLayer({
    id: 'pts-label', type: 'symbol', source: 'pts', minzoom: 11.6,
    // projects under construction get an HTML flag (name + deadline) instead of this label
    filter: ['all', ['!', ['has', 'point_count']], ['get', 'match'], ['!=', ['get', 'status'], 'строится']],
    layout: {
      'text-field': ['get', 'label'], 'text-font': ['Noto Sans Bold'], 'text-size': ['interpolate', ['linear'], ['zoom'], 12, 11, 16, 13],
      'text-anchor': 'bottom', 'text-offset': [0, -0.9], 'text-line-height': 1.25, 'text-max-width': 14, 'symbol-sort-key': ['case', ['==', ['get', 'status'], 'строится'], 0, 1],
    },
    paint: { 'text-color': '#1c2230', 'text-halo-color': 'rgba(255,255,255,.95)', 'text-halo-width': 1.8 },
  });
}

// ---------------------------------------------------------------- flags over projects under construction
// HTML markers: the marker is lifted to the roof (by zoom and pitch), a short pole and a pennant
// with the project name and its completion date. Hidden below zoom 11.6 (clusters take over).
const shortDeadline = (d: string | null) =>
  !d ? 'срок не указан' : d.replace(/\s*квартал\s*/i, ' кв. ').replace(/\s*год[а]?\s*$/i, '').replace(/\s+/g, ' ').trim();
const flags = new Map<string, { marker: maplibregl.Marker; el: HTMLElement; p: Project; heightM: number }>();
function initFlags() {
  for (const p of state.projects.filter((x) => x.status === 'строится')) {
    const [sw, ne] = bbox(p.buildings.map((b) => b.ring));
    const center: LngLat = [(sw[0] + ne[0]) / 2, (sw[1] + ne[1]) / 2];
    const heightM = Math.max(...p.buildings.map((b) => buildingHeight(b.floors)));
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'zhk-flag';
    el.setAttribute('aria-label', `ЖК ${p.name}, сдача ${shortDeadline(p.deadline)}`);
    const pennant = document.createElement('span');
    pennant.className = 'zhk-flag__pennant';
    const nm = document.createElement('b');
    nm.textContent = p.name; // textContent: external strings never reach innerHTML
    const dl = document.createElement('span');
    dl.textContent = `сдача: ${shortDeadline(p.deadline)}`;
    pennant.append(nm, dl);
    const pole = document.createElement('span');
    pole.className = 'zhk-flag__pole';
    el.append(pennant, pole);
    el.addEventListener('click', (e) => { e.stopPropagation(); selectProject(p.slug); });
    const marker = new maplibregl.Marker({ element: el, anchor: 'bottom-left' }).setLngLat(center).addTo(map);
    el.setAttribute('aria-label', `ЖК ${p.name}, сдача ${shortDeadline(p.deadline)}. Открыть`); // Marker overwrites it with «Map marker»
    flags.set(p.slug, { marker, el, p, heightM });
  }
  updateFlags();
}
function updateFlags() {
  const zoom = map.getZoom();
  const lat = map.getCenter().lat;
  const mpp = (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom); // metres per CSS pixel
  const tilt = Math.sin((map.getPitch() * Math.PI) / 180);
  const grow = Math.max(0, Math.min(1, (zoom - 11) / 1.5)); // same ramp as zhk-3d height (z11 → z12.5)
  // Greedy de-overlap: nearer flags (lower on screen) keep their pole; a flag whose pennant
  // would cover an already placed one is raised in 30 px steps.
  const placed: { x: number; y: number; w: number; h: number }[] = [];
  const items = [...flags.values()].map((f) => ({ ...f, pt: map.project(f.marker.getLngLat()) })).sort((a, b) => b.pt.y - a.pt.y);
  for (const { el, p, heightM, pt, marker } of items) {
    const visible = zoom >= 11.6 && matches(p);
    el.hidden = !visible;
    if (!visible) continue;
    // the pole starts on the roof: lift the marker by the projected building height
    const roof = Math.min(600, Math.round(((heightM * grow) / mpp) * tilt));
    marker.setOffset([0, -roof]);
    let pole = 26;
    const w = el.offsetWidth || 120, h = (el.firstElementChild as HTMLElement)?.offsetHeight || 34;
    const hit = (y: number) => placed.some((r) => pt.x < r.x + r.w && pt.x + w > r.x && y < r.y + r.h && y + h > r.y);
    for (let i = 0; i < 6 && hit(pt.y - roof - pole - h); i++) pole += 30;
    placed.push({ x: pt.x, y: pt.y - roof - pole - h, w, h });
    el.style.setProperty('--pole', `${pole}px`);
    el.classList.toggle('is-selected', state.sel?.slug === p.slug);
  }
}

// Hide OSM buildings that sit inside a ZhK outline (our own model is drawn there instead).
const hiddenOsm = new Set<number | string>();
let hideTimer = 0;
function hideOsmInsideZhk() {
  clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => {
    if (map.getZoom() < 12.5) return;
    const rings = state.projects.flatMap((p) => p.buildings.map((b) => b.ring));
    const osmIds = new Set(state.projects.flatMap((p) => p.osmIds || []));
    const before = hiddenOsm.size;
    for (const f of map.querySourceFeatures('omt', { sourceLayer: 'building' })) {
      if (f.id == null || hiddenOsm.has(f.id)) continue;
      // OpenMapTiles encodes OSM way ids as id*10 + type digit
      if (osmIds.has(Math.floor(Number(f.id) / 10))) { hiddenOsm.add(f.id); continue; }
      const g = f.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon;
      const ring = (g.type === 'Polygon' ? g.coordinates[0] : g.coordinates[0]?.[0]) as LngLat[] | undefined;
      if (!ring?.length) continue;
      const c: LngLat = [ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length];
      if (rings.some((r) => pointInRing(c, r))) hiddenOsm.add(f.id);
    }
    if (hiddenOsm.size !== before) map.setFilter('osm-buildings', ['!', ['in', ['id'], ['literal', [...hiddenOsm]]]]);
  }, 250);
}

// ---------------------------------------------------------------- intro flight
let spinning = false;
function introFlight() {
  const active = state.projects.filter((p) => p.status === 'строится').map((p) => p.coords);
  const [sw, ne] = bbox([active]);
  const cam = map.cameraForBounds([sw, ne], { padding: isMobile() ? 40 : { top: 120, bottom: 80, left: 380, right: 80 }, bearing: -18, pitch: 52 });
  map.flyTo({ ...cam, pitch: 52, bearing: -18, duration: dur(2600), essential: true });
  // one slow, finite turn after the fly-in — never a loop, so markers stay clickable
  map.once('moveend', () => {
    if (state.sel || introDone || reduceMotion()) return;
    spinning = true;
    map.easeTo({ bearing: -18 + 20, duration: dur(9000), easing: (t) => t });
    map.once('moveend', () => (spinning = false));
  });
}
let introDone = false;
const stopSpin = () => { introDone = true; if (spinning) { spinning = false; map.stop(); } };
['pointerdown', 'mousedown', 'touchstart', 'wheel'].forEach((e) => map.getContainer().addEventListener(e, stopSpin, { passive: true, capture: true }));

// ---------------------------------------------------------------- filters UI
function renderFilters() {
  const f = state.filters;
  const districts = [...new Set(state.projects.filter((p) => p.status === 'строится').map((p) => p.district).filter(Boolean))].sort() as string[];
  const chip = (group: string, value: string | number, label: string, on: boolean) => `<button class="chip ${on ? 'is-on' : ''}" data-g="${group}" data-v="${value}">${label}</button>`;
  const n = state.projects.filter(matches).length;
  $('filters-form').innerHTML = `
    <div class="filters__head"><b>Подбор ЖК</b><span class="muted">${n} из ${state.projects.length}</span></div>
    <div class="fgroup"><div class="flabel">Статус</div>${chip('status', 'строится', 'Строится', f.statuses.has('строится'))}${chip('status', 'сдан', 'Сдан', f.statuses.has('сдан'))}</div>
    <div class="fgroup"><div class="flabel">Класс</div>${['Комфорт', 'Комфорт+', 'Бизнес'].map((c) => chip('class', c, c, f.classes.has(c))).join('')}</div>
    <div class="fgroup"><div class="flabel">Комнат</div>${[1, 2, 3, 4].map((r) => chip('rooms', r, r === 4 ? '4+' : String(r), f.rooms.has(r))).join('')}</div>
    <div class="fgroup"><div class="flabel">Срок сдачи</div>
      <select data-g="year"><option value="0">Любой</option>${[2026, 2027, 2028].map((y) => `<option value="${y}" ${f.year === y ? 'selected' : ''}>до конца ${y}</option>`).join('')}</select></div>
    <div class="fgroup"><div class="flabel">Бюджет <span class="muted">${f.budget ? `до ${f.budget} млн ₸` : 'любой'}</span></div>
      <input type="range" min="0" max="60" step="1" value="${f.budget}" data-g="budget" aria-label="Бюджет, млн ₸"></div>
    <div class="fgroup"><div class="flabel">Район</div>
      <select data-g="district"><option value="">Все районы</option>${districts.map((d) => `<option ${f.district === d ? 'selected' : ''}>${esc(d)}</option>`).join('')}</select></div>
    <div class="filters__foot"><button class="btn btn--ghost btn--sm" data-g="reset">Сбросить</button><button class="btn btn--primary show-results" data-g="close">Показать ${n} ЖК</button></div>`;
  $('count-label').textContent = `${n} ЖК на карте`;
  renderProjectList();
}
$('filters').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-g]');
  if (!b || b.tagName !== 'BUTTON') return;
  const f = state.filters, g = b.dataset.g!, v = b.dataset.v!;
  const toggle = <T>(s: Set<T>, x: T) => (s.has(x) ? s.delete(x) : s.add(x));
  if (g === 'status') toggle(f.statuses, v);
  if (g === 'class') toggle(f.classes, v);
  if (g === 'rooms') toggle(f.rooms, Number(v));
  if (g === 'close') {
    if (viewMode === 'list') { $('project-list-h').focus(); $('project-list-h').scrollIntoView({ block: 'start' }); return; }
    $('filters').classList.remove('is-open'); $('filters-toggle').setAttribute('aria-expanded', 'false'); return;
  }
  if (g === 'reset') Object.assign(f, { classes: new Set(), statuses: new Set(), year: 0, rooms: new Set(), budget: 0, district: '' });
  applyFilters();
});
$('filters').addEventListener('input', (e) => {
  const el = e.target as HTMLInputElement, g = el.dataset.g;
  if (g === 'budget') state.filters.budget = Number(el.value);
  if (g === 'year') state.filters.year = Number(el.value);
  if (g === 'district') state.filters.district = el.value;
  applyFilters(g === 'budget');
});
function applyFilters(keepFocus = false) {
  (map.getSource('pts') as GeoJSONSource | undefined)?.setData(pointsData());
  (map.getSource('pts-dim') as GeoJSONSource | undefined)?.setData(pointsData(false));
  (map.getSource('zhk') as GeoJSONSource | undefined)?.setData(zhkData());
  updateFlags();
  nav.replace();
  if (!keepFocus) renderFilters();
  else {
    const n = state.projects.filter(matches).length;
    $('filters').querySelector('.filters__head .muted')!.textContent = `${n} из ${state.projects.length}`;
    $('filters').querySelector('[data-g="budget"]')!.previousElementSibling!.querySelector('.muted')!.textContent = state.filters.budget ? `до ${state.filters.budget} млн ₸` : 'любой';
    $('count-label').textContent = `${n} ЖК на карте`;
    $('filters').querySelector('.show-results')!.textContent = `Показать ${n} ЖК`;
    renderProjectList();
  }
}
// ---------------------------------------------------------------- list view (same scenario without 3D)
function renderProjectList() {
  const list = state.projects.filter(matches).sort((a, b) => (a.status === b.status ? a.name.localeCompare(b.name, 'ru') : a.status === 'строится' ? -1 : 1));
  $('project-list-h').textContent = `ЖК в подборке: ${list.length}`;
  $('project-list').innerHTML = list.length
    ? list.map((p) => {
      const c = p.catalog;
      const cov = c.total == null ? 'квартиры не опубликованы' : c.complete ? `квартир: ${c.total}` : `квартир: ${c.loaded} из ${c.total} (неполно)`;
      return `<li><button type="button" class="plist__item ${state.sel?.slug === p.slug ? 'is-current' : ''}" data-list-slug="${esc(p.slug)}" ${state.sel?.slug === p.slug ? 'aria-current="true"' : ''}>
        <span class="plist__dot plist__dot--${p.status === 'строится' ? 'build' : 'done'}" aria-hidden="true"></span>
        <span class="plist__main"><b>ЖК ${esc(p.name)}</b><span>${esc(p.status)}${p.deadline && p.status === 'строится' ? ' · сдача ' + esc(shortDeadline(p.deadline)) : ''}${p.district ? ' · ' + esc(p.district) : ''}</span>
        <span class="muted">${p.priceFromM2 ? `от ${fmtTg(p.priceFromM2)}/м² · ` : ''}${cov}</span></span></button></li>`;
    }).join('')
    : '<li class="plist__empty">Ничего не найдено. Ослабьте фильтры или нажмите «Сбросить».</li>';
}
$('project-list').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-list-slug]');
  if (b) selectProject(b.dataset.listSlug!);
});
// ---------------------------------------------------------------- sections: map / list / search / fav / compare
const favs = new ShortList('svoydom3d-fav');
const cmp = new ShortList('svoydom3d-compare', COMPARE_MAX);
const viewRoot = $('view');
let indexData: { updatedAt: string; apartments: IndexedApartment[] } | null = null;

function updateBadges() {
  const set = (id: string, n: number, what: string) => { const el = $(id); el.textContent = n ? String(n) : ''; el.setAttribute('aria-label', `${n} ${what}`); };
  set('fav-count', favs.size, 'в избранном');
  set('cmp-count', cmp.size, 'в сравнении');
}
function viewCtx(): ViewCtx {
  return {
    favs, cmp, filter: state.aptFilter, sort: state.sort,
    projects: state.projects.filter((p) => p.catalog.loaded > 0).map((p) => ({ slug: p.slug, name: p.name })).sort((a, b) => a.name.localeCompare(b.name, 'ru')),
    onFilter: (f, s) => { state.aptFilter = f; state.sort = s; nav.replace(); renderView(true); },
    openApartment: (a) => openFromIndex(a),
    toggleFav: (id) => toggleFav(id),
    toggleCmp: (id) => toggleCmp(id),
    goView: (v) => setView(v, { push: true }),
  };
}
function toggleFav(id: string) {
  const had = favs.has(id);
  favs.toggle(id);
  announce(had ? 'Убрано из избранного' : 'Добавлено в избранное');
}
function toggleCmp(id: string) {
  const had = cmp.has(id);
  if (!cmp.toggle(id)) { toast(`Сравнить можно до ${COMPARE_MAX} квартир. Уберите одну в разделе «Сравнение».`); announce('Сравнение заполнено'); return; }
  announce(had ? 'Убрано из сравнения' : `Добавлено в сравнение: ${cmp.size} из ${COMPARE_MAX}`);
}
favs.onChange(() => { updateBadges(); refreshAfterListChange(); });
cmp.onChange(() => { updateBadges(); refreshAfterListChange(); });
function refreshAfterListChange() {
  if (viewMode === 'search' || viewMode === 'fav' || viewMode === 'compare') renderView(true);
  if (state.apt && state.sel) renderAptActions();
  if (state.sel && !state.apt && state.projectView === 'list') renderPanel();
}

async function renderView(keepFocus = false) {
  const v = viewMode;
  if (v !== 'search' && v !== 'fav' && v !== 'compare') return;
  const active = document.activeElement as HTMLElement | null;
  const activeKey = active?.dataset.fav ? `[data-fav="${CSS.escape(active.dataset.fav)}"]` : active?.dataset.cmp ? `[data-cmp="${CSS.escape(active.dataset.cmp)}"]` : active?.dataset.room ? `[data-room="${active.dataset.room}"]` : active?.getAttribute('name') ? `[name="${active.getAttribute('name')}"]` : null;
  if (!indexData) {
    viewRoot.innerHTML = '<div class="skeleton" role="status" aria-label="Загрузка квартир"></div>';
    try { indexData = await loadIndex(); }
    catch (err) { console.error(err); renderViewError(viewRoot, { search: 'Поиск квартир', fav: 'Избранное', compare: 'Сравнение' }[v], () => renderView()); return; }
    const valid = new Set(indexData.apartments.map((a) => a.apartmentId));
    favs.prune(valid); cmp.prune(valid);
    if (viewMode !== v) return;
  }
  const ctx = viewCtx();
  if (v === 'search') renderSearch(viewRoot, indexData.apartments, indexData.updatedAt, ctx);
  if (v === 'fav') renderFavs(viewRoot, indexData.apartments, ctx);
  if (v === 'compare') renderCompare(viewRoot, indexData.apartments, ctx);
  const again = keepFocus && activeKey ? (viewRoot.querySelector(activeKey) as HTMLElement | null) : null;
  if (again) again.focus({ preventScroll: true });
  else if (!keepFocus) (viewRoot.querySelector('[data-view-heading]') as HTMLElement | null)?.focus();
}

async function openFromIndex(a: IndexedApartment) {
  if (state.sel?.slug !== a.projectSlug || !state.detail) await selectProject(a.projectSlug);
  if (state.sel?.slug === a.projectSlug && state.detail) openApt(a.apartmentId);
}

// keep sheets below the (wrapping) top bar on narrow screens
const syncTopbar = () => document.documentElement.style.setProperty('--topbar-h', `${Math.round(document.querySelector('.topbar')!.getBoundingClientRect().bottom + 8)}px`);
window.addEventListener('resize', syncTopbar);
requestAnimationFrame(syncTopbar);

function setView(v: View, opts: { push?: boolean } = {}) {
  syncTopbar();
  if (!mapOK && v === 'map') v = 'list';
  const changed = v !== viewMode;
  viewMode = v;
  for (const x of ['map', 'list', 'search', 'fav', 'compare']) document.body.classList.toggle(`view-${x}`, x === v);
  document.body.classList.toggle('list-mode', v === 'list');
  document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) => {
    const on = b.dataset.view === v;
    on ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current');
    b.toggleAttribute('disabled', b.dataset.view === 'map' && !mapOK);
  });
  const isSection = v === 'search' || v === 'fav' || v === 'compare';
  viewRoot.hidden = !isSection;
  if (v === 'list') $('filters').classList.add('is-open');
  if (v === 'map') { $('filters').classList.remove('is-open'); if (mapOK) requestAnimationFrame(() => map.resize()); }
  if (changed && opts.push) nav.push(); else nav.replace();
  if (isSection) renderView();
  else if (changed && v === 'list' && opts.push) $('project-list-h').focus();
  if (changed) announce({ map: 'Карта', list: 'Список ЖК', search: 'Поиск квартир', fav: 'Избранное', compare: 'Сравнение' }[v]);
}
document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) => (b.onclick = () => setView(b.dataset.view as View, { push: true })));
updateBadges();

$('skip-list').addEventListener('click', (e) => {
  e.preventDefault();
  $('filters').classList.add('is-open');
  $('filters-toggle').setAttribute('aria-expanded', 'true');
  $('project-list-h').focus();
});
$('filters-toggle').onclick = () => {
  const open = !$('filters').classList.contains('is-open');
  $('filters').classList.toggle('is-open', open);
  $('filters-toggle').setAttribute('aria-expanded', String(open));
};

// ---------------------------------------------------------------- tooltip / toast
const tip = $('tooltip');
function showTip(e: maplibregl.MapMouseEvent, html: string) {
  tip.innerHTML = html; tip.hidden = false;
  tip.style.transform = `translate(${e.point.x + 14}px, ${e.point.y + 14}px)`;
}
const hideTip = () => (tip.hidden = true);
let toastTimer = 0;
function toast(html: string) {
  const t = $('toast'); t.innerHTML = html; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = window.setTimeout(() => (t.hidden = true), 6000);
}

// ---------------------------------------------------------------- legend
function renderLegend() {
  const item = (c: string, l: string) => `<span><i style="background:${c}"></i>${l}</span>`;
  $('legend').innerHTML = state.sel
    ? item(COLORS.free, 'есть свободные') + item(COLORS.none, 'нет свободных') + item(COLORS.noData, 'данных нет') + item(COLORS.selected, 'этаж (схематично)')
    : item(COLORS.building, 'строится') + item(COLORS.completed, 'сдан') + item(COLORS.dim, 'не подходит под фильтр');
}

// ---------------------------------------------------------------- project selection
const panel = $('panel'), body = $('panel-body');
function padding() {
  return isMobile() ? { top: 70, bottom: Math.round(window.innerHeight * 0.52), left: 20, right: 20 } : { top: 90, bottom: 60, left: 60, right: 470 };
}

async function selectProject(slug: string, opts: { fly?: boolean; push?: boolean } = {}) {
  const p = state.projects.find((x) => x.slug === slug);
  if (!p) return;
  stopSpin();
  const same = state.sel === p;
  state.sel = p; state.selFloor = null; state.apt = null; state.tab = 'apts';
  if (!same && opts.push !== false) nav.push();
  if (layersReady) map.setFilter('zhk-3d', ['!=', ['get', 'slug'], slug]);
  panel.hidden = false; panel.classList.add('is-open');
  if (!same) setSheet('half');
  document.body.classList.add('has-project');
  updateFlags();
  $('filters').classList.remove('is-open');
  body.innerHTML = `<div class="skeleton" role="status" aria-label="Загрузка ЖК ${esc(p.name)}"></div>`;
  renderLegend();
  if (opts.fly !== false && mapOK) {
    const [sw, ne] = bbox(p.buildings.map((b) => b.ring));
    const cam = map.cameraForBounds([sw, ne], { padding: padding(), maxZoom: 17.2, bearing: -28, pitch: 62 });
    map.flyTo({ ...cam, zoom: Math.min((cam?.zoom ?? 16) - 0.35, 17), pitch: 62, bearing: -28, duration: dur(1400), essential: true });
  }
  let detail: ProjectDetail;
  try {
    detail = await loadDetail(slug);
  } catch (err) {
    if (state.sel !== p) return;
    console.error(err);
    body.innerHTML = `<div class="state-error" role="alert"><h2 tabindex="-1" data-focus-heading>ЖК ${esc(p.name)}</h2>
      <p>Не удалось загрузить квартиры этого ЖК. Проверьте соединение и попробуйте ещё раз.</p>
      <button class="btn btn--primary" id="retry-detail">Повторить</button>
      <a class="btn btn--ghost" href="${esc(p.url)}" target="_blank" rel="noopener">Открыть на svoydom.kz ↗</a></div>`;
    $('retry-detail').onclick = () => { forgetDetail(slug); selectProject(slug, { fly: false, push: false }); };
    focusHeading();
    return;
  }
  if (state.sel !== p) return;
  state.detail = detail;
  (map.getSource('floors') as GeoJSONSource | undefined)?.setData(floorsGeoJSON(detail.buildings, detail.apartments, detail.catalog.complete));
  clearDistrict();
  renderPanel();
  focusHeading();
  announce(`Открыт ЖК ${p.name}. ${p.catalog.total == null ? 'Квартиры не опубликованы.' : `${p.catalog.loaded} из ${p.catalog.total} квартир.`}`);
}

function closeProject(opts: { ease?: boolean } = {}) {
  const was = state.sel;
  state.sel = null; state.detail = null; state.apt = null; state.selFloor = null; state.tab = 'apts';
  if (layersReady) {
    map.setFilter('zhk-3d', null);
    (map.getSource('floors') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: [] });
    map.setFilter('floors-ghost', ['==', ['get', 'floor'], -1]);
    map.setFilter('floors-solid', null);
  }
  clearDistrict();
  panel.classList.remove('is-open');
  setSheet(null);
  document.body.classList.remove('has-project');
  updateFlags();
  setTimeout(() => { if (!state.sel) panel.hidden = true; }, 250);
  renderLegend();
  if (opts.ease !== false && mapOK) map.easeTo({ zoom: Math.min(map.getZoom(), 13.2), pitch: 52, duration: dur(1000) });
  if (was) {
    announce(`ЖК ${was.name} закрыт`);
    (document.querySelector(`[data-list-slug="${CSS.escape(was.slug)}"]`) as HTMLElement | null)?.focus();
  }
}
const goUp = () => {
  if (state.apt) nav.back(closeApt);
  else if (state.sel) nav.back(() => closeProject());
};
$('panel-close').onclick = () => (state.sel ? nav.back(() => closeProject()) : undefined);


// floor focus: floors above become translucent
function focusFloor(floor: number | null) {
  state.selFloor = floor;
  const det = state.detail;
  body.querySelectorAll('.chess__row').forEach((r) => r.classList.toggle('is-sel', Number((r as HTMLElement).dataset.floor) === floor));
  body.querySelectorAll('[data-floor-btn]').forEach((b) => b.setAttribute('aria-pressed', String(Number((b as HTMLElement).dataset.floorBtn) === floor)));
  if (!det || !layersReady) return;
  det.buildings.forEach((b, bi) => { for (let f = 1; f <= b.floors; f++) map.setFeatureState({ source: 'floors', id: bi * 1000 + f }, { sel: f === floor }); });
  if (floor == null) {
    map.setFilter('floors-solid', null);
    map.setFilter('floors-ghost', ['==', ['get', 'floor'], -1]);
  } else {
    map.setFilter('floors-solid', ['<=', ['get', 'floor'], floor]);
    map.setFilter('floors-ghost', ['>', ['get', 'floor'], floor]);
  }
  body.querySelectorAll('.chess__row').forEach((r) => r.classList.toggle('is-sel', Number((r as HTMLElement).dataset.floor) === floor));
}
function hoverFloor(floor: number | null) {
  const det = state.detail;
  if (!det || state.hoverFloor === floor || !layersReady) return;
  const prev = state.hoverFloor;
  state.hoverFloor = floor;
  det.buildings.forEach((b, bi) => {
    if (prev != null && prev <= b.floors) map.setFeatureState({ source: 'floors', id: bi * 1000 + prev }, { hover: false });
    if (floor != null && floor <= b.floors) map.setFeatureState({ source: 'floors', id: bi * 1000 + floor }, { hover: true });
  });
  body.querySelectorAll('.chess__row').forEach((r) => r.classList.toggle('is-hover', Number((r as HTMLElement).dataset.floor) === floor));
}

// ---------------------------------------------------------------- panel rendering
function sourceLine() {
  return `Источник: svoydom.kz (открытые страницы), данные на ${fmtDate(state.fetchedAt)}`;
}
function dataNote(p: Project) {
  const c = p.catalog;
  if (c.total == null) return `<p class="note note--warn">Квартиры этого ЖК на открытых страницах сайта не опубликованы — <b>данных нет</b>. ${sourceLine()}.</p>`;
  const pct = c.total ? Math.round((c.loaded / c.total) * 100) : 100;
  const meter = `<div class="coverage" role="img" aria-label="Загружено ${c.loaded} из ${c.total} квартир, ${pct}%"><i style="width:${pct}%"></i></div>`;
  return `<div class="note ${c.complete ? '' : 'note--warn'}">${meter}
    <p>${c.complete ? `<b>Каталог полный:</b> все ${c.total} опубликованных квартир. Пустой этаж = нет свободных.` : `<b>Каталог неполный: ${c.loaded} из ${c.total}.</b> Остальные квартиры сайт отдаёт только через закрытый robots.txt ajax. Пустой этаж = <b>данных нет</b>, а не «нет квартир».`}</p>
    <p>Корпус, секция и позиция на этаже не опубликованы — квартиры сгруппированы по этажам; на 3D этаж показан <b>схематично</b>. ${sourceLine()}.</p></div>`;
}

function renderPanel() {
  const p = state.sel!, det = state.detail!;
  if (state.apt) return renderApt(p, state.apt);
  const free = det.apartments.filter((a) => a.status === 'свободна');
  const minPrice = p.priceFrom ?? (free.length ? Math.min(...free.map((a) => a.price || Infinity)) : null);
  const sf = p.siteFacts;
  const sfNote = sf ? ` По странице ЖК на svoydom.kz: ${[sf.floorsMax ? `этажность ${sf.floorsMin && sf.floorsMin !== sf.floorsMax ? `${sf.floorsMin}–${sf.floorsMax}` : sf.floorsMax}` : '', sf.sections ? `${sf.sections} секций` : '', sf.entrances ? `${sf.entrances} подъездов` : ''].filter(Boolean).join(', ')}.` : '';
  const geomNote = (p.geometrySource === 'schematic' ? `Корпуса показаны схематично${sf?.sections ? ` (${sf.sections} секций)` : ''}: форма корпусов на svoydom.kz не опубликована, контура нет в OSM. Обвести по генплану — в «Редакторе контуров».` : p.geometrySource === 'osm' ? 'Контуры корпусов — OpenStreetMap.' : 'Контуры корпусов — ручная разметка.') + sfNote;
  body.innerHTML = `
    <div class="hero" ${p.image ? `style="background-image:url('${esc(p.image)}')"` : ''}>
      <div class="hero__shade"></div>
      <div class="hero__text">
        <div class="chips">${p.class ? `<span class="tag">${esc(p.class)}</span>` : ''}<span class="tag tag--${p.status === 'строится' ? 'build' : 'done'}">${esc(p.status)}</span>${p.deadline ? `<span class="tag">${esc(p.deadline)}</span>` : ''}</div>
        <h2 tabindex="-1" data-focus-heading>ЖК ${esc(p.name)}</h2>
        <div class="addr">${esc(p.address || '')}${p.district ? ` · ${esc(p.district)}` : ''}</div>
      </div>
    </div>
    <div class="stats">
      <div><span>Цена от</span><b>${fmtMln(minPrice)} ₸</b></div>
      <div><span>За м² от</span><b>${p.priceFromM2 ? Math.round(p.priceFromM2 / 1000) + ' тыс ₸' : '—'}</b></div>
      <div><span>Свободных</span><b>${p.catalog.total == null ? '<span class="muted">данных нет</span>' : p.catalog.total}</b>${p.catalog.total != null && !p.catalog.complete ? `<small class="muted">загружено ${p.catalog.loaded}</small>` : ''}</div>
      <div><span>Этажность</span><b>${p.siteFacts?.floorsMax ? (p.siteFacts.floorsMin && p.siteFacts.floorsMin !== p.siteFacts.floorsMax ? `${p.siteFacts.floorsMin}–${p.siteFacts.floorsMax}` : p.siteFacts.floorsMax) : p.floorsMax ?? '—'}</b>${p.siteFacts?.sections || p.siteFacts?.entrances ? `<small class="muted">${[p.siteFacts.sections ? `${p.siteFacts.sections} секц.` : '', p.siteFacts.entrances ? `${p.siteFacts.entrances} подъезд.` : ''].filter(Boolean).join(' · ')}</small>` : ''}</div>
    </div>
    <div class="actions">
      <a class="btn btn--primary" href="${esc(p.url)}" target="_blank" rel="noopener">Открыть на svoydom.kz ↗</a>
      ${p.tour3d ? `<a class="btn btn--ghost" href="${esc(p.tour3d)}" target="_blank" rel="noopener">3D-тур ↗</a>` : ''}
    </div>
    ${p.coordsFlags.length ? `<p class="note note--warn">Геопривязка: ${esc(p.coordsFlags.join('; '))}</p>` : ''}
    <nav class="tabs" aria-label="Разделы ЖК">${(['apts', 'district', 'about'] as const).map((t) => `<button type="button" class="tab ${state.tab === t ? 'is-on' : ''}" aria-pressed="${state.tab === t}" data-tab="${t}">${{ apts: 'Шахматка', district: 'Район', about: 'О проекте' }[t]}</button>`).join('')}</nav>
    <div id="tabbody"></div>`;
  body.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => (b.onclick = () => { state.tab = b.dataset.tab as typeof state.tab; renderPanel(); nav.replace(); (body.querySelector(`[data-tab="${state.tab}"]`) as HTMLElement | null)?.focus(); }));
  const tb = $('tabbody');
  if (state.tab === 'apts') { clearDistrict(); renderAptsTab(tb, p, det); }
  if (state.tab === 'district') renderDistrict(tb, p);
  if (state.tab === 'about') {
    clearDistrict();
    tb.innerHTML = `<p class="desc">${esc(p.description || 'Описание не опубликовано.')}</p>
      <div class="gallery">${p.images.slice(1, 6).map((u) => `<img loading="lazy" src="${esc(u)}" alt="">`).join('')}</div>
      <p class="note">${geomNote} Фото и описание — со страницы проекта на svoydom.kz (по ссылке, не копируются).</p>`;
  }
}

function aptLabel(a: Apartment) {
  return `№${a.number ?? '—'}, ${a.rooms ? `${a.rooms}-комн.` : a.type || ''}, ${a.area ?? '—'} м², этаж ${a.floor ?? '—'}, ${fmtTg(a.price)}, ${a.status}`;
}
/** Numbers repeated inside a project (no section to disambiguate) get a composite label. */
function dupNumbers(det: ProjectDetail) {
  const seen = new Map<string, number>();
  for (const a of det.apartments) seen.set(a.number ?? '', (seen.get(a.number ?? '') || 0) + 1);
  return new Set([...seen].filter(([, n]) => n > 1).map(([k]) => k));
}

/** Apartments tab: shared apartment filters + «Шахматка | Список» switch. */
function toIndexed(p: Project, a: Apartment, complete: boolean): IndexedApartment {
  return {
    apartmentId: a.apartmentId, sourceId: a.sourceId, projectSlug: p.slug, projectName: p.name, projectStatus: p.status, projectClass: p.class,
    deadline: p.deadline, district: p.district, url: p.url, catalogComplete: complete, number: a.number, rooms: a.rooms, area: a.area,
    price: a.price, priceM2: a.priceM2, floor: a.floor, floorsMax: p.floorsMax, status: a.status, planImageUrl: a.planImageUrl,
    buildingId: a.buildingId, sectionId: a.sectionId, updatedAt: a.updatedAt,
  };
}
const projectFilter = () => ({ ...state.aptFilter, project: '' }); // inside a project the ЖК filter is implied

function renderAptsTab(root: HTMLElement, p: Project, det: ProjectDetail) {
  const pv = state.projectView;
  const rows = det.apartments.map((a) => toIndexed(p, a, det.catalog.complete));
  const matched = rows.filter((a) => matchesApt(a, projectFilter())).length;
  root.innerHTML = `<div class="apts-toolbar">
      <div class="seg" role="group" aria-label="Вид квартир">
        <button type="button" class="seg__b ${pv === 'chess' ? 'is-on' : ''}" data-pv="chess" aria-pressed="${pv === 'chess'}">Шахматка</button>
        <button type="button" class="seg__b ${pv === 'list' ? 'is-on' : ''}" data-pv="list" aria-pressed="${pv === 'list'}">Список</button>
      </div>
      <details class="apts-filter" ${det.apartments.length ? '' : 'hidden'} ${!isFilterEmptyLocal() ? 'open' : ''}>
        <summary>Фильтры квартир${isFilterEmptyLocal() ? '' : ` · подходит ${matched} из ${rows.length}`}</summary>
        ${aptFilterForm(projectFilter(), state.sort, null, 'proj')}
      </details>
    </div>
    <div id="apts-body"></div>`;
  root.querySelectorAll<HTMLButtonElement>('[data-pv]').forEach((b) => (b.onclick = () => {
    state.projectView = b.dataset.pv as 'chess' | 'list';
    nav.replace();
    renderAptsTab(root, p, det);
    (root.querySelector(`[data-pv="${state.projectView}"]`) as HTMLElement | null)?.focus();
  }));
  bindAptFilter(root, projectFilter(), state.sort, (f, s) => {
    const nameFocus = (document.activeElement as HTMLElement | null)?.getAttribute('name');
    const roomFocus = (document.activeElement as HTMLElement | null)?.dataset.room;
    state.aptFilter = { ...f, project: state.aptFilter.project }; state.sort = s;
    nav.replace();
    renderAptsTab(root, p, det);
    const again = nameFocus ? root.querySelector(`[name="${nameFocus}"]`) : roomFocus ? root.querySelector(`[data-room="${roomFocus}"]`) : null;
    (again as HTMLElement | null)?.focus();
    announce(`Подходит ${rows.filter((a) => matchesApt(a, projectFilter())).length} из ${rows.length} квартир`);
  });
  const bodyEl = root.querySelector<HTMLElement>('#apts-body')!;
  if (pv === 'chess') { renderChess(bodyEl, p, det); return; }
  // list: filtered + sorted, same row component as search
  const list = sortApts(rows.filter((a) => matchesApt(a, projectFilter())), state.sort);
  bodyEl.innerHTML = `${dataNote(p)}${list.length ? `<ul class="alist" aria-label="Квартиры ЖК ${esc(p.name)}">${list.map((a) => aptRow(a, { favs, cmp })).join('')}</ul>`
    : rows.length ? '<div class="empty" role="status"><b>Под фильтр ничего не подходит.</b><p>Ослабьте фильтры квартир.</p></div>' : ''}`;
  bodyEl.querySelectorAll<HTMLButtonElement>('[data-open]').forEach((b) => (b.onclick = () => openApt(b.dataset.open!)));
  bodyEl.querySelectorAll<HTMLButtonElement>('[data-fav]').forEach((b) => (b.onclick = () => { toggleFav(b.dataset.fav!); (body.querySelector(`[data-fav="${CSS.escape(b.dataset.fav!)}"]`) as HTMLElement | null)?.focus(); }));
  bodyEl.querySelectorAll<HTMLButtonElement>('[data-cmp]').forEach((b) => (b.onclick = () => { toggleCmp(b.dataset.cmp!); (body.querySelector(`[data-cmp="${CSS.escape(b.dataset.cmp!)}"]`) as HTMLElement | null)?.focus(); }));
}
const isFilterEmptyLocal = () => JSON.stringify(projectFilter()) === JSON.stringify(emptyAptFilter());

function renderChess(root: HTMLElement, p: Project, det: ProjectDetail) {
  const top = Math.max(p.floorsMax || 0, ...det.apartments.map((a) => a.floor || 0), ...det.buildings.map((b) => b.floors));
  const byFloor = new Map<number, Apartment[]>();
  for (const a of det.apartments) if (a.floor != null) byFloor.set(a.floor, [...(byFloor.get(a.floor) || []), a]);
  for (const list of byFloor.values()) list.sort((a, b) => Number(a.number) - Number(b.number));
  const dups = dupNumbers(det);
  const complete = det.catalog.complete;
  const rows = [];
  for (let f = top; f >= 1; f--) {
    const list = byFloor.get(f) || [];
    const av = floorAvailability(list.filter((a) => a.status === 'свободна').length, complete);
    const empty = av === 'none' ? '<span class="cell cell--none">нет свободных</span>' : '<span class="cell cell--unknown">данных нет</span>';
    const cells = list.map((a) => { const dim = !matchesApt({ ...a, projectSlug: p.slug, floorsMax: p.floorsMax }, projectFilter()); return `<button type="button" class="cell cell--free ${dim ? 'is-dim' : ''} ${state.apt?.apartmentId === a.apartmentId ? 'is-sel' : ''}" data-apt="${esc(a.apartmentId)}" aria-label="${esc(aptLabel(a))}${dim ? ', не подходит под фильтр' : ''}">
        <b>№${esc(a.number)}${dups.has(a.number ?? '') ? '<sup aria-hidden="true">*</sup>' : ''} · ${a.rooms ? a.rooms + 'К' : esc(a.type)}</b><span>${a.area} м²</span><span>${fmtMln(a.price)}</span><span class="cell__st">${esc(a.status)}</span></button>`; }).join('');
    rows.push(`<div class="chess__row ${state.selFloor === f ? 'is-sel' : ''}" data-floor="${f}" role="group" aria-label="Этаж ${f}">
      <button type="button" class="chess__floor" data-floor-btn="${f}" aria-pressed="${state.selFloor === f}" aria-label="Этаж ${f}: показать на доме схематично">${f}</button>
      <div class="chess__cells">${cells || empty}</div></div>`);
  }
  root.innerHTML = `${dataNote(p)}
    <div class="chess-legend"><span><i class="cell--free"></i>свободна</span><span><i class="cell--none"></i>нет свободных</span><span><i class="cell--unknown"></i>данных нет</span></div>
    ${dups.size ? '<p class="note note--warn">* Номер квартиры повторяется внутри ЖК (секция не опубликована) — уточняйте у отдела продаж по этажу и площади.</p>' : ''}
    ${det.apartments.length ? `<div class="chess" role="group" aria-label="Шахматка: этажи сверху вниз"><div class="chess__head"><span>Корпус: <b>не опубликован</b></span><span>Секция: <b>не опубликована</b></span><span>Этажи ${top}–1</span></div>${rows.join('')}</div>` : ''}`;
  root.querySelectorAll<HTMLElement>('.chess__row').forEach((r) => {
    const f = Number(r.dataset.floor);
    r.onmouseenter = () => hoverFloor(f);
    r.onmouseleave = () => hoverFloor(null);
  });
  root.querySelectorAll<HTMLButtonElement>('[data-floor-btn]').forEach((b) => (b.onclick = () => {
    const f = Number(b.dataset.floorBtn);
    focusFloor(state.selFloor === f ? null : f);
    nav.replace();
  }));
  root.querySelectorAll<HTMLButtonElement>('[data-apt]').forEach((b) => (b.onclick = () => openApt(b.dataset.apt!)));
}

function openApt(apartmentId: string, opts: { push?: boolean } = {}) {
  const a = state.detail?.apartments.find((x) => x.apartmentId === apartmentId);
  if (!a) return;
  state.apt = a;
  hoverFloor(null);
  focusFloor(a.floor);
  renderPanel();
  body.scrollTop = 0;
  setSheet('full');
  if (opts.push !== false) nav.push();
  focusHeading();
  announce(`Квартира ${aptLabel(a)}`);
}

function renderAptActions() {
  const box = document.getElementById('apt-lists');
  const a = state.apt;
  if (!box || !a) return;
  const fav = favs.has(a.apartmentId), inCmp = cmp.has(a.apartmentId);
  box.innerHTML = `<button type="button" class="btn btn--ghost ${fav ? 'is-on' : ''}" data-apt-fav aria-pressed="${fav}">${fav ? '♥ В избранном' : '♡ В избранное'}</button>
    <button type="button" class="btn btn--ghost ${inCmp ? 'is-on' : ''}" data-apt-cmp aria-pressed="${inCmp}">${inCmp ? '⇄ В сравнении' : '⇄ Сравнить'}</button>
    ${cmp.size >= 2 ? `<button type="button" class="btn btn--ghost" data-go-compare>Открыть сравнение (${cmp.size})</button>` : ''}`;
  const refocus = (sel: string) => (box.querySelector(sel) as HTMLElement | null)?.focus();
  box.querySelector<HTMLButtonElement>('[data-apt-fav]')!.onclick = () => { toggleFav(a.apartmentId); refocus('[data-apt-fav]'); };
  box.querySelector<HTMLButtonElement>('[data-apt-cmp]')!.onclick = () => { toggleCmp(a.apartmentId); refocus('[data-apt-cmp]'); };
  box.querySelector<HTMLButtonElement>('[data-go-compare]')?.addEventListener('click', () => setView('compare', { push: true }));
}

function closeApt() {
  if (!state.apt) return;
  const id = state.apt.apartmentId;
  state.apt = null;
  renderPanel();
  (body.querySelector(`[data-apt="${CSS.escape(id)}"]`) as HTMLElement | null)?.focus();
}

function renderApt(p: Project, a: Apartment) {
  const dup = state.detail ? dupNumbers(state.detail).has(a.number ?? '') : false;
  body.innerHTML = `
    <button class="back" id="apt-back">← ЖК ${esc(p.name)}</button>
    <div class="apt">
      <div class="apt__plan">${a.planImageUrl ? `<img src="${esc(a.planImageUrl)}" alt="Планировка квартиры №${esc(a.number)}">` : '<div class="muted">Планировка не опубликована</div>'}</div>
      <div class="apt__head"><h2 tabindex="-1" data-focus-heading>${a.rooms ? `${a.rooms}-комнатная` : esc(a.type)}, ${a.area} м²</h2><span class="tag tag--free">${esc(a.status)}</span></div>
      <p class="badge-schematic">Этаж схематично: на доме подсвечен ${a.floor}-й этаж во всех корпусах ЖК. Корпус, секция и место квартиры на этаже не опубликованы.</p>
      <div class="kv">
        <div><span>Квартира</span><b>№${esc(a.number)}${dup ? ` <small class="muted">(этаж ${a.floor})</small>` : ''}</b></div>
        <div><span>Этаж</span><b>${a.floor ?? '—'} из ${p.floorsMax ?? '—'}</b></div>
        <div><span>Цена</span><b>${fmtTg(a.price)}</b></div>
        <div><span>За м²</span><b>${fmtTg(a.priceM2)}</b></div>
        <div><span>Корпус / секция</span><b class="muted">не опубликованы</b></div>
        <div><span>Окна / вид</span><b class="muted">нет подтверждённых данных</b></div>
      </div>
      ${dup ? '<p class="note note--warn">Номер этой квартиры повторяется внутри ЖК — при обращении называйте также этаж и площадь.</p>' : ''}
      <p class="note">Цена и статус: ${esc(a.provenance.provider)}, данные на ${fmtDate(a.updatedAt)}. Наличие может измениться — проверяйте на странице ЖК.</p>
      <div class="actions">
        <a class="btn btn--primary" href="${esc(p.url)}" target="_blank" rel="noopener">Купить на svoydom.kz ↗</a>
        ${p.tour3d ? `<a class="btn btn--ghost" href="${esc(p.tour3d)}" target="_blank" rel="noopener">3D-тур ↗</a>` : '<button class="btn btn--ghost" disabled title="Тура для этого ЖК не найдено">3D-тур — нет</button>'}
        <button class="btn btn--ghost" id="apt-request">Оставить заявку</button>
      </div>
      <div class="actions" id="apt-lists" role="group" aria-label="Избранное и сравнение"></div>
      <h3>Ипотека</h3>
      <div id="mortgage"></div>
    </div>`;
  renderAptActions();
  $('apt-back').onclick = () => nav.back(closeApt);
  $('apt-request').onclick = () => toast(`Это демо: заявки отсюда никуда не отправляются. Оставить заявку можно на <a href="${esc(p.url)}" target="_blank" rel="noopener">странице ЖК на svoydom.kz</a>.`);
  if (a.price) mortgageWidget($('mortgage'), a.price);
}

// ---------------------------------------------------------------- district
const projectCenter = (p: Project): LngLat => { const [sw, ne] = bbox(p.buildings.map((b) => b.ring)); return [(sw[0] + ne[0]) / 2, (sw[1] + ne[1]) / 2]; };
function clearDistrict() {
  (map.getSource('pois') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: [] });
  (map.getSource('iso') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: [] });
}
async function renderDistrict(root: HTMLElement, p: Project) {
  root.innerHTML = '<div class="skeleton"></div>';
  const pois = await loadDistrict(p.slug);
  const c = projectCenter(p); // radii are drawn from the ZhK itself, not from the address point
  if (state.sel !== p || state.tab !== 'district') return;
  const iso: GeoJSON.Feature[] = [15, 10, 5].flatMap((min) => {
    const r = (min * 80) / 1.3;
    return [
      { type: 'Feature', properties: { min }, geometry: { type: 'Polygon', coordinates: [circle(c, r)] } } as GeoJSON.Feature,
      { type: 'Feature', properties: { min }, geometry: { type: 'Point', coordinates: [c[0], c[1] + r / 111320] } } as GeoJSON.Feature,
    ];
  });
  (map.getSource('iso') as GeoJSONSource).setData({ type: 'FeatureCollection', features: iso });
  (map.getSource('pois') as GeoJSONSource).setData({ type: 'FeatureCollection', features: pois.filter((x) => x.d <= 1200).map((x) => ({ type: 'Feature', properties: { name: x.name, cat: x.cat, color: POI_META[x.cat].color, d: x.d }, geometry: { type: 'Point', coordinates: x.coords } })) });
  const r15 = (15 * 80) / 1.3;
  const cam = map.cameraForBounds([[c[0] - r15 / 70000, c[1] - r15 / 111320], [c[0] + r15 / 70000, c[1] + r15 / 111320]], { padding: padding() });
  if (cam) map.easeTo({ ...cam, pitch: 40, duration: dur(1100) });
  if (!pois.length) { root.innerHTML = '<p class="note">Данные OSM о районе не загружены.</p>'; return; }
  const groups = (Object.keys(POI_META) as Poi['cat'][]).map((cat) => {
    const list = pois.filter((x) => x.cat === cat);
    const in15 = list.filter((x) => WALK(x.d) <= 15).length;
    const named = list.filter((x) => x.name || cat === 'stop').slice(0, 3);
    return `<div class="dgroup"><div class="dgroup__head"><i style="background:${POI_META[cat].color}"></i><b>${POI_META[cat].label}</b><span class="muted">${in15} в 15 мин</span></div>
      ${named.map((x) => `<div class="drow"><span>${esc(x.name || 'Остановка')}</span><span class="muted">${x.d < 1000 ? x.d + ' м' : (x.d / 1000).toFixed(1) + ' км'} · ${WALK(x.d)} мин</span></div>`).join('') || '<div class="drow muted">нет в радиусе 1,5 км</div>'}</div>`;
  });
  const cr = await crimeNear(p);
  if (state.sel !== p || state.tab !== 'district') return;
  const crimeHtml = cr ? `<div class="dgroup"><div class="dgroup__head"><i style="background:#c2410c"></i><b>Преступность</b><span class="muted">${cr.n} в 500 м за 12 мес.</span></div><div class="drow muted">Зарегистрированные преступления по месту совершения (${esc(cr.doc.source)}, ${fmtDate(cr.doc.period.from)}–${fmtDate(cr.doc.period.to)}). Это не оценка безопасности дома. Тепловая карта — в «Слоях».</div></div>` : '';
  root.innerHTML = `<div class="district">${groups.join('')}${crimeHtml}</div>
    <p class="note">Источник — OpenStreetMap (данные могут быть неполными). Время пешком — по прямой ×1,3 при 80 м/мин; круги 5/10/15 мин — та же оценка, не маршрут.</p>`;
}


// ---------------------------------------------------------------- city layers: POIs (OSM) + crime heat (prosecutor's open GIS)
type CityPoi = { id: string; cat: 'education' | 'medicine' | 'shop' | 'park'; kind: string; name: string | null; addr: string | null; phone: string | null; web: string | null; c: LngLat };
type CrimeDoc = { source: string; sourceUrl: string; period: { from: string; to: string }; total: number; cellM: number; severity: Record<string, string>; topTypes: { name: string; n: number }[]; cells: { c: LngLat; n: number; s: number[]; top: [string, number][] }[] };
const LAYER_META = {
  education: { label: 'Образование', color: '#4c5bd4', hint: 'школы, сады, колледжи, вузы' },
  medicine: { label: 'Медицина', color: '#e0435f', hint: 'поликлиники, больницы, аптеки' },
  shop: { label: 'Магазины', color: '#9b6bd6', hint: 'ТРЦ и супермаркеты' },
  park: { label: 'Парки', color: '#3fa36b', hint: '' },
  crime: { label: 'Преступность', color: '#c2410c', hint: 'тепловая карта, 12 мес.' },
} as const;
type LayerKey = keyof typeof LAYER_META;
const LAYERS_KEY = 'svoydom3d-layers';
const layerOn: Record<LayerKey, boolean> = { education: true, medicine: true, shop: false, park: false, crime: false };
try { Object.assign(layerOn, JSON.parse(localStorage.getItem(LAYERS_KEY) || '{}')); } catch { /* ignore */ }
let poiCity: CityPoi[] | null = null;
let crime: CrimeDoc | null = null;
const loadJson = <T,>(f: string) => fetch(import.meta.env.BASE_URL + 'data/' + f).then((r) => { if (!r.ok) throw new Error(`${f}: HTTP ${r.status}`); return r.json() as Promise<T>; });

function renderLayerControl() {
  const box = document.getElementById('layers');
  if (!box) return;
  const counts: Partial<Record<LayerKey, number>> = poiCity ? poiCity.reduce((m, p) => ((m[p.cat] = (m[p.cat] || 0) + 1), m), {} as Record<string, number>) : {};
  box.querySelector('.layers__list')!.innerHTML = (Object.keys(LAYER_META) as LayerKey[]).map((k) => `<label class="layers__item">
      <input type="checkbox" data-layer="${k}" ${layerOn[k] ? 'checked' : ''}>
      <i style="background:${LAYER_META[k].color}" aria-hidden="true"></i>
      <span><b>${LAYER_META[k].label}</b>${counts[k] ? ` <span class="muted">${counts[k]}</span>` : ''}${LAYER_META[k].hint ? `<small>${LAYER_META[k].hint}</small>` : ''}</span></label>`).join('')
    + (layerOn.crime && crime ? `<p class="layers__src">Источник: <a href="${esc(crime.sourceUrl)}" target="_blank" rel="noopener">КПСиСУ Генпрокуратуры РК</a>, ${fmtDate(crime.period.from)}–${fmtDate(crime.period.to)}, ${crime.total.toLocaleString('ru-RU')} записей, сетка ${crime.cellM} м. Зарегистрированные преступления по месту совершения — не оценка безопасности.</p>` : '');
  box.querySelectorAll<HTMLInputElement>('[data-layer]').forEach((i) => (i.onchange = () => toggleLayer(i.dataset.layer as LayerKey, i.checked)));
}

async function toggleLayer(k: LayerKey, on: boolean) {
  layerOn[k] = on;
  try { localStorage.setItem(LAYERS_KEY, JSON.stringify(layerOn)); } catch { /* ignore */ }
  await ensureLayerData(k);
  applyLayerVisibility();
  renderLayerControl();
  announce(`${LAYER_META[k].label}: ${on ? 'показано' : 'скрыто'}`);
}

async function ensureLayerData(k: LayerKey) {
  if (!layersReady || !layerOn[k]) return;
  try {
    if (k === 'crime' && !crime) {
      crime = await loadJson<CrimeDoc>('crime.json');
      (map.getSource('crime') as GeoJSONSource).setData({ type: 'FeatureCollection', features: crime.cells.map((c, i) => ({ type: 'Feature', id: i, properties: { n: c.n, i }, geometry: { type: 'Point', coordinates: c.c } })) });
    }
    if (k !== 'crime' && !poiCity) {
      poiCity = (await loadJson<{ pois: CityPoi[] }>('poi-city.json')).pois;
      (map.getSource('poi-city') as GeoJSONSource).setData({ type: 'FeatureCollection', features: poiCity.map((p, i) => ({ type: 'Feature', id: i, properties: { i, cat: p.cat, name: p.name || p.kind, color: LAYER_META[p.cat].color }, geometry: { type: 'Point', coordinates: p.c } })) });
    }
  } catch (err) {
    console.error(err);
    toast(`Не удалось загрузить слой «${LAYER_META[k].label}». Попробуйте ещё раз позже.`);
    layerOn[k] = false;
  }
}

function applyLayerVisibility() {
  if (!layersReady) return;
  const cats = (['education', 'medicine', 'shop', 'park'] as const).filter((c) => layerOn[c]);
  const f: maplibregl.FilterSpecification = ['in', ['get', 'cat'], ['literal', cats]];
  for (const id of ['poi-city', 'poi-city-label']) { map.setFilter(id, f); map.setLayoutProperty(id, 'visibility', cats.length ? 'visible' : 'none'); }
  for (const id of ['crime-heat', 'crime-cells']) map.setLayoutProperty(id, 'visibility', layerOn.crime ? 'visible' : 'none');
}

function addCityLayers() {
  const empty: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
  map.addSource('poi-city', { type: 'geojson', data: empty });
  map.addSource('crime', { type: 'geojson', data: empty });
  map.addLayer({
    id: 'crime-heat', type: 'heatmap', source: 'crime', maxzoom: 16, layout: { visibility: 'none' },
    paint: {
      'heatmap-weight': ['interpolate', ['linear'], ['get', 'n'], 1, 0.15, 10, 0.6, 40, 1],
      'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 10, 0.6, 15, 1.6],
      'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 10, 6, 13, 14, 16, 30],
      'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 14, 0.75, 16, 0.35],
      'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'], 0, 'rgba(255,237,160,0)', 0.2, 'rgba(254,217,118,0.55)', 0.45, 'rgba(253,141,60,0.7)', 0.7, 'rgba(227,26,28,0.8)', 1, 'rgba(128,0,38,0.85)'],
    },
  }, 'osm-buildings');
  map.addLayer({
    id: 'crime-cells', type: 'circle', source: 'crime', minzoom: 14, layout: { visibility: 'none' },
    paint: { 'circle-radius': ['interpolate', ['linear'], ['get', 'n'], 1, 4, 30, 12], 'circle-color': '#c2410c', 'circle-opacity': 0.35, 'circle-stroke-color': '#7c2d12', 'circle-stroke-width': 1 },
  }, 'osm-buildings');
  map.addLayer({
    id: 'poi-city', type: 'circle', source: 'poi-city', minzoom: 12.5,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 12.5, ['match', ['get', 'cat'], ['education', 'medicine'], 4, 3], 17, ['match', ['get', 'cat'], ['education', 'medicine'], 9, 6]],
      'circle-color': ['get', 'color'], 'circle-stroke-color': '#fff', 'circle-stroke-width': ['case', ['boolean', ['feature-state', 'hover'], false], 3, 1.5],
    },
  });
  map.addLayer({
    id: 'poi-city-label', type: 'symbol', source: 'poi-city', minzoom: 15.2,
    layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': 11, 'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-max-width': 10, 'text-optional': true },
    paint: { 'text-color': ['get', 'color'], 'text-halo-color': '#fff', 'text-halo-width': 1.5 },
  });

  let hoverPoi: number | null = null;
  map.on('mousemove', 'poi-city', (e) => {
    const f = e.features![0];
    map.getCanvas().style.cursor = 'pointer';
    if (hoverPoi !== null) map.setFeatureState({ source: 'poi-city', id: hoverPoi }, { hover: false });
    hoverPoi = f.id as number; map.setFeatureState({ source: 'poi-city', id: hoverPoi }, { hover: true });
    const p = poiCity![f.properties.i];
    showTip(e, `<b>${esc(p.name || p.kind)}</b><br><span class="muted">${esc(p.kind)} · нажмите для деталей</span>`);
  });
  map.on('mouseleave', 'poi-city', () => { if (hoverPoi !== null) map.setFeatureState({ source: 'poi-city', id: hoverPoi }, { hover: false }); hoverPoi = null; map.getCanvas().style.cursor = ''; hideTip(); });
  map.on('click', 'poi-city', (e) => {
    const p = poiCity![e.features![0].properties.i];
    hideTip();
    openPopup(p.c, poiPopup(p));
  });
  map.on('click', 'crime-cells', (e) => {
    if (!crime) return;
    const cell = crime.cells[e.features![0].properties.i];
    openPopup(cell.c, crimePopup(cell));
  });
  map.on('mousemove', 'crime-cells', () => (map.getCanvas().style.cursor = 'pointer'));
  map.on('mouseleave', 'crime-cells', () => (map.getCanvas().style.cursor = ''));
}

let popup: maplibregl.Popup | null = null;
function openPopup(at: LngLat, node: HTMLElement) {
  popup?.remove();
  popup = new maplibregl.Popup({ closeButton: true, maxWidth: '280px', className: 'cpopup' }).setLngLat(at).setDOMContent(node).addTo(map);
  (node.querySelector('h3') as HTMLElement | null)?.focus();
}
const el = (tag: string, cls?: string, txt?: string) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
function poiPopup(p: CityPoi) {
  const root = el('div', `cpop cpop--${p.cat}`);
  root.append(el('span', 'cpop__kind', p.kind));
  const h = el('h3', undefined, p.name || p.kind); h.tabIndex = -1; root.append(h);
  if (p.addr) root.append(el('p', undefined, p.addr));
  if (state.sel) {
    const d = Math.round(distM(projectCenter(state.sel), p.c));
    root.append(el('p', 'cpop__dist', `До ЖК ${state.sel.name}: ${d < 1000 ? d + ' м' : (d / 1000).toFixed(1) + ' км'} · ~${WALK(d)} мин пешком (по прямой ×1,3)`));
  }
  if (p.phone) { const a = el('a', undefined, p.phone) as HTMLAnchorElement; a.href = `tel:${p.phone.replace(/[^\d+]/g, '')}`; root.append(a); }
  if (p.web && /^https?:\/\//i.test(p.web)) { const a = el('a', undefined, 'Сайт ↗') as HTMLAnchorElement; a.href = p.web; a.target = '_blank'; a.rel = 'noopener nofollow'; root.append(a); }
  const osm = el('a', 'cpop__src', 'Данные OpenStreetMap ↗') as HTMLAnchorElement;
  const [t, id] = [p.id[0], p.id.slice(1)];
  osm.href = `https://www.openstreetmap.org/${{ n: 'node', w: 'way', r: 'relation' }[t] || 'node'}/${id}`; osm.target = '_blank'; osm.rel = 'noopener';
  root.append(osm);
  return root;
}
function crimePopup(c: CrimeDoc['cells'][number]) {
  const root = el('div', 'cpop cpop--crime');
  root.append(el('span', 'cpop__kind', `Преступность · квадрат ~${crime!.cellM} м`));
  const h = el('h3', undefined, `${c.n} зарегистрир. за 12 мес.`); h.tabIndex = -1; root.append(h);
  const sev = ['небольшой тяжести', 'средней тяжести', 'тяжкие', 'особо тяжкие'].map((l, i) => (c.s[i] ? `${l}: ${c.s[i]}` : '')).filter(Boolean).join(', ');
  if (sev) root.append(el('p', undefined, sev));
  if (c.top.length) root.append(el('p', undefined, 'Чаще всего: ' + c.top.map(([n, k]) => `${n} (${k})`).join(', ')));
  root.append(el('p', 'cpop__src', `${crime!.source}, ${fmtDate(crime!.period.from)}–${fmtDate(crime!.period.to)}`));
  return root;
}

/** Crime within 500 m of a project — shown in the «Район» tab when the data is available. */
async function crimeNear(p: Project): Promise<{ n: number; doc: CrimeDoc } | null> {
  try { crime ||= await loadJson<CrimeDoc>('crime.json'); } catch { return null; }
  const c = projectCenter(p);
  return { n: crime.cells.reduce((s, x) => (distM(c, x.c) <= 500 ? s + x.n : s), 0), doc: crime };
}

// ---------------------------------------------------------------- map interactions
let hoverZhk: number | string | null = null;
// Data and the list/keyboard path start independently of the map (works with ?nomap or without WebGL).
const projectsP = loadProjects();
const appReady = projectsP.then(({ projects, fetchedAt }) => {
  state.projects = projects;
  state.fetchedAt = fetchedAt;
  const d = `Концепт-демо для SVOYDOM. Не официальный сайт. Данные с svoydom.kz на ${fmtDate(fetchedAt)}`;
  $('disclaimer-top').textContent = d;
  $('disclaimer-bottom').textContent = d;
  renderFilters();
  renderLegend();
}).catch((err) => {
  console.error(err);
  $('filters-form').innerHTML = `<div class="state-error" role="alert"><b>Не удалось загрузить список ЖК.</b><p>Проверьте соединение.</p><button class="btn btn--primary" onclick="location.reload()">Обновить страницу</button></div>`;
  throw err;
});
appReady.then(() => {
  history.replaceState({ depth: 0 }, '', location.pathname + location.search); // drop legacy #hash
  if (!mapOK) setView('list');
  // wait for the map style (max 6 s — a dead tile server must not block the list)
  const ready = mapOK ? Promise.race([mapReady, new Promise((r) => setTimeout(r, 6000))]) : Promise.resolve();
  ready.then(() => applyUrl(initialUrl)).then(() => { if (mapOK && !initialUrl.project && !initialUrl.camera) mapReady.then(introFlight); });
});
let layersReady = false; // map layers exist — guards every map style call
let resolveMapReady: () => void = () => {};
const mapReady = new Promise<void>((r) => (resolveMapReady = r));
map.once('style.load', async () => {
  await appReady;
  // keep the ⓘ attribution collapsed (MapLibre re-opens it on load/resize on wide screens); a click expands it
  const collapseAttrib = () => document.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');
  collapseAttrib();
  map.once('load', collapseAttrib);
  map.on('resize', () => setTimeout(collapseAttrib, 0));
  addLayers();
  addCityLayers();
  layersReady = true;
  renderLayerControl();
  await Promise.all((Object.keys(layerOn) as LayerKey[]).map(ensureLayerData));
  applyLayerVisibility();
  renderLayerControl();
  initFlags();
  map.on('move', updateFlags);
  map.on('moveend', saveCameraSoon);
  applyFilters();
  if (state.detail) (map.getSource('floors') as GeoJSONSource | undefined)?.setData(floorsGeoJSON(state.detail.buildings, state.detail.apartments, state.detail.catalog.complete));
  if (state.sel) { map.setFilter('zhk-3d', ['!=', ['get', 'slug'], state.sel.slug]); focusFloor(state.selFloor); }
  resolveMapReady();

  map.on('sourcedata', (e) => { if (e.sourceId === 'omt' && e.isSourceLoaded) hideOsmInsideZhk(); });
  map.on('moveend', hideOsmInsideZhk);

  map.on('click', 'clusters', async (e) => {
    const f = e.features![0];
    const zoom = await (map.getSource('pts') as GeoJSONSource).getClusterExpansionZoom(f.properties!.cluster_id);
    map.easeTo({ center: (f.geometry as GeoJSON.Point).coordinates as LngLat, zoom: zoom + 0.3, pitch: 45, duration: dur(900) });
  });
  const pick = (e: maplibregl.MapMouseEvent & { features?: MapGeoJSONFeature[] }) => { const s = e.features?.[0]?.properties?.slug; if (s) selectProject(s); };
  map.on('click', 'pts', pick);
  map.on('click', 'pts-dim', pick);
  map.on('mousemove', 'pts-dim', (e) => { map.getCanvas().style.cursor = 'pointer'; showTip(e, projTip(e.features![0].properties.slug) + '<br><span class="muted">не подходит под фильтр</span>'); });
  map.on('mouseleave', 'pts-dim', () => { map.getCanvas().style.cursor = ''; hideTip(); });
  map.on('click', 'zhk-3d', pick);
  map.on('click', 'floors-solid', (e) => { const f = e.features?.[0]; if (f) { focusFloor(state.selFloor === f.properties.floor ? null : f.properties.floor); nav.replace(); body.querySelector(`.chess__row[data-floor="${f.properties.floor}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }); } });

  const projTip = (slug: string) => {
    const p = state.projects.find((x) => x.slug === slug)!;
    return `<b>ЖК ${esc(p.name)}</b><br>${esc(p.status)}${p.deadline ? ' · ' + esc(p.deadline) : ''}${p.priceFromM2 ? `<br>от ${fmtTg(p.priceFromM2)}/м²` : ''}`;
  };
  map.on('mousemove', 'pts', (e) => { map.getCanvas().style.cursor = 'pointer'; showTip(e, projTip(e.features![0].properties.slug)); });
  map.on('mouseleave', 'pts', () => { map.getCanvas().style.cursor = ''; hideTip(); });
  map.on('mousemove', 'zhk-3d', (e) => {
    const f = e.features![0];
    map.getCanvas().style.cursor = 'pointer';
    if (hoverZhk !== null) map.setFeatureState({ source: 'zhk', id: hoverZhk }, { hover: false });
    hoverZhk = f.id!; map.setFeatureState({ source: 'zhk', id: hoverZhk }, { hover: true });
    showTip(e, projTip(f.properties.slug));
  });
  map.on('mouseleave', 'zhk-3d', () => { if (hoverZhk !== null) map.setFeatureState({ source: 'zhk', id: hoverZhk }, { hover: false }); hoverZhk = null; map.getCanvas().style.cursor = ''; hideTip(); });
  map.on('mousemove', 'floors-solid', (e) => {
    const f = e.features![0];
    map.getCanvas().style.cursor = 'pointer';
    hoverFloor(f.properties.floor);
    const av = f.properties.availability as FloorAvailability;
    const complete = !!state.detail?.catalog.complete;
    showTip(e, `Этаж ${f.properties.floor} · <span class="muted">схематично</span><br>${av === 'free' ? `свободно: ${f.properties.free}${complete ? '' : ' (из загруженных)'}` : av === 'none' ? 'нет свободных квартир' : 'данных нет — каталог неполный'}`);
  });
  map.on('mouseleave', 'floors-solid', () => { hoverFloor(null); map.getCanvas().style.cursor = ''; hideTip(); });
  map.on('mousemove', 'pois', (e) => { const f = e.features![0]; showTip(e, `${esc(f.properties.name || POI_META[f.properties.cat as Poi['cat']].label)}<br><span class="muted">${f.properties.d} м · ${WALK(f.properties.d)} мин пешком</span>`); });
  map.on('mouseleave', 'pois', hideTip);
});

// ---------------------------------------------------------------- mobile bottom sheet: 18 / 52 / 92 %
// Heights are a share of the space above the bottom navigation. Drag the handle or the photo;
// release snaps to the nearest state (a fast flick moves one state); below 12 % closes the level.
// Keyboard on the handle: Enter/Space cycles, ArrowUp/ArrowDown step, Escape goes up a level.
type Snap = 'peek' | 'half' | 'full';
const SNAP_ORDER: Snap[] = ['peek', 'half', 'full'];
const SNAP_PCT: Record<Snap, number> = { peek: 18, half: 52, full: 92 };
const SNAP_LABEL: Record<Snap, string> = { peek: 'свёрнута', half: 'половина', full: 'развёрнута' };
let sheet: Snap = 'half';
const handle = $('panel-handle');
function setSheet(s: Snap | null) {
  if (s) sheet = s;
  panel.dataset.snap = s ?? '';
  panel.classList.toggle('is-expanded', s === 'full');
  panel.style.removeProperty('--sheet-h');
  handle.setAttribute('aria-label', `Высота панели: ${SNAP_LABEL[sheet]}. Enter — изменить, стрелки вверх/вниз`);
  if (s) announce(`Панель ${SNAP_LABEL[s]}`);
}
const stepSheet = (d: 1 | -1) => setSheet(SNAP_ORDER[Math.max(0, Math.min(2, SNAP_ORDER.indexOf(sheet) + d))]);
handle.addEventListener('click', () => { if (!drag?.moved) setSheet(SNAP_ORDER[(SNAP_ORDER.indexOf(sheet) + 1) % 3]); });
handle.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowUp') { e.preventDefault(); stepSheet(1); }
  if (e.key === 'ArrowDown') { e.preventDefault(); stepSheet(-1); }
});

let drag: { id: number; y0: number; h0: number; samples: { y: number; t: number }[]; moved: boolean } | null = null;
const avail = () => window.innerHeight - (document.getElementById('appnav')?.getBoundingClientRect().height || 0);
panel.addEventListener('pointerdown', (e) => {
  if (!isMobile() || e.pointerType === 'mouse' && e.button !== 0) return;
  const t = e.target as HTMLElement;
  const onHandle = !!t.closest('.panel__handle');
  if (!onHandle && !(t.closest('.hero') && $('panel-body').scrollTop === 0)) return; // content keeps scrolling normally
  drag = { id: e.pointerId, y0: e.clientY, h0: panel.getBoundingClientRect().height, samples: [{ y: e.clientY, t: e.timeStamp }], moved: false };
  try { (onHandle ? handle : panel).setPointerCapture(e.pointerId); } catch { /* synthetic or already released pointer */ }
});
panel.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const dy = e.clientY - drag.y0;
  if (!drag.moved && Math.abs(dy) < 6) return;
  drag.moved = true;
  panel.classList.add('is-dragging');
  const h = Math.max(avail() * 0.08, Math.min(avail() * 0.96, drag.h0 - dy));
  panel.style.setProperty('--sheet-h', `${h}px`);
  drag.samples.push({ y: e.clientY, t: e.timeStamp });
  while (drag.samples.length > 2 && e.timeStamp - drag.samples[0].t > 100) drag.samples.shift(); // keep the last ~100 ms
});
const endDrag = (e: PointerEvent) => {
  if (!drag || e.pointerId !== drag.id) return;
  const d = drag;
  panel.classList.remove('is-dragging');
  setTimeout(() => (drag = null), 0); // let the click handler see `moved`
  if (!d.moved) return;
  const pct = (panel.getBoundingClientRect().height / avail()) * 100;
  // release velocity from the last ~100 ms of movement (px/ms, + = down) — a pause before letting go is not a flick
  const first = d.samples[0];
  const v = (e.clientY - first.y) / Math.max(16, e.timeStamp - first.t);
  if (pct < 12 || (sheet === 'peek' && v > 0.8)) { setSheet(sheet); goUp(); return; }
  let target: Snap;
  if (Math.abs(v) > 0.6) target = SNAP_ORDER[Math.max(0, Math.min(2, SNAP_ORDER.indexOf(sheet) + (v > 0 ? -1 : 1)))];
  else target = SNAP_ORDER.reduce((b, s) => (Math.abs(SNAP_PCT[s] - pct) < Math.abs(SNAP_PCT[b] - pct) ? s : b), 'half' as Snap);
  setSheet(target);
};
panel.addEventListener('pointerup', endDrag);
panel.addEventListener('pointercancel', endDrag);
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || (e.target as HTMLElement).closest('input, select, textarea')) return;
  if (state.sel) { e.preventDefault(); goUp(); }
});

// Back/Forward: re-apply the URL of the entry we landed on
window.addEventListener('popstate', () => applyUrl(decodeState(location.search, location.hash), { fromHistory: true }));

async function applyUrl(u: AppState, opts: { fromHistory?: boolean } = {}) {
  restoring = true;
  try {
    const f = state.filters;
    f.statuses = new Set(u.statuses); f.classes = new Set(u.classes); f.rooms = new Set(u.rooms);
    f.year = u.year; f.budget = u.budget; f.district = u.district;
    state.aptFilter = u.aptFilter; state.sort = u.sort; state.projectView = u.projectView;
    setView(u.view);
    applyFilters();
    // a project-level entry may carry a city camera if it was pushed mid-flight — don't fly away from the project
    const useCam = !!u.camera && (!u.project || u.camera.zoom >= 13);
    if (u.project && state.projects.some((p) => p.slug === u.project)) {
      if (state.sel?.slug !== u.project) await selectProject(u.project, { fly: !useCam, push: false });
      if (state.sel?.slug !== u.project || !state.detail) return;
      const apt = u.apartment ? state.detail.apartments.find((a) => a.sourceId === u.apartment) : null;
      if (u.tab !== state.tab && !apt) { state.tab = u.tab; renderPanel(); }
      if (apt) { if (state.apt?.apartmentId !== apt.apartmentId) openApt(apt.apartmentId, { push: false }); }
      else if (state.apt) closeApt();
      if (!apt) focusFloor(u.floor);
    } else if (state.sel) closeProject({ ease: !useCam });
    if (useCam && u.camera && mapOK) {
      const c = u.camera;
      const cam = { center: [c.lng, c.lat] as LngLat, zoom: c.zoom, bearing: c.bearing, pitch: c.pitch };
      opts.fromHistory ? map.easeTo({ ...cam, duration: dur(700) }) : map.jumpTo(cam);
    }
  } finally {
    restoring = false;
  }
}
