// Read-only inventory and local backup. Never prints credentials.
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';
const root = '.hs-names.local';
fs.mkdirSync(root, { recursive: true });
const env = Object.fromEntries(fs.readFileSync('.env', 'utf8').split(/\r?\n/).filter(x => /^\w+=/.test(x)).map(x => {
  const i = x.indexOf('='); return [x.slice(0, i), x.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')];
}));
if (new URL(env.SUPABASE_URL).hostname !== 'fhfsrrbzubgjrjhgwerv.supabase.co') throw Error('Unexpected project');
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const rows = [];
for (let from = 0; ; from += 1000) {
  const r = await db.from('hs_codes').select('*').order('hs_code').range(from, from + 999);
  if (r.error) throw Error(r.error.message);
  rows.push(...r.data);
  if (r.data.length < 1000) break;
}
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
fs.writeFileSync(`${root}/backup-${stamp}.json`, JSON.stringify(rows, null, 2));
fs.writeFileSync(`${root}/inventory.json`, JSON.stringify(rows, null, 2));
console.log(JSON.stringify({ total: rows.length, withChinese: rows.filter(r => /[\u3400-\u9fff]/.test(r.name_zh ?? '')).length,
  chapters: [...new Set(rows.map(r => r.hs_code.slice(0, 2)))], englishMissing: rows.filter(r => !r.name_en?.trim()).length }));
const response = await fetch('https://www.cbsa-asfc.gc.ca/trade-commerce/tariff-tarif/2025/html/00/ch01-eng.html');
if (!response.ok) throw Error(`CBSA ${response.status}`);
fs.writeFileSync(`${root}/ch01.html`, await response.text());
console.log('Saved official chapter 01 for hierarchy inspection.');
