import fs from 'node:fs';
const root = '.hs-names.local';
const rows = JSON.parse(fs.readFileSync(`${root}/inventory.json`, 'utf8'));
const chapters = [...new Set(rows.map(r => r.hs_code.slice(0, 2)))];
const decode = s => s.replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&')
  .replace(/&quot;/g, '"').replace(/&#(?:39|x27);|&apos;/g, "'").replace(/&ndash;/g, '–').replace(/&mdash;/g, '—')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/\s+/g, ' ').trim();
const source = {};
for (const chapter of chapters) {
  const path = `${root}/ch${chapter}.html`;
  const url = `https://www.cbsa-asfc.gc.ca/trade-commerce/tariff-tarif/2025/html/00/ch${chapter}-eng.html`;
  if (!fs.existsSync(path)) {
    const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw Error(`${chapter}: HTTP ${r.status}`);
    fs.writeFileSync(path, await r.text());
  }
  const html = fs.readFileSync(path, 'utf8');
  let count = 0;
  for (const match of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...match[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(m => decode(m[1]));
    if (!/^\d{4}\.\d{2}\.\d{2}$/.test(cells[0]) || !/^\d{2}$/.test(cells[1])) continue;
    const code = `${cells[0]}.${cells[1]}`;
    if (source[code] && source[code].description !== cells[2]) throw Error(`Conflicting source ${code}`);
    source[code] = { description: cells[2], url };
    count++;
  }
  if (!count) throw Error(`No entries for chapter ${chapter}`);
  fs.writeFileSync(`${root}/sources.json`, JSON.stringify(source, null, 2));
  console.log(`${chapter}: ${count}`);
}
console.log(JSON.stringify({ matched: rows.filter(r => source[r.hs_code]).length,
  missing: rows.filter(r => !source[r.hs_code]).map(r => ({ code: r.hs_code, zh: r.name_zh, en: r.name_en })) }));
