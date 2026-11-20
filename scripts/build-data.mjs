// Merge scraped data + OSM + overrides into compact files the web app loads.
//   public/data/projects.json          — all projects (light)
//   public/data/apts/{slug}.json       — apartments + building geometry per project (lazy)
//   public/data/district/{slug}.json   — OSM POIs around active projects (lazy)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rd = (f, d = null) => (fs.existsSync(path.join(ROOT, f)) ? JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8')) : d);
const OUT = path.join(ROOT, 'public/data');
for (const d of ['', 'apts', 'district']) fs.mkdirSync(path.join(OUT, d), { recursive: true });

const pj = rd('data/projects.json');
const apts = rd('data/apartments.json').apartments;
const fp = rd('data/footprints.json', { footprints: {} }).footprints;
const pois = rd('data/pois.json', { pois: [] }).pois;
const geo = Object.fromEntries((rd('data/geo-check.json', []) || []).map((g) => [g.slug, g]));
const ov = rd('data/overrides.json', { projects: {} }).projects || {};
const facts = rd('data/site-facts.json', {}); // floors / sections / entrances quoted on svoydom.kz

const M = 111320;
const dist = ([a, b], [c, d]) => Math.hypot((c - a) * M * Math.cos((b * Math.PI) / 180), (d - b) * M);
const offset = ([lon, lat], dx, dy) => [lon + dx / (M * Math.cos((lat * Math.PI) / 180)), lat + dy / M];
const round = (r) => r.map(([x, y]) => [+x.toFixed(7), +y.toFixed(7)]);

// Schematic sections (clearly labelled in UI) when neither OSM nor overrides give an outline:
// N section blocks 20×16 m in rows of up to 4 (N = sections published on svoydom.kz, else 1).
function schematicSections(center, n) {
  const w = 20, d = 16, rowGap = 26, perRow = 4;
  const rows = Math.ceil(n / perRow);
  const out = [];
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / perRow), k = i % perRow, inRow = Math.min(perRow, n - r * perRow);
    const cx = (k - (inRow - 1) / 2) * w, cy = ((rows - 1) / 2 - r) * (d + rowGap);
    const c = offset(center, cx, cy);
    out.push(round([[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2], [-w / 2, -d / 2]].map(([x, y]) => offset(c, x, y))));
  }
  return out;
}
// Schematic block (clearly labelled in UI) when neither OSM nor overrides give an outline.
function schematic(center, i, n) {
  const w = 54, d = 16, gap = 30;
  const cx = (i - (n - 1) / 2) * 0, cy = (i - (n - 1) / 2) * (d + gap);
  const c = offset(center, cx, cy);
  const ring = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2], [-w / 2, -d / 2]].map(([x, y]) => offset(c, x, y));
  return round(ring);
}
// Facade orientation of the longest edge (for "окна на" hint): returns compass names of both long sides.
function facades(ring) {
  let best = null, bl = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i], b = ring[i + 1];
    const l = dist(a, b);
    if (l > bl) { bl = l; best = [a, b]; }
  }
  if (!best) return null;
  const [a, b] = best;
  const dx = (b[0] - a[0]) * Math.cos((a[1] * Math.PI) / 180), dy = b[1] - a[1];
  const normal = ((Math.atan2(dx, dy) * 180) / Math.PI + 90 + 360) % 360; // bearing perpendicular to long edge
  const names = ['север', 'северо-восток', 'восток', 'юго-восток', 'юг', 'юго-запад', 'запад', 'северо-запад'];
  const nm = (deg) => names[Math.round(((deg + 360) % 360) / 45) % 8];
  return [nm(normal), nm(normal + 180)];
}

// The site lists some projects twice: a legacy /project/… page (noindex + redirect) and the canonical one.
// Keep one entry per slug, preferring the canonical URL.
const isLegacy = (u) => /\/project\/\d+\//.test(u);
const bySlug = new Map();
for (const p of pj.projects) {
  const prev = bySlug.get(p.slug);
  if (!prev || (isLegacy(prev.url) && !isLegacy(p.url))) bySlug.set(p.slug, p);
}
const dropped = pj.projects.length - bySlug.size;
if (dropped) console.log(`build-data: dropped ${dropped} duplicate project entr${dropped === 1 ? 'y' : 'ies'} (legacy /project/ URLs)`);

