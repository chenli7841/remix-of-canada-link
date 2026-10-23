import fs from 'node:fs';
import ts from 'typescript';
import assert from 'node:assert/strict';
const compile = (file, require = () => { throw Error('Unexpected import'); }) => {
  const exp = {};
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
  new Function('exports', 'require', js)(exp, require);
  return exp;
};
const saved = compile('src/lib/saved-volumetric-weight.ts');
const fixtures = {
  waybills: [{id:'w', weight_snapshot:{volumetric_weight:12.345}}, {id:'missing', weight_snapshot:null}],
  cartons: [{id:'c', route_id:'r', self_volume_m3:0.12}], pallets: [],
  freight_rules: [{route_id:'r', volumetric_divisor:6000, is_active:true, created_at:'2025'}, {route_id:'r', volumetric_divisor:5000, is_active:true, created_at:'2026'}, {route_id:'r', volumetric_divisor:1000, is_active:false, created_at:'2027'}],
};
const {containerVolumetricWeight: calc, loadUnitVolumetricWeights: load} = compile('src/lib/loading-volumetric.server.ts', name => name.includes('saved-volumetric') ? saved : {readBatchRowsByIds: async (_, table) => fixtures[table]});
assert.equal(calc({length_cm:60,width_cm:40,height_cm:30},6000),12);
assert.equal(calc({self_volume_m3:0.12},5000),24);
assert.equal(calc({length_cm:60,width_cm:null,height_cm:30},6000),null);
assert.equal(calc({self_volume_m3:0.12},undefined),null);
assert.equal(calc({self_volume_m3:0.12},0),null);
const result = await load({},[{id:'q1',kind:'waybill',ref_id:'w'},{id:'q2',kind:'carton',ref_id:'c'},{id:'q3',kind:'waybill',ref_id:'missing'}]);
assert.equal(result.get('q1'),12.345);
assert.equal(result.get('q2'),24);
assert.equal(result.get('q3'),null);
console.log('PASS: saved waybill weight, latest active carton rule, dimensions and missing measurements');
