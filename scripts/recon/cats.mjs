import { getText } from '../scrape/http.mjs';
for (const c of ['', 'komfort/', 'komfort-plyus/', 'biznes/', 'sdannye/']) {
  const h = await getText('https://svoydom.kz/projects/astana/' + c);
  const links = [...new Set((h.match(/href="(?:https:\/\/svoydom\.kz)?(\/(?:lp\/astana|comfort_projects|business_projects)\/[^"#?]+)"/g) || []).map(s => s.replace(/href="|"/g,'').replace('https://svoydom.kz','')))];
  console.log(c || '(all)', links.length, links.join(' '));
}
