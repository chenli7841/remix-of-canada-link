// Read-only verification; leaves the original inventory backup untouched.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
process.loadEnvFile('.env');
assert.equal(new URL(process.env.SUPABASE_URL).hostname, 'fhfsrrbzubgjrjhgwerv.supabase.co');
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const plan = JSON.parse(fs.readFileSync('.hs-names.local/reviewed-plan.json', 'utf8'));
const rows = [];
for (let start = 0;; start += 1000) {
  const { data, error } = await db.from('hs_codes').select('*').order('id').range(start, start + 999);
  if (error) throw Error(error.message);
  rows.push(...data);
  if (data.length < 1000) break;
}
for (const p of plan) {
  const current = rows.find(r => r.id === p.id);
  assert.ok(current, p.code);
  for (const [key, value] of Object.entries(p.after)) assert.deepEqual(current[key], value, `${p.code}/${key}`);
  assert.equal(current.hs_code, p.before.hs_code, p.code);
  for (const key of Object.keys(p.before).filter(k => /rate|duty|tax/i.test(k))) assert.deepEqual(current[key], p.before[key], `${p.code}/${key}`);
}
const missing = rows.filter(r => !/[\u3400-\u9fff]/.test(r.name_zh ?? ''));
const result = { total: rows.length, withChinese: rows.length - missing.length, missingChinese: missing.length,
  reviewedVerified: plan.length, chapter02MissingChinese: missing.filter(r => r.hs_code.startsWith('02')).length,
  missingByChapter: Object.fromEntries([...new Set(missing.map(r => r.hs_code.slice(0, 2)))].sort().map(ch => [ch, missing.filter(r => r.hs_code.startsWith(ch)).length])),
  verifiedAt: new Date().toISOString() };
fs.writeFileSync('.hs-names.local/verification.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
