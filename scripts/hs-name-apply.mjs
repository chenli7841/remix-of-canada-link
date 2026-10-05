// Applies ONLY the explicitly reviewed list; raw translation drafts are never accepted.
// Default is a local plan. --apply writes the reviewed names with optimistic concurrency.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { createClient } from '@supabase/supabase-js';
process.loadEnvFile('.env');
const root = '.hs-names.local';
const reviewed = JSON.parse(fs.readFileSync('scripts/hs-names-reviewed.json', 'utf8'));
const backup = JSON.parse(fs.readFileSync(`${root}/inventory.json`, 'utf8'));
const sources = JSON.parse(fs.readFileSync(`${root}/sources.json`, 'utf8'));
assert.equal(new URL(process.env.SUPABASE_URL).hostname, 'fhfsrrbzubgjrjhgwerv.supabase.co');
assert.equal(new Set(reviewed.map(r => r.code)).size, reviewed.length);
const plan = reviewed.map(r => {
  const old = backup.find(x => x.hs_code === r.code);
  const source = r.source ?? sources[r.code];
  assert.ok(old && source, `Missing source or backup ${r.code}`);
  assert.ok(/[\u3400-\u9fff]/.test(r.zh) && /[a-z]/i.test(r.en));
  assert.ok(!/[\u3400-\u9fff]/.test(old.name_zh), `Existing Chinese needs separate review ${r.code}`);
  return { id: old.id, code: r.code, before: old, after: {
    name_zh: r.zh, name_en: r.en,
    aliases: [...new Set([...(old.aliases ?? []), old.name_zh, old.name_en].filter(Boolean))],
    note: [old.note, `[中英文名称整理：${r.reviewedAt ?? '2026-09-25'}]`, r.detail,
      `原中文栏：${old.name_zh ?? ''}`, `原英文栏：${old.name_en ?? ''}`,
      `完整分类（T2025）：${source.description}`, `来源：${source.url}`].filter(Boolean).join('\n'),
  } };
});
fs.writeFileSync(`${root}/reviewed-plan.json`, JSON.stringify(plan, null, 2));
console.log(`Reviewed plan: ${plan.length} names; codes, rates and existing business records unchanged.`);
if (!process.argv.includes('--apply')) process.exit(0);
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
// Check completed entries in small read-only batches. Entries needing writes are
// still read individually immediately before their optimistic-concurrency update.
const alreadyApplied = new Set();
for (let start = 0; start < plan.length; start += 100) {
  const batch = plan.slice(start, start + 100);
  const result = await db.from('hs_codes').select('id,name_zh,name_en,aliases,note').in('id', batch.map(p => p.id));
  if (result.error) throw Error(result.error.message);
  for (const p of batch) {
    const current = result.data.find(r => r.id === p.id);
    if (current && Object.entries(p.after).every(([key, value]) => isDeepStrictEqual(current[key], value))) alreadyApplied.add(p.id);
  }
}
let applied = 0;
for (const p of plan) {
  if (alreadyApplied.has(p.id)) continue;
  const current = await db.from('hs_codes').select('*').eq('id', p.id).single();
  if (current.error) throw Error(current.error.message);
  if (Object.entries(p.after).every(([key, value]) => isDeepStrictEqual(current.data[key], value))) continue;
  for (const field of ['hs_code', 'name_zh', 'name_en', 'aliases', 'note']) {
    assert.deepEqual(current.data[field], p.before[field], `Concurrent change ${p.code}/${field}; stopped`);
  }
  fs.appendFileSync(`${root}/apply-journal.jsonl`, JSON.stringify({ event: 'before', id: p.id, before: current.data, after: p.after }) + '\n');
  let query = db.from('hs_codes').update(p.after).eq('id', p.id);
  for (const field of ['name_zh', 'name_en', 'note']) query = p.before[field] == null ? query.is(field, null) : query.eq(field, p.before[field]);
  const arrayLiteral = `{${(p.before.aliases ?? []).map(s => `"${s.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`).join(',')}}`;
  query = p.before.aliases == null ? query.is('aliases', null) : query.eq('aliases', arrayLiteral);
  const result = await query.select('*').single();
  if (result.error) throw Error(`${p.code}: ${result.error.message}`);
  for (const [field, value] of Object.entries(current.data)) {
    if (!['name_zh', 'name_en', 'aliases', 'note', 'updated_at'].includes(field)) assert.deepEqual(result.data[field], value, `Unexpected change ${field}`);
  }
  const log = await db.from('admin_action_logs').insert({ entity_type: 'hs_code', entity_id: p.id,
    action: 'update_bilingual_names', operator_id: null, operator_name: 'Codex（用户授权整理）',
    before: { name_zh: p.before.name_zh, name_en: p.before.name_en, aliases: p.before.aliases, note: p.before.note },
    after: p.after, note: '按用户确认的商品主体＋括号说明格式更新名称；未改编码和税率。' });
  if (log.error) throw Error(`Saved ${p.code} but audit insert failed: ${log.error.message}`);
  fs.appendFileSync(`${root}/apply-journal.jsonl`, JSON.stringify({ event: 'verified', code: p.code, at: new Date().toISOString() }) + '\n');
  applied++;
}
console.log(`Applied and read-back verified: ${applied}`);
