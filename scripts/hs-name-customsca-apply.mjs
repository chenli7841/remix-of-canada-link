// Reviewed Chinese names only; preserve English names, codes, rates and business records.
// Run without --apply to inspect the plan; --apply uses optimistic concurrency and read-back checks.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
process.loadEnvFile('.env');
const root = '.hs-names.local';
const batch = process.argv.find(a => a.startsWith('--batch='))?.slice(8) || 'reviewed';
assert.match(batch, /^[a-z0-9-]+$/);
const listPath = process.argv.find(a => a.startsWith('--list='))?.slice(7) || 'scripts/hs-names-customsca-reviewed.txt';
const sourceUrl = 'https://customscalculator.com/CUSTOMSCAWEB/CUSTOMSCAWeb.aspx';
const inventory = JSON.parse(fs.readFileSync(`${root}/inventory.json`, 'utf8'));
const official = JSON.parse(fs.readFileSync(`${root}/sources.json`, 'utf8'));
const reviewed = fs.readFileSync(listPath, 'utf8').trim().split(/\r?\n/).map(line => {
  const [code, name, ...rest] = line.split('|');
  assert.equal(rest.length, 0);
  assert.match(code, /^\d{4}\.\d{2}\.\d{2}\.\d{2}$/);
  assert.match(name, /[\u3400-\u9fff]/);
  return { code, name };
});
assert.equal(new Set(reviewed.map(r => r.code)).size, reviewed.length);
const plan = reviewed.map(r => {
  const before = inventory.find(x => x.hs_code === r.code);
  assert.ok(before && official[r.code], `Missing inventory or official context: ${r.code}`);
  assert.ok(!/[\u3400-\u9fff]/.test(before.name_zh ?? ''), `Already has Chinese: ${r.code}`);
  const reference = fs.readFileSync(`${root}/customsca-${r.code.slice(0, 2)}-zh.txt`, 'utf8');
  assert.ok(reference.includes(`${r.code} - `), `Missing website evidence: ${r.code}`);
  return { code: r.code, before, name_zh: r.name, sourceUrl, official: official[r.code] };
});
fs.writeFileSync(`${root}/customsca-${batch}-plan.json`, JSON.stringify(plan, null, 2));
console.log(JSON.stringify({ reviewed: plan.length, chapters: [...new Set(plan.map(p => p.code.slice(0, 2)))], fieldsChanged: ['name_zh'] }));
if (!process.argv.includes('--apply')) process.exit(0);
assert.equal(new URL(process.env.SUPABASE_URL).hostname, 'fhfsrrbzubgjrjhgwerv.supabase.co');
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
let changed = 0, alreadyApplied = 0;
for (const p of plan) {
  const current = await db.from('hs_codes').select('*').eq('id', p.before.id).single();
  if (current.error) throw Error(current.error.message);
  if (current.data.name_zh === p.name_zh) { alreadyApplied++; continue; }
  for (const field of ['hs_code', 'name_zh', 'name_en']) assert.deepEqual(current.data[field], p.before[field], `Concurrent change ${p.code}/${field}`);
  fs.appendFileSync(`${root}/customsca-${batch}-journal.jsonl`, JSON.stringify({ event: 'before', before: current.data, name_zh: p.name_zh, at: new Date().toISOString() }) + '\n');
  let update = db.from('hs_codes').update({ name_zh: p.name_zh }).eq('id', p.before.id).eq('hs_code', p.code);
  for (const field of ['name_zh', 'name_en']) update = p.before[field] == null ? update.is(field, null) : update.eq(field, p.before[field]);
  const saved = await update.select('*').single();
  if (saved.error) throw Error(`${p.code}: ${saved.error.message}`);
  assert.equal(saved.data.name_zh, p.name_zh);
  for (const field of Object.keys(current.data)) if (!['name_zh', 'updated_at'].includes(field)) assert.deepEqual(saved.data[field], current.data[field], `${p.code}: unexpected ${field}`);
  const log = await db.from('admin_action_logs').insert({ entity_type: 'hs_code', entity_id: p.before.id, action: 'update_bilingual_names', operator_id: null, operator_name: 'Codex（用户授权补充中文）', before: { name_zh: p.before.name_zh }, after: { name_zh: p.name_zh }, note: `参考 CustomsCA 中文，按原英文及完整编码核对补充；已纠正机翻歧义。未改英文、编码、税率。来源：${sourceUrl}；英文分类：${p.official.url}` });
  if (log.error) throw Error(`Updated ${p.code}; audit log failed: ${log.error.message}`);
  fs.appendFileSync(`${root}/customsca-${batch}-journal.jsonl`, JSON.stringify({ event: 'verified', code: p.code, at: new Date().toISOString() }) + '\n');
  changed++;
}
console.log(JSON.stringify({ changed, alreadyApplied, verified: changed + alreadyApplied }));
