// Data contract check for public/data (schema svoydom3d/detail@2).
// Errors fail the build (exit 1); warnings are reported but allowed.
// Output: data/validation-report.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'public/data');
const rd = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));

export function validate(projectsDoc, details) {
  const errors = [], warnings = [];
  const err = (code, msg) => errors.push({ code, msg });
  const warn = (code, msg) => warnings.push({ code, msg });
  const ids = new Set();
  const slugs = new Set(projectsDoc.projects.map((p) => p.slug));
  if (slugs.size !== projectsDoc.projects.length) err('PROJECT_DUP', 'duplicate project slug');

  for (const p of projectsDoc.projects) {
    const d = details[p.slug];
    if (!d) { err('DETAIL_MISSING', `${p.slug}: no detail file`); continue; }
    if (d.schema !== 'svoydom3d/detail@2') err('SCHEMA', `${p.slug}: schema ${d.schema}`);
    if (d.slug !== p.slug) err('SLUG_MISMATCH', `${p.slug}: detail.slug=${d.slug}`);
    if (!d.updatedAt) err('NO_UPDATED_AT', `${p.slug}: detail without updatedAt`);
    const bIds = new Set(d.buildings.map((b) => b.buildingId));
    if (bIds.size !== d.buildings.length) err('BUILDING_DUP', `${p.slug}: duplicate buildingId`);
    for (const b of d.buildings) {
      if (!b.buildingId?.startsWith(`${p.slug}:`)) err('BUILDING_ID', `${p.slug}: bad buildingId ${b.buildingId}`);
      if (!(b.floors >= 1)) err('BUILDING_FLOORS', `${b.buildingId}: floors=${b.floors}`);
      if (!b.geometry?.source || !b.geometry?.accuracy) err('BUILDING_PROVENANCE', `${b.buildingId}: geometry provenance missing`);
      if (b.geometry?.accuracy === 'schematic') warn('GEOMETRY_SCHEMATIC', `${b.buildingId}: schematic outline`);
    }
    const sIds = new Set((d.sections || []).map((s) => s.sectionId));
    const maxFloor = Math.max(p.floorsMax || 0, ...d.buildings.map((b) => b.floors));
    const numbers = new Map();
    for (const a of d.apartments) {
      if (ids.has(a.apartmentId)) err('APT_DUP', `duplicate apartmentId ${a.apartmentId}`);
      ids.add(a.apartmentId);
      if (a.projectSlug !== p.slug) err('APT_PROJECT_REF', `${a.apartmentId}: projectSlug=${a.projectSlug}`);
      if (a.buildingId != null && !bIds.has(a.buildingId)) err('APT_BUILDING_REF', `${a.apartmentId}: unknown buildingId ${a.buildingId}`);
      if (a.sectionId != null && !sIds.has(a.sectionId)) err('APT_SECTION_REF', `${a.apartmentId}: unknown sectionId ${a.sectionId}`);
      if (a.sectionId != null && a.buildingId == null) err('APT_SECTION_NO_BUILDING', `${a.apartmentId}: section without building`);
      if (!(Number.isInteger(a.floor) && a.floor >= 1 && a.floor <= maxFloor)) err('APT_FLOOR', `${a.apartmentId}: floor ${a.floor} outside 1..${maxFloor}`);
      if (!(a.price > 0)) err('APT_PRICE', `${a.apartmentId}: price ${a.price}`);
      if (!(a.area > 0)) err('APT_AREA', `${a.apartmentId}: area ${a.area}`);
      if (a.price > 0 && a.area > 0 && a.priceM2 > 0 && Math.abs(a.price / a.area - a.priceM2) / a.priceM2 > 0.015) err('APT_PRICE_M2', `${a.apartmentId}: price/area deviates from priceM2 by >1.5%`);
      if (!a.provenance?.provider || !a.provenance?.fetchedAt || !a.updatedAt) err('APT_PROVENANCE', `${a.apartmentId}: provenance/updatedAt missing`);
      if (!['свободна', 'бронь', 'продана', 'недоступна'].includes(a.status)) err('APT_STATUS', `${a.apartmentId}: status ${a.status}`);
      if (a.topology === 'floor-only' && (a.buildingId || a.sectionId)) err('APT_TOPOLOGY', `${a.apartmentId}: topology floor-only but has building/section`);
      // number must be unique within a section; without sections, duplicates within a project are a quality warning
      const key = `${a.sectionId ?? '-'}|${a.number}`;
      if (numbers.has(key)) (a.sectionId ? err : warn)('APT_NUMBER_DUP', `${p.slug}: №${a.number} twice (${numbers.get(key)}, ${a.apartmentId})`);
      else numbers.set(key, a.apartmentId);
    }
    const c = d.catalog;
    if (!c) err('CATALOG_MISSING', `${p.slug}: catalog missing`);
    else {
      if (c.loaded !== d.apartments.length) err('CATALOG_COUNT', `${p.slug}: catalog.loaded ${c.loaded} ≠ ${d.apartments.length}`);
      if (c.total != null && c.loaded > c.total) err('CATALOG_OVERFLOW', `${p.slug}: loaded ${c.loaded} > total ${c.total}`);
      if (c.complete !== (c.total != null && c.loaded >= c.total)) err('CATALOG_COMPLETE_FLAG', `${p.slug}: complete flag inconsistent`);
      if (c.total != null && !c.complete) warn('CATALOG_INCOMPLETE', `${p.slug}: ${c.loaded}/${c.total} apartments`);
    }
  }
  return { errors, warnings, apartments: ids.size };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const projectsDoc = rd('projects.json');
  const details = Object.fromEntries(projectsDoc.projects.map((p) => [p.slug, fs.existsSync(path.join(DATA, 'apts', `${p.slug}.json`)) ? rd(`apts/${p.slug}.json`) : null]));
  const r = validate(projectsDoc, details);
  const byCode = (list) => list.reduce((m, x) => ((m[x.code] = (m[x.code] || 0) + 1), m), {});
  fs.writeFileSync(path.join(ROOT, 'data/validation-report.json'), JSON.stringify({ checkedAt: new Date().toISOString(), apartments: r.apartments, errorCount: r.errors.length, warningCount: r.warnings.length, errorsByCode: byCode(r.errors), warningsByCode: byCode(r.warnings), errors: r.errors, warnings: r.warnings }, null, 1));
  console.log(`validate-data: ${r.apartments} apartments, ${r.errors.length} errors, ${r.warnings.length} warnings`, byCode(r.warnings));
  for (const e of r.errors.slice(0, 20)) console.error('  ERROR', e.code, e.msg);
  if (r.errors.length) process.exit(1);
}