const projects = [];
for (const p of bySlug.values()) {
  const o = ov[p.slug] || {};
  const coords = o.coords || p.coords;
  if (!coords) continue;
  const sf = facts[p.slug] || null;
  const floorsMax = o.floorsMax || sf?.floorsMax || p.floorsMax || null;
  let buildings, source;
  if (o.footprints?.length) { buildings = o.footprints.map((f, i) => ({ ring: f.ring, floors: f.floors || floorsMax || 9, name: f.name || `Корпус ${i + 1}` })); source = 'overrides'; }
  else if (fp[p.slug]?.length) { buildings = fp[p.slug].map((f, i) => ({ ring: f.ring, floors: f.floors || (f.height ? Math.round(f.height / 3) : floorsMax || 9), name: f.housenumber ? `Дом ${f.housenumber}` : `Корпус ${i + 1}`, osmId: f.osmId })); source = 'osm'; }
  else { const n = Math.min(10, sf?.sections || 1); buildings = schematicSections(coords, n).map((ring, i) => ({ ring, floors: floorsMax || 9, name: n > 1 ? `Секция ${i + 1} (схема)` : 'Схема корпуса' })); source = 'schematic'; }
  for (const b of buildings) b.facades = facades(b.ring);
  const mine = apts.filter((a) => a.projectSlug === p.slug);
  const g = geo[p.slug];
  const proj = {
    slug: p.slug, name: p.name, class: p.class, status: p.status, deadline: p.deadline, deadlineYear: p.deadlineYear,
    address: p.address, district: p.district, url: p.url, image: p.images[0] || null, images: p.images.slice(0, 6),
    description: p.description, priceFrom: p.priceFrom, priceFromM2: p.priceFromM2, rooms: p.rooms,
    coords, coordsFlags: (g?.flags || []).filter((f) => /вне|км от точки|та же точка|вручную/.test(f)),
    floorsMax, apartmentsTotal: p.apartmentsTotal, apartmentsLoaded: mine.length, tour3d: p.tour3d,
    geometrySource: source, buildingCount: buildings.length,
    siteFacts: sf ? { floorsMin: sf.floorsMin, floorsMax: sf.floorsMax, sections: sf.sections, entrances: sf.entrances, quotes: sf.quotes } : null,
    buildings: buildings.map((b) => ({ ring: b.ring, floors: b.floors, name: b.name })),
    osmIds: (fp[p.slug] || []).map((f) => f.osmId),
  };
  // ---- topology contract: project → building → section → floor → apartment (schema svoydom3d/detail@2)
  // Building/section/position are NOT in the public source, so they stay null with topology 'floor-only'.
  const fetchedAt = pj.fetchedAt;
  const provenance = { provider: 'svoydom.kz', method: 'public HTML (robots.txt-compliant)', url: p.url, fetchedAt };
  const geomAccuracy = { overrides: 'manual', osm: 'footprint', schematic: 'schematic' }[source];
  const bOut = buildings.map((b, i) => ({
    buildingId: `${p.slug}:b${i + 1}`, name: b.name, floors: b.floors, ring: b.ring, facades: b.facades,
    geometry: { source, accuracy: geomAccuracy, osmId: b.osmId ?? null },
  }));
  const aOut = mine.map((a) => ({
    apartmentId: `${p.slug}:${a.id}`, sourceId: a.id, xmlId: a.xmlId, projectSlug: p.slug,
    buildingId: null, sectionId: null, floorId: null, floor: a.floor, position: null, topology: 'floor-only',
    number: a.number, rooms: a.rooms, type: a.type, area: a.area, price: a.price, priceM2: a.priceM2,
    status: a.status, planImageUrl: a.planImageUrl, provenance, updatedAt: fetchedAt,
  }));
  const total = p.apartmentsTotal ?? null;
  const catalog = { total, loaded: aOut.length, complete: total != null && aOut.length >= total, source: provenance, updatedAt: fetchedAt };
  proj.catalog = { total, loaded: aOut.length, complete: catalog.complete, updatedAt: fetchedAt };
  proj.buildings = bOut.map((b) => ({ buildingId: b.buildingId, ring: b.ring, floors: b.floors, name: b.name }));
  projects.push(proj);
  fs.writeFileSync(path.join(OUT, 'apts', `${p.slug}.json`), JSON.stringify({ schema: 'svoydom3d/detail@2', slug: p.slug, updatedAt: fetchedAt, catalog, buildings: bOut, sections: [], apartments: aOut }));
  if (p.status === 'строится') {
    const xs = buildings.flatMap((b) => b.ring.map((q) => q[0])), ys = buildings.flatMap((b) => b.ring.map((q) => q[1]));
    const center = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2]; // distances from the ZhK itself
    const near = pois.map((x) => ({ ...x, d: Math.round(dist(center, x.coords)) })).filter((x) => x.d <= 1500).sort((a, b) => a.d - b.d);
    fs.writeFileSync(path.join(OUT, 'district', `${p.slug}.json`), JSON.stringify(near));
  }
}
fs.writeFileSync(path.join(OUT, 'projects.json'), JSON.stringify({ fetchedAt: pj.fetchedAt, projects }));

// Cross-project apartment index for search / favourites / compare (small: only published units).
const index = [];
for (const p of projects) {
  const d = JSON.parse(fs.readFileSync(path.join(OUT, 'apts', `${p.slug}.json`), 'utf8'));
  for (const a of d.apartments) {
    index.push({
      apartmentId: a.apartmentId, sourceId: a.sourceId, projectSlug: p.slug, projectName: p.name, projectStatus: p.status, projectClass: p.class,
      deadline: p.deadline, district: p.district, url: p.url, catalogComplete: d.catalog.complete,
      number: a.number, rooms: a.rooms, area: a.area, price: a.price, priceM2: a.priceM2, floor: a.floor, floorsMax: p.floorsMax,
      status: a.status, planImageUrl: a.planImageUrl, buildingId: a.buildingId, sectionId: a.sectionId, updatedAt: a.updatedAt,
    });
  }
}
fs.writeFileSync(path.join(OUT, 'apartments-index.json'), JSON.stringify({ schema: 'svoydom3d/apartments-index@1', updatedAt: pj.fetchedAt, apartments: index }));
console.log(`build-data: apartments-index ${index.length} rows`);
console.log(`build-data: ${projects.length} projects; geometry: ${['overrides', 'osm', 'schematic'].map((s) => `${s} ${projects.filter((p) => p.geometrySource === s).length}`).join(', ')}`);
