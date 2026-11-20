// Stage 2a: verify project coordinates.
// Primary coords come from SVOYDOM's own projects-data JSON; Nominatim (OSM) geocodes the address as a cross-check.
// 1 request/s, cached in data/raw/nominatim/. Results -> data/geo-check.json; overrides.json always wins.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ROOT, UA } from '../scrape/http.mjs';

const CACHE = path.join(ROOT, 'data/raw/nominatim');
fs.mkdirSync(CACHE, { recursive: true });
const ASTANA = { minLon: 71.2, maxLon: 71.75, minLat: 50.95, maxLat: 51.35 };
const inAstana = ([lon, lat]) => lon > ASTANA.minLon && lon < ASTANA.maxLon && lat > ASTANA.minLat && lat < ASTANA.maxLat;
const dist = ([a, b], [c, d]) => {
  const R = 6371000, r = Math.PI / 180;
  const x = (c - a) * r * Math.cos(((b + d) / 2) * r), y = (d - b) * r;
  return Math.round(Math.hypot(x, y) * R);
};

let last = 0;
async function nominatim(q) {
  const f = path.join(CACHE, crypto.createHash('sha1').update(q).digest('hex').slice(0, 16) + '.json');
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  const wait = last + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  last = Date.now();
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=kz&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'ru' } });
  const json = await res.json();
  fs.writeFileSync(f, JSON.stringify({ q, json }));
  return { q, json };
}

const clean = (a) => a.replace(/^(Коммерческие помещения,?\s*)/i, '').replace(/\buch\.|уч\.\s*/gi, '').replace(/^(район [^,]+,\s*)/i, '').trim();

const pj = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/projects.json'), 'utf8'));
const overridesFile = path.join(ROOT, 'data/overrides.json');
if (!fs.existsSync(overridesFile)) fs.writeFileSync(overridesFile, JSON.stringify({ _comment: 'Ручные правки. Ключ — slug ЖК. Поля: coords [lon,lat], footprints [{ring:[[lon,lat],...], floors, name}], floorsMax. Важнее авто-данных.', projects: {} }, null, 1));
const overrides = JSON.parse(fs.readFileSync(overridesFile, 'utf8')).projects || {};

const out = [];
for (const p of pj.projects) {
  const q = `${clean(p.address || '')}, Астана`;
  const { json } = await nominatim(q);
  const hit = json[0] ? [Number(json[0].lon), Number(json[0].lat)] : null;
  const d = hit && p.coords ? dist(p.coords, hit) : null;
  const flags = [];
  if (!p.coords) flags.push('нет координат на сайте');
  else if (!inAstana(p.coords)) flags.push('точка вне Астаны');
  if (!hit) flags.push('адрес не найден в OSM');
  else if (!['building', 'house', 'residential', 'amenity', 'place'].includes(json[0].addresstype) && d > 300) flags.push(`OSM нашёл только ${json[0].addresstype} (${(d / 1000).toFixed(1)} км) — проверка неточная`);
  else if (d > 1500) flags.push(`адрес в OSM в ${(d / 1000).toFixed(1)} км от точки сайта`);
  const twin = pj.projects.find((o) => o !== p && o.coords && p.coords && dist(o.coords, p.coords) < 15);
  if (twin) flags.push(`та же точка, что у ${twin.name}`);
  if (overrides[p.slug]?.coords) flags.push('исправлено вручную (overrides)');
  out.push({ slug: p.slug, name: p.name, status: p.status, address: p.address, site: p.coords, nominatim: hit, nominatimName: json[0]?.display_name || null, distanceM: d, flags });
  console.log(`${p.name.padEnd(22)} ${String(d ?? '—').padStart(6)} м  ${flags.join('; ')}`);
}
fs.writeFileSync(path.join(ROOT, 'data/geo-check.json'), JSON.stringify(out, null, 1));
const bad = out.filter((o) => o.flags.some((f) => /вне|км от точки|нет коорд|та же точка/.test(f)));
for (const b of bad) console.log('  сомнительно:', b.name, '—', b.flags.join('; '));
console.log(`\nПроверено ${out.length}; сомнительных: ${bad.length}; адрес не найден в OSM: ${out.filter((o) => !o.nominatim).length}`);
