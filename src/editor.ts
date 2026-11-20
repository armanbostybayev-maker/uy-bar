// Footprint editor: click to outline a building, set floors, export JSON for data/overrides.json.
import maplibregl, { GeoJSONSource } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import { mapStyle } from './style-map';
import { loadProjects, esc, type Project, type LngLat } from './data';
import { buildingHeight } from './geo';

interface Fp { ring: LngLat[]; floors: number; name: string }
interface Ov { coords?: LngLat; footprints?: Fp[]; floorsMax?: number }

const KEY = 'svoydom3d-overrides-draft';
let overrides: Record<string, Ov> = {};
try { overrides = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { /* private mode */ }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(overrides)); } catch { /* ignore */ } };

let projects: Project[] = [];
let sel: Project | null = null;
let draft: LngLat[] = [];
let mode: 'draw' | 'point' = 'draw';
let floors = 12;

const map = new maplibregl.Map({ container: 'map', style: mapStyle, center: [71.43, 51.125], zoom: 11, pitch: 0, maxPitch: 70 });
map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');

const fc = (features: GeoJSON.Feature[]): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features });
function redraw() {
  const ov = sel ? overrides[sel.slug] : undefined;
  const fps = ov?.footprints || [];
  (map.getSource('done') as GeoJSONSource).setData(fc(fps.map((f) => ({ type: 'Feature', properties: { h: buildingHeight(f.floors) }, geometry: { type: 'Polygon', coordinates: [f.ring] } }))));
  (map.getSource('draft') as GeoJSONSource).setData(fc([
    ...(draft.length > 1 ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: draft } } as GeoJSON.Feature] : []),
    ...draft.map((c) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: c } }) as GeoJSON.Feature),
  ]));
  const pt = ov?.coords || sel?.coords;
  (map.getSource('pt') as GeoJSONSource).setData(fc(pt ? [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: pt } }] : []));
  ui();
}

function ui() {
  const ov = sel ? overrides[sel.slug] : undefined;
  const json = JSON.stringify({ projects: overrides }, null, 1);
  document.getElementById('ed')!.innerHTML = `
    <div class="filters__head"><b>Редактор контуров</b></div>
    <div class="fgroup"><div class="flabel">ЖК</div>
      <select id="e-proj"><option value="">— выберите ЖК —</option>${projects.map((p) => `<option value="${p.slug}" ${sel?.slug === p.slug ? 'selected' : ''}>${esc(p.name)} (${p.status}${overrides[p.slug] ? ', ✎' : ''})</option>`).join('')}</select></div>
    ${sel ? `
    <div class="fgroup"><div class="flabel">Режим</div>
      <button class="chip ${mode === 'draw' ? 'is-on' : ''}" data-mode="draw">Обвести корпус</button><button class="chip ${mode === 'point' ? 'is-on' : ''}" data-mode="point">Поставить точку ЖК</button></div>
    <div class="fgroup"><div class="flabel">Этажность корпуса</div><input id="e-floors" type="number" min="1" max="60" value="${floors}"></div>
    <p class="note">${mode === 'draw' ? `Кликайте по углам корпуса (${draft.length} точек). Затем «Сохранить корпус».` : 'Кликните по карте, чтобы задать точку ЖК.'}</p>
    <div class="actions">
      <button class="btn btn--primary btn--sm" id="e-close" ${draft.length < 3 ? 'disabled' : ''}>Сохранить корпус</button>
      <button class="btn btn--ghost btn--sm" id="e-undo" ${draft.length ? '' : 'disabled'}>Отменить точку</button>
    </div>
    <div class="fgroup" style="margin-top:12px"><div class="flabel">Корпуса (${ov?.footprints?.length || 0})</div>
      ${(ov?.footprints || []).map((f, i) => `<div class="drow"><span>${esc(f.name)} · ${f.floors} эт.</span><button class="btn btn--ghost btn--sm" data-del="${i}">Удалить</button></div>`).join('') || '<div class="muted">нет — на карте будут контуры OSM или схема</div>'}
    </div>` : ''}
    <div class="fgroup" style="margin-top:12px"><div class="flabel">overrides.json</div>
      <textarea id="e-json" rows="6" style="width:100%;font:11px monospace;border-radius:10px;border:1px solid var(--line);padding:6px">${esc(json)}</textarea>
      <div class="actions"><button class="btn btn--ghost btn--sm" id="e-copy">Копировать</button><button class="btn btn--ghost btn--sm" id="e-dl">Скачать</button><button class="btn btn--ghost btn--sm" id="e-load">Применить из поля</button></div>
      <p class="note">Сохраните файл как <code>data/overrides.json</code> и выполните <code>npm run build</code>. Черновик хранится только в этом браузере.</p>
    </div>`;
  const q = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null;
  q<HTMLSelectElement>('e-proj')!.onchange = (e) => {
    sel = projects.find((p) => p.slug === (e.target as HTMLSelectElement).value) || null; draft = [];
    if (sel) { floors = sel.floorsMax || 12; map.flyTo({ center: sel.coords, zoom: 17, pitch: 0, bearing: 0, duration: 1200 }); }
    redraw();
  };
  document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => (b.onclick = () => { mode = b.dataset.mode as typeof mode; ui(); }));
  const fl = q<HTMLInputElement>('e-floors'); if (fl) fl.onchange = () => (floors = Number(fl.value) || 1);
  const close = q('e-close'); if (close) close.onclick = () => {
    const o = (overrides[sel!.slug] ||= {});
    (o.footprints ||= []).push({ ring: [...draft, draft[0]].map(([x, y]) => [+x.toFixed(7), +y.toFixed(7)] as LngLat), floors, name: `Корпус ${o.footprints.length + 1}` });
    o.floorsMax = Math.max(o.floorsMax || 0, floors);
    draft = []; save(); redraw();
  };
  const undo = q('e-undo'); if (undo) undo.onclick = () => { draft.pop(); redraw(); };
  document.querySelectorAll<HTMLButtonElement>('[data-del]').forEach((b) => (b.onclick = () => { overrides[sel!.slug].footprints!.splice(Number(b.dataset.del), 1); save(); redraw(); }));
  q('e-copy')!.onclick = () => navigator.clipboard?.writeText(json);
  q('e-dl')!.onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify({ _comment: 'Ручные правки. Ключ — slug ЖК.', projects: overrides }, null, 1)], { type: 'application/json' }));
    a.download = 'overrides.json'; a.click();
  };
  q('e-load')!.onclick = () => { try { overrides = JSON.parse(q<HTMLTextAreaElement>('e-json')!.value).projects || {}; save(); redraw(); } catch { alert('Некорректный JSON'); } };
}

