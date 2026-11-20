// Building facts published in the text of svoydom.kz project pages (cached HTML, no network):
//   «Количество секций: 5», «Этажность: 9–12 этажей», «Количество подъездов: 9», «7 секций высотой 12 этажей», «9, 12 этажей».
// The site publishes no geographic outlines (no genplan geometry / SVG on the map), so shape stays schematic.
// Output: data/site-facts.json  { slug: { floorsMin, floorsMax, sections, entrances, quotes[] } }
// NB: JS `\w` does not match Cyrillic — word tails use [а-яё].
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './http.mjs';

const CACHE = path.join(ROOT, 'data/raw/http');
const pathOf = (u) => new URL(u, 'https://svoydom.kz').pathname.replace(/\/+$/, '/').toLowerCase();
const slugOf = (u) => pathOf(u).split('/').filter(Boolean).pop();
// keep <script> text: some landings put the project description into inline JSON
const text = (h) => h.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/\\n/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/\s+/g, ' ');
const W = '[а-яё]*';

const facts = {};
for (const f of fs.readdirSync(CACHE).filter((x) => x.endsWith('.json'))) {
  const m = JSON.parse(fs.readFileSync(path.join(CACHE, f), 'utf8'));
  if (!/\/(lp\/astana|comfort_projects|business_projects)\//.test(m.url)) continue;
  const t = text(fs.readFileSync(path.join(CACHE, f.replace('.json', '.body')), 'utf8'));
  const r = { floorsMin: null, floorsMax: null, sections: null, entrances: null, quotes: [] };
  const note = (src) => { const x = new RegExp(src, 'i').exec(t); if (x) r.quotes.push(x[0].trim().slice(0, 80)); return x; };
  let x;
  if ((x = note(`Этажность\\s*:?\\s*(\\d{1,2})\\s*(?:[-–—]|до)\\s*(\\d{1,2})`))) { r.floorsMin = +x[1]; r.floorsMax = +x[2]; }
  else if ((x = note(`Этажность\\s*:?\\s*(\\d{1,2})\\s*этаж`))) r.floorsMin = r.floorsMax = +x[1];
  else if ((x = note(`переменной этажности от (\\d{1,2}) до (\\d{1,2})`))) { r.floorsMin = +x[1]; r.floorsMax = +x[2]; }
  else if ((x = note(`(\\d{1,2})\\s*,\\s*(\\d{1,2})\\s*этаж`))) { r.floorsMin = +x[1]; r.floorsMax = +x[2]; }
  else if ((x = note(`секци${W} высотой (\\d{1,2}) этаж`))) r.floorsMin = r.floorsMax = +x[1];
  else if ((x = note(`секции на (\\d{1,2})(?:, (\\d{1,2}))? и (\\d{1,2}) этаж`))) { const v = [x[1], x[2], x[3]].filter(Boolean).map(Number); r.floorsMin = Math.min(...v); r.floorsMax = Math.max(...v); }
  else if ((x = note(`высот${W} (?:в|до) (\\d{1,2}) этаж`))) r.floorsMax = +x[1];
  else if ((x = note(`Всего (\\d{1,2}) этаж`))) r.floorsMin = r.floorsMax = +x[1];
  if ((x = note(`Количество\\s+секций\\s*:?\\s*(\\d{1,2})`)) || (x = note(`состо${W} из (\\d{1,2}) секц`))) r.sections = +x[1];
  if ((x = note(`Количество\\s+подъездов\\s*:?\\s*(\\d{1,2})`)) || (x = note(`(\\d{1,2}) подъезд`))) r.entrances = +x[1];
  if (r.floorsMin && r.floorsMin > r.floorsMax) [r.floorsMin, r.floorsMax] = [r.floorsMax, r.floorsMin];
  if (r.floorsMax && (r.floorsMax < 2 || r.floorsMax > 60)) r.floorsMin = r.floorsMax = null; // implausible
  if (r.floorsMax || r.sections || r.entrances) facts[slugOf(m.url)] = { ...r, source: m.url };
}
fs.writeFileSync(path.join(ROOT, 'data/site-facts.json'), JSON.stringify(facts, null, 1));
const vals = Object.values(facts);
console.log(`site-facts: ${vals.length} projects; floors ${vals.filter((f) => f.floorsMax).length}, sections ${vals.filter((f) => f.sections).length}, entrances ${vals.filter((f) => f.entrances).length}`);
for (const [k, v] of Object.entries(facts)) console.log(`  ${k.padEnd(14)} floors ${v.floorsMin ?? '?'}–${v.floorsMax ?? '?'}  sections ${v.sections ?? '—'}  entrances ${v.entrances ?? '—'}`);
