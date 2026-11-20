// City-wide clickable POIs from OpenStreetMap (Overpass, ODbL): education and medicine, plus other key places.
// One cached Overpass request for the Astana bbox. Output: public/data/poi-city.json
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ROOT, UA } from '../scrape/http.mjs';

const CACHE = path.join(ROOT, 'data/raw/osm');
fs.mkdirSync(CACHE, { recursive: true });
const BB = '50.95,71.2,51.35,71.75'; // s,w,n,e
const query = `[out:json][timeout:180];(
  nwr["amenity"~"^(school|kindergarten|college|university)$"](${BB});
  nwr["amenity"~"^(clinic|hospital|doctors|dentist|pharmacy)$"](${BB});
  nwr["healthcare"~"^(clinic|hospital|centre|doctor)$"](${BB});
  nwr["shop"~"^(mall|supermarket)$"](${BB});
  nwr["leisure"="park"]["name"](${BB});
);out tags center;`;

async function overpass(q) {
  const f = path.join(CACHE, crypto.createHash('sha1').update(q).digest('hex').slice(0, 16) + '.json');
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  const endpoints = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
  let wait = 5000;
  for (let i = 0; i < 6; i++) {
    const url = endpoints[i % endpoints.length];
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(q) });
      if (res.ok) { const j = await res.json(); fs.writeFileSync(f, JSON.stringify(j)); return j; }
      console.warn(`  Overpass ${res.status} at ${url}`);
    } catch (e) { console.warn(`  Overpass ${e.message}`); }
    await new Promise((r) => setTimeout(r, wait)); wait *= 2;
  }
  throw new Error('Overpass unavailable');
}

const KIND = {
  school: ['education', 'Школа'], kindergarten: ['education', 'Детский сад'], college: ['education', 'Колледж'], university: ['education', 'Университет'],
  clinic: ['medicine', 'Поликлиника'], hospital: ['medicine', 'Больница'], doctors: ['medicine', 'Медцентр'], dentist: ['medicine', 'Стоматология'], pharmacy: ['medicine', 'Аптека'],
  centre: ['medicine', 'Медцентр'], doctor: ['medicine', 'Медцентр'],
  mall: ['shop', 'ТРЦ'], supermarket: ['shop', 'Супермаркет'], park: ['park', 'Парк'],
};
const j = await overpass(query);
const seen = new Set();
const pois = [];
for (const e of j.elements) {
  const t = e.tags || {};
  const key = t.amenity in KIND ? t.amenity : t.healthcare in KIND ? t.healthcare : t.shop in KIND ? t.shop : t.leisure === 'park' ? 'park' : null;
  if (!key) continue;
  const lon = e.lon ?? e.center?.lon, lat = e.lat ?? e.center?.lat;
  if (lon == null) continue;
  const name = t['name:ru'] || t.name || null;
  const dedup = `${key}|${name}|${lon.toFixed(4)}|${lat.toFixed(4)}`;
  if (seen.has(dedup)) continue;
  seen.add(dedup);
  const [cat, kindLabel] = KIND[key];
  const addr = [t['addr:street'], t['addr:housenumber']].filter(Boolean).join(', ') || null;
  pois.push({ id: `${e.type[0]}${e.id}`, cat, kind: kindLabel, name, addr, phone: t.phone || t['contact:phone'] || null, web: t.website || t['contact:website'] || null, c: [+lon.toFixed(6), +lat.toFixed(6)] });
}
fs.writeFileSync(path.join(ROOT, 'public/data/poi-city.json'), JSON.stringify({ source: 'OpenStreetMap via Overpass, ODbL', fetchedAt: new Date().toISOString().slice(0, 10), pois }));
const by = pois.reduce((m, p) => ((m[p.cat] = (m[p.cat] || 0) + 1), m), {});
console.log('poi-city:', pois.length, by);
