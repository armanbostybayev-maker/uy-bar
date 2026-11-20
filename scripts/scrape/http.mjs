// Polite HTTP client for svoydom.kz:
//  - obeys robots.txt (User-agent: * section, longest-match Allow/Disallow, * and $ wildcards)
//  - at most 1 request per 2 s
//  - caches every response in data/raw/http/ and never re-downloads it (unless REFRESH=1)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CACHE = path.join(ROOT, 'data/raw/http');
fs.mkdirSync(CACHE, { recursive: true });

const CONTACT = process.env.SCRAPE_CONTACT ? ` (+${process.env.SCRAPE_CONTACT})` : '';
export const UA = `UyBar-concept/0.1${CONTACT}`;
const MIN_INTERVAL = Number(process.env.SCRAPE_INTERVAL_MS || 2000);
const REFRESH = process.env.REFRESH === '1';

let last = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function throttle(interval = MIN_INTERVAL) {
  const wait = last + interval - Date.now();
  if (wait > 0) await sleep(wait);
  last = Date.now();
}

const robotsCache = new Map();
function parseRobots(txt) {
  const rules = [];
  let inStar = false;
  let sawRule = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) continue;
    const [k, ...rest] = line.split(':');
    const key = k.trim().toLowerCase();
    const val = rest.join(':').trim();
    if (key === 'user-agent') {
      if (sawRule) { inStar = false; sawRule = false; }
      if (val === '*') inStar = true;
    } else if (key === 'allow' || key === 'disallow') {
      sawRule = true;
      if (inStar && val) rules.push({ allow: key === 'allow', pattern: val });
    }
  }
  return rules;
}
function toRegex(p) {
  const anchored = p.endsWith('$');
  const body = (anchored ? p.slice(0, -1) : p).split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp('^' + body + (anchored ? '$' : ''));
}
async function robotsAllows(url) {
  const u = new URL(url);
  if (!robotsCache.has(u.origin)) {
    const txt = await getText(`${u.origin}/robots.txt`, { skipRobots: true });
    robotsCache.set(u.origin, parseRobots(txt));
  }
  const target = u.pathname + u.search;
  let best = null;
  for (const r of robotsCache.get(u.origin)) {
    if (toRegex(r.pattern).test(target) && (!best || r.pattern.length > best.pattern.length || (r.pattern.length === best.pattern.length && r.allow))) best = r;
  }
  return !best || best.allow;
}

export class RobotsDenied extends Error {}

export async function getText(url, { skipRobots = false, interval, headers = {} } = {}) {
  const key = crypto.createHash('sha1').update(url).digest('hex').slice(0, 16);
  const file = path.join(CACHE, key + '.body');
  const meta = path.join(CACHE, key + '.json');
  if (!REFRESH && fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
  if (!skipRobots && !(await robotsAllows(url))) throw new RobotsDenied(`robots.txt disallows ${url}`);
  await throttle(interval);
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'ru', ...headers }, redirect: 'follow' });
  const body = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  fs.writeFileSync(file, body);
  fs.writeFileSync(meta, JSON.stringify({ url, finalUrl: res.url, status: res.status, fetchedAt: new Date().toISOString() }, null, 1));
  console.log(`  GET ${res.status} ${url}`);
  return body;
}

export async function getJson(url, opts) {
  return JSON.parse(await getText(url, opts));
}

export { ROOT };
