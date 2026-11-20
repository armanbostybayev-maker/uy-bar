// Stage 1: collect SVOYDOM Astana projects + apartments from pages allowed by robots.txt.
// Output: data/projects.json, data/apartments.json, data/scrape-report.md
import fs from 'node:fs';
import path from 'node:path';
import { getText, RobotsDenied, ROOT, UA } from './http.mjs';

const BASE = 'https://svoydom.kz';
const abs = (u) => (u ? new URL(u, BASE).href : null);
const pathOf = (u) => new URL(u, BASE).pathname.replace(/\/+$/, '/').toLowerCase();
const slugOf = (u) => pathOf(u).split('/').filter(Boolean).pop();
const decode = (s) => s.replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

function balancedJson(h, start) {
  let d = 0, inStr = false, esc = false;
  for (let i = start; i < h.length; i++) {
    const c = h[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{' || c === '[') d++;
    else if (c === '}' || c === ']') { if (--d === 0) return JSON.parse(h.slice(start, i + 1)); }
  }
  throw new Error('unbalanced JSON');
}
const scriptJson = (h, id) => {
  const i = h.indexOf(`id="${id}"`);
  if (i < 0) return null;
  const s = h.indexOf('>', i) + 1;
  return JSON.parse(h.slice(s, h.indexOf('</script>', s)));
};
const windowJson = (h, name) => {
  const i = h.indexOf(`window.${name} = `);
  return i < 0 ? null : balancedJson(h, h.indexOf('{', i));
};
const attrJson = (h, tag, attr) => {
  const t = h.indexOf(`<${tag}`);
  if (t < 0) return null;
  const end = h.indexOf('>', h.indexOf(`</${tag}`, t) - 1);
  const block = h.slice(t, end > 0 ? end : t + 2_000_000);
  const m = block.match(new RegExp(`:${attr}='([^']*)'`)) || block.match(new RegExp(`:${attr}="([^"]*)"`));
  return m ? JSON.parse(decode(m[1])) : null;
};
const meta = (h, prop) => {
  const m = h.match(new RegExp(`<meta[^>]+(?:property|name)="${prop}"[^>]+content="([^"]*)"`, 'i'));
  return m ? decode(m[1]).trim() : null;
};

const CLASS = { comfort: 'Комфорт', comfort_plus: 'Комфорт+', business: 'Бизнес', komfort: 'Комфорт', 'komfort-plyus': 'Комфорт+', biznes: 'Бизнес' };
const STATUS = { completed: 'сдан', building: 'строится' };

const report = { denied: [], errors: [] };
async function safeGet(url) {
  try { return await getText(url); }
  catch (e) {
    (e instanceof RobotsDenied ? report.denied : report.errors).push(`${url} — ${e.message}`);
    console.warn('  ! ' + e.message);
    return null;
  }
}

console.log(`User-Agent: ${UA}`);
// 1. Project list pages
const list = await safeGet(`${BASE}/projects/astana/`);
const pdata = scriptJson(list, 'projects-data');
for (const c of ['komfort/', 'komfort-plyus/', 'biznes/', 'sdannye/']) await safeGet(`${BASE}/projects/astana/${c}`);

// 2. Apartments catalogue (zhkList with iblock ids, deadlines, per-ZhK filter ranges)
const apHtml = await safeGet(`${BASE}/apartments/astana/`);
const apts = windowJson(apHtml, '__APTS_DATA__');
const zhkByPath = new Map();
for (const z of apts.zhkList) if (!/коммерц/i.test(z.name)) zhkByPath.set(pathOf(z.url), z);

const raw = pdata.projects.filter((p) => p.city === 'Астана' && p.projectClass !== 'commercial');
console.log(`Projects in Astana: ${raw.length}`);

const projects = [];
const apartments = new Map();
for (const p of raw) {
  const url = abs(p.url);
  const html = await safeGet(url);
  const finalPath = pathOf(url);
  const zhk = zhkByPath.get(finalPath);
  const pr = {
    slug: slugOf(url),
    sourceId: p.id,
    iblockId: zhk?.iblockId ?? null,
    name: p.name.replace(/^ЖК\s+/i, ''),
    city: 'Астана',
    class: CLASS[p.projectClass] || CLASS[zhk?.classSlug] || null,
    status: STATUS[p.status] || p.status,
    deadline: zhk?.deadline || (p.completionYear ? String(p.completionYear) : null),
    deadlineYear: p.completionYear || zhk?.year || null,
    address: p.previewText || null,
    district: p.district || zhk?.districtName || null,
    url,
    images: [],
    description: (p.detailText || '').trim() || null,
    priceFrom: p.priceMin || null,
    priceFromM2: p.pricePerM2 || null,
    rooms: p.rooms || [],
    coords: p.lat && p.lng ? [p.lng, p.lat] : null,
    coordsSource: p.lat ? 'svoydom.kz projects-data' : null,
    footprint: null,
    floorsMax: null,
    apartmentsTotal: null,
    apartmentsLoaded: 0,
    tour3d: null,
    filterRanges: null,
  };
  if (p.image) pr.images.push(abs(p.image));
  if (html) {
    const og = meta(html, 'og:image');
    if (og) pr.images.push(abs(og));
    // gallery images: everything under /upload/ except plan pictures of apartments and icons
    const planPics = new Set();
    for (const m of html.matchAll(/\\?"picture(?:Full)?\\?":\\?"([^"\\]+(?:\\\/[^"\\]+)*)/g)) planPics.add(abs(m[1].replace(/\\\//g, '/')));
    for (const m of html.matchAll(/["'(](\/upload\/[^"')\s]+\.(?:webp|jpe?g|png))/gi)) {
      const u = abs(m[1]);
      if (!planPics.has(u) && !/logo|icon|favicon|svg/i.test(u)) pr.images.push(u);
    }
    pr.images = [...new Set(pr.images)].slice(0, 10);
    pr.description = pr.description && pr.description.length > 40 ? pr.description : meta(html, 'description') || pr.description;
    const tour = html.match(/https?:\/\/3d\.svoydom\.kz\/\?[^"'\s<]+/);
    if (tour) pr.tour3d = decode(decode(tour[0]));
    const items = attrJson(html, 'apartments-filter', 'initial-apartments') || attrJson(html, 'apartments-filter', 'items');
    const ranges = attrJson(html, 'apartments-filter', 'filter-data');
    const ib = html.match(/:iblock-id="(\d+)"/);
    if (ib && !pr.iblockId) pr.iblockId = Number(ib[1]);
    if (ranges) pr.filterRanges = ranges;
    if (items?.items) {
      pr.apartmentsTotal = items.pagination?.totalCount ?? items.items.length;
      for (const a of items.items) apartments.set(a.id, { ...a, _project: pr.slug });
    }
  }
  if (!pr.filterRanges && pr.iblockId) pr.filterRanges = apts.filterData.byZhk[pr.iblockId]?.flat || null;
  pr.floorsMax = pr.filterRanges?.floor?.max || null;
  projects.push(pr);
}
for (const a of apts.apartments.items) {
  const pr = projects.find((p) => p.iblockId === a.iblockId);
  if (pr && !apartments.has(a.id)) apartments.set(a.id, { ...a, _project: pr.slug });
}

const outApts = [...apartments.values()].map((a) => ({
  id: a.id,
  xmlId: a.xmlId || null,
  projectSlug: a._project,
  building: null,
  section: null,
  floor: a.floor ?? null,
  number: (a.name || '').replace(/^№\s*/, '') || null,
  rooms: a.rooms ?? null,
  type: a.type || null,
  area: a.area ?? null,
  price: a.price ?? null,
  priceM2: a.priceSqm ?? (a.price && a.area ? Math.round(a.price / a.area) : null),
  status: a.status === '0' ? 'свободна' : a.status ?? null,
  planImageUrl: abs(a.pictureFull || a.picture),
  url: projects.find((p) => p.slug === a._project)?.url || null,
}));
for (const p of projects) p.apartmentsLoaded = outApts.filter((a) => a.projectSlug === p.slug).length;

fs.writeFileSync(path.join(ROOT, 'data/projects.json'), JSON.stringify({ fetchedAt: new Date().toISOString().slice(0, 10), source: BASE, projects }, null, 1));
fs.writeFileSync(path.join(ROOT, 'data/apartments.json'), JSON.stringify({ fetchedAt: new Date().toISOString().slice(0, 10), apartments: outApts }, null, 1));

// Report
const fields = ['class', 'deadline', 'address', 'district', 'description', 'priceFromM2', 'coords', 'footprint', 'floorsMax', 'tour3d'];
const aFields = ['building', 'section', 'floor', 'number', 'rooms', 'area', 'price', 'priceM2', 'status', 'planImageUrl'];
const pct = (arr, f) => `${arr.filter((x) => x[f] != null && x[f] !== '' && !(Array.isArray(x[f]) && !x[f].length)).length}/${arr.length}`;
const active = projects.filter((p) => p.status === 'строится');
const totalCatalogue = apts.apartments.pagination.totalCount;
const md = `# Отчёт сборщика — ${new Date().toISOString().slice(0, 10)}

- ЖК в Астане: **${projects.length}** (строится: ${active.length}, сдан: ${projects.length - active.length})
- Квартир в каталоге на сайте: **${totalCatalogue}**; собрано из открытых страниц: **${outApts.length}**
  (полные списки отдаёт только ajax с \`action=\`, закрытый robots.txt — ждём выгрузку от SVOYDOM)

## Заполненность полей ЖК
${fields.map((f) => `- ${f}: ${pct(projects, f)}`).join('\n')}

## Заполненность полей квартир
${aFields.map((f) => `- ${f}: ${pct(outApts, f)}`).join('\n')}

## По ЖК (строится)
| ЖК | класс | срок | квартир на сайте | собрано | этажей (макс.) |
|---|---|---|---|---|---|
${active.map((p) => `| ${p.name} | ${p.class ?? '—'} | ${p.deadline ?? '—'} | ${p.apartmentsTotal ?? '—'} | ${p.apartmentsLoaded} | ${p.floorsMax ?? '—'} |`).join('\n')}

## Закрыто robots.txt (не запрашивалось)
${report.denied.map((d) => `- ${d}`).join('\n') || '- —'}

## Ошибки
${report.errors.map((d) => `- ${d}`).join('\n') || '- —'}
`;
fs.writeFileSync(path.join(ROOT, 'data/scrape-report.md'), md);
console.log(md);
