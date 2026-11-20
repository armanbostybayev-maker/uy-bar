// Crime heat layer from the open GIS of the Committee on Legal Statistics (Prosecutor General's Office, RK):
//   https://qamqor.gov.kz/ru/gis → «Карта преступности» → ArcGIS FeatureServer KPSSU/crime/1 (public, no auth;
//   gis.kgp.kz has no robots.txt). Polite: ≤ 1 request / 2 s, every page cached in data/raw/crime/.
// Privacy: only point, year/month, article code and severity are requested — NO case number (ud), registering
// body or street/house. Points are aggregated to a ~100 m grid before they reach the browser.
// Output: public/data/crime.json
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ROOT, UA } from '../scrape/http.mjs';

const SVC = 'https://gis.kgp.kz/arcgis/rest/services/KPSSU/crime/FeatureServer/1';
const CACHE = path.join(ROOT, 'data/raw/crime');
fs.mkdirSync(CACHE, { recursive: true });
const BBOX = { xmin: 71.2, ymin: 50.95, xmax: 71.75, ymax: 51.35 };
const MONTHS = Number(process.env.CRIME_MONTHS || 12);
const PAGE = 2000;

let last = 0;
async function get(url) {
  const f = path.join(CACHE, crypto.createHash('sha1').update(url).digest('hex').slice(0, 16) + '.json');
  if (fs.existsSync(f) && process.env.REFRESH !== '1') return JSON.parse(fs.readFileSync(f, 'utf8'));
  const wait = last + 2000 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  last = Date.now();
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const json = await res.json();
  if (json.error) throw new Error(JSON.stringify(json.error));
  fs.writeFileSync(f, JSON.stringify(json));
  return json;
}
const q = (params) => `${SVC}/query?` + new URLSearchParams({ f: 'json', ...params }).toString();

const meta = await get(`${SVC}?f=json`);
const domain = (name) => Object.fromEntries((meta.fields.find((f) => f.name === name)?.domain?.codedValues || []).map((c) => [c.code, c.name]));
const CRIME = domain('crime_code'), HARD = domain('hard_code');

// newest date in the bbox → window of the last N months
const geo = { geometry: JSON.stringify({ ...BBOX, spatialReference: { wkid: 4326 } }), geometryType: 'esriGeometryEnvelope', inSR: '4326', spatialRel: 'esriSpatialRelIntersects' };
const st = await get(q({ where: '1=1', ...geo, outStatistics: JSON.stringify([{ statisticType: 'max', onStatisticField: 'dat_sover', outStatisticFieldName: 'maxd' }]) }));
const maxd = new Date(st.features[0].attributes.maxd);
const from = new Date(Date.UTC(maxd.getUTCFullYear(), maxd.getUTCMonth() - MONTHS, maxd.getUTCDate()));
const iso = (d) => d.toISOString().slice(0, 10);
const where = `dat_sover >= DATE '${iso(from)}'`;
const { count } = await get(q({ where, ...geo, returnCountOnly: 'true' }));
console.log(`crime: ${count} records ${iso(from)} … ${iso(maxd)} in Astana bbox`);

const rows = [];
for (let off = 0; off < count; off += PAGE) {
  const page = await get(q({ where, ...geo, outFields: 'crime_code,hard_code,transgression', returnGeometry: 'true', outSR: '4326', orderByFields: 'objectid', resultOffset: String(off), resultRecordCount: String(PAGE) }));
  for (const f of page.features) if (f.geometry) rows.push({ x: f.geometry.x, y: f.geometry.y, c: f.attributes.crime_code, h: f.attributes.hard_code, t: f.attributes.transgression });
  process.stdout.write(`\r  fetched ${Math.min(off + PAGE, count)}/${count}`);
}
console.log();

// aggregate to ~100 m cells
const DY = 0.0009, DX = 0.00144; // ≈ 100 m at 51°N
const cells = new Map();
for (const r of rows) {
  if (r.x < BBOX.xmin || r.x > BBOX.xmax || r.y < BBOX.ymin || r.y > BBOX.ymax) continue;
  const k = `${Math.floor(r.x / DX)}:${Math.floor(r.y / DY)}`;
  let c = cells.get(k);
  if (!c) cells.set(k, (c = { kx: Math.floor(r.x / DX), ky: Math.floor(r.y / DY), n: 0, sev: { 1: 0, 2: 0, 3: 0, 4: 0 }, types: {} }));
  c.n++;
  if (c.sev[r.h] != null) c.sev[r.h]++;
  c.types[r.c] = (c.types[r.c] || 0) + 1;
}
const totals = {};
for (const r of rows) totals[r.c] = (totals[r.c] || 0) + 1;
const topTypes = Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([code, n]) => ({ code, name: CRIME[code] || `код ${code}`, n }));
const out = {
  schema: 'svoydom3d/crime@1',
  source: 'Комитет по правовой статистике и специальным учётам Генеральной прокуратуры РК — «Карта преступности»',
  sourceUrl: 'https://qamqor.gov.kz/ru/gis',
  service: SVC,
  period: { from: iso(from), to: iso(maxd) },
  fetchedAt: iso(new Date()),
  total: rows.length,
  cellM: 100,
  severity: HARD,
  topTypes,
  cells: [...cells.values()].map((c) => ({
    c: [+((c.kx + 0.5) * DX).toFixed(5), +((c.ky + 0.5) * DY).toFixed(5)],
    n: c.n,
    s: [c.sev[1], c.sev[2], c.sev[3], c.sev[4]],
    top: Object.entries(c.types).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([code, n]) => [CRIME[code] || `код ${code}`, n]),
  })),
};
fs.writeFileSync(path.join(ROOT, 'public/data/crime.json'), JSON.stringify(out));
fs.writeFileSync(path.join(ROOT, 'data/crime-summary.json'), JSON.stringify({ ...out, cells: undefined, cellCount: out.cells.length }, null, 1));
console.log(`crime: ${out.cells.length} cells written; top: ${topTypes.slice(0, 3).map((t) => `${t.name} ${t.n}`).join(', ')}`);
