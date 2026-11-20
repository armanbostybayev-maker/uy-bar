// Stage 2b: OpenStreetMap data via Overpass (ODbL, © OpenStreetMap contributors).
//  - building outlines within 140 m of each project point -> auto footprints (overrides.json wins)
//  - POIs (schools, kindergartens, medicine, shops, parks, stops) within 1.5 km of active projects
// Two Overpass requests in total, cached in data/raw/osm/. Output: data/footprints.json, data/pois.json
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ROOT, UA } from '../scrape/http.mjs';

const CACHE = path.join(ROOT, 'data/raw/osm');
fs.mkdirSync(CACHE, { recursive: true });
const ENDPOINT = process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter';

async function overpass(query) {
  const f = path.join(CACHE, crypto.createHash('sha1').update(query).digest('hex').slice(0, 16) + '.json');
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  const endpoints = [ENDPOINT, 'https://overpass.private.coffee/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
  let json = null, wait = 5000;
  for (let attempt = 0; attempt < 6 && !json; attempt++) {
    const url = endpoints[attempt % endpoints.length];
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(query) });
      if (res.ok) json = await res.json();
      else console.warn(`  Overpass ${res.status} at ${url}, retry in ${wait / 1000}s`);
    } catch (e) { console.warn(`  Overpass error ${e.message} at ${url}`); }
    if (!json) { await new Promise((r) => setTimeout(r, wait)); wait *= 2; }
  }
  if (!json) throw new Error('Overpass unavailable, try later');
  fs.writeFileSync(f, JSON.stringify(json));
  await new Promise((r) => setTimeout(r, 2000));
  return json;
}

const M = 111320;
const dist = ([a, b], [c, d]) => Math.hypot((c - a) * M * Math.cos((b * Math.PI) / 180), (d - b) * M);
const centroid = (ring) => [ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length];

const pj = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/projects.json'), 'utf8')).projects;
const withCoords = pj.filter((p) => p.coords);
const active = withCoords.filter((p) => p.status === 'строится');

// ---- buildings
const R = 140;
const NEAR = 70; // unnamed outlines only this close to the project point
const qb = `[out:json][timeout:120];(${withCoords.map((p) => `way["building"](around:${R},${p.coords[1]},${p.coords[0]});`).join('')});out tags geom;`;
const b = await overpass(qb);
console.log(`OSM buildings near projects: ${b.elements.length}`);
const footprints = {};
const RES = /^(apartments|residential|construction|yes|house|dormitory)$/;
for (const p of withCoords) footprints[p.slug] = [];
for (const el of b.elements) {
  if (!el.geometry || !RES.test(el.tags.building)) continue;
  const ring = el.geometry.map((g) => [+g.lon.toFixed(7), +g.lat.toFixed(7)]);
  const c = centroid(ring);
  // nearest project wins, only within radius
  let best = null, bd = Infinity;
  for (const p of withCoords) { const d = dist(c, p.coords); if (d < bd) { bd = d; best = p; } }
  if (!best || bd > R) continue;
  const levels = Number(el.tags['building:levels']) || null;
  const height = Number(String(el.tags.height || '').replace(',', '.')) || null;
  const isResidential = el.tags.building === 'apartments' || el.tags.building === 'residential' || el.tags.building === 'construction' || (levels && levels >= 5);
  if (!isResidential) continue;
  // Skip outlines that belong to another named complex; accept named matches up to R, unnamed only close to the point.
  const osmName = el.tags.name || null;
  const norm = (x) => String(x || '').toLowerCase().replace(/^жк\s*|\s*жк$/g, '').replace(/[^a-zа-яёәіңғүұқөһ0-9]+/gi, '');
  const pn = norm(best.name).replace(/\d+$/, '');
  const nameMatch = osmName && pn && norm(osmName).includes(pn);
  if (osmName && !nameMatch && !/^\d/.test(osmName)) continue;
  if (!nameMatch && bd > NEAR) continue;
  footprints[best.slug].push({ osmId: el.id, ring, floors: levels, height, building: el.tags.building, name: osmName, housenumber: el.tags['addr:housenumber'] || null, nameMatch: !!nameMatch, distM: Math.round(bd) });
}
fs.writeFileSync(path.join(ROOT, 'data/footprints.json'), JSON.stringify({ source: 'OpenStreetMap via Overpass, ODbL', radiusM: R, footprints }, null, 1));
for (const p of withCoords.filter((p) => p.status === 'строится')) console.log(`  ${p.name.padEnd(16)} OSM-контуров: ${footprints[p.slug].length}`);

// ---- POIs
const PR = 1500;
const sel = [
  'node["amenity"~"^(school|kindergarten|clinic|hospital|doctors|pharmacy)$"]', 'way["amenity"~"^(school|kindergarten|clinic|hospital)$"]',
  'node["shop"~"^(supermarket|convenience|mall)$"]', 'way["shop"~"^(supermarket|mall)$"]',
  'way["leisure"="park"]', 'relation["leisure"="park"]',
  'node["highway"="bus_stop"]',
];
const qp = `[out:json][timeout:180];(${active.flatMap((p) => sel.map((s) => `${s}(around:${PR},${p.coords[1]},${p.coords[0]});`)).join('')});out tags center;`;
const pois = await overpass(qp);
const cat = (t) => t.amenity === 'school' ? 'school' : t.amenity === 'kindergarten' ? 'kindergarten' : /clinic|hospital|doctors|pharmacy/.test(t.amenity || '') ? 'medicine' : t.shop ? 'shop' : t.leisure === 'park' ? 'park' : t.highway === 'bus_stop' ? 'stop' : 'other';
const items = pois.elements.map((e) => ({ id: `${e.type[0]}${e.id}`, cat: cat(e.tags || {}), name: e.tags?.name || e.tags?.['name:ru'] || null, coords: e.lon != null ? [e.lon, e.lat] : [e.center.lon, e.center.lat] })).filter((x) => x.cat !== 'other');
fs.writeFileSync(path.join(ROOT, 'data/pois.json'), JSON.stringify({ source: 'OpenStreetMap via Overpass, ODbL', radiusM: PR, pois: items }, null, 1));
const byCat = items.reduce((m, x) => ((m[x.cat] = (m[x.cat] || 0) + 1), m), {});
console.log('POIs:', items.length, byCat);