map.on('load', async () => {
  projects = (await loadProjects()).projects.sort((a, b) => (a.status === b.status ? a.name.localeCompare(b.name) : a.status === 'строится' ? -1 : 1));
  map.addSource('done', { type: 'geojson', data: fc([]) });
  map.addSource('draft', { type: 'geojson', data: fc([]) });
  map.addSource('pt', { type: 'geojson', data: fc([]) });
  map.addSource('all', { type: 'geojson', data: fc(projects.flatMap((p) => p.buildings.map((b) => ({ type: 'Feature', properties: { src: p.geometrySource }, geometry: { type: 'Polygon', coordinates: [b.ring] } }) as GeoJSON.Feature))) });
  map.addLayer({ id: 'all', type: 'line', source: 'all', paint: { 'line-color': ['match', ['get', 'src'], 'schematic', '#ff6b2c', '#3a5bff'], 'line-width': 1.5, 'line-dasharray': [2, 1] } });
  map.addLayer({ id: 'done', type: 'fill-extrusion', source: 'done', paint: { 'fill-extrusion-color': '#3a5bff', 'fill-extrusion-height': ['get', 'h'], 'fill-extrusion-opacity': 0.75 } });
  map.addLayer({ id: 'draft-line', type: 'line', source: 'draft', paint: { 'line-color': '#ff6b2c', 'line-width': 2 } });
  map.addLayer({ id: 'draft-pt', type: 'circle', source: 'draft', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 5, 'circle-color': '#ff6b2c', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
  map.addLayer({ id: 'pt', type: 'circle', source: 'pt', paint: { 'circle-radius': 8, 'circle-color': '#22b07d', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
  map.setPaintProperty('osm-buildings', 'fill-extrusion-height', 0);
  map.setPaintProperty('osm-buildings', 'fill-extrusion-opacity', 0.9);
  redraw();
});
map.on('click', (e) => {
  if (!sel) return;
  const c: LngLat = [e.lngLat.lng, e.lngLat.lat];
  if (mode === 'draw') draft.push(c);
  else { (overrides[sel.slug] ||= {}).coords = [+c[0].toFixed(7), +c[1].toFixed(7)]; save(); }
  redraw();
});
