// Recon helper: inspect cached HTML pages in data/raw/recon (no network).
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2];
for (const f of process.argv.slice(3)) {
  const h = fs.readFileSync(path.join(dir, f), 'utf8');
  console.log(`\n== ${f} (${h.length} bytes)`);
  console.log('globals:', [...new Set(h.match(/window\.[A-Za-z_]+\s*=/g) || [])].join(' '));
  const urls = [...new Set(h.match(/["'][^"'\s]*(ajax|api|\.json|chess|shahmat|flats?|kvartir)[^"'\s]*["']/gi) || [])];
  console.log('endpoint-like strings:\n  ' + urls.slice(0, 30).join('\n  '));
  console.log('3d links:', [...new Set(h.match(/https?:\/\/3d\.svoydom\.kz[^"'\s<]*/g) || [])].slice(0, 5));
  console.log('coords-like:', [...new Set(h.match(/(5[01]\.\d{4,})[,\s]+(7[0-2]\.\d{4,})|(7[0-2]\.\d{4,})[,\s]+(5[01]\.\d{4,})/g) || [])].slice(0, 5));
  for (const kw of ['data-flat', 'data-apt', 'data-floor', 'data-section', 'v-app', 'id="app']) {
    const i = h.indexOf(kw);
    if (i >= 0) console.log(`ctx[${kw}]:`, h.slice(i - 100, i + 300).replace(/\s+/g, ' '));
  }
}
