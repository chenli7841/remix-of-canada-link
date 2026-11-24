import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const source = fs.readFileSync('src/lib/admin-customer-view.functions.ts', 'utf8');
const ast = ts.createSourceFile('access.ts', source, ts.ScriptTarget.Latest, true);
const fn = ast.statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === 'assertCustomerViewAccess');
const roles = ast.statements.find(s => ts.isVariableStatement(s) && s.getText(ast).includes('const CUSTOMER_VIEW_ROLES'));
const js = ts.transpileModule(roles.getText(ast) + '\n' + fn.getText(ast).replace('export async', 'async').replace('await import("@/integrations/supabase/client.server")', '({supabaseAdmin: admin})'), {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
function access(granted, assigned) {
  const admin = {from(){const q={select(){return q},eq(){return q},async maybeSingle(){return {data:{sales_rep_id:assigned}}}};return q}};
  const check = new Function('admin', js + ';return assertCustomerViewAccess')(admin);
  const client={async rpc(_name,args){return {data:granted.includes(args._role),error:null}}};
  return () => check(client,'actor','customer');
}
test('owner can view customer freight notice',async()=>{await access(['owner'])()});
test('ordinary customer cannot use staff fallback',async()=>{await assert.rejects(access([]),/Forbidden/)});
test('sales rep can only view assigned customer',async()=>{await access(['sales_rep'],'actor')();await assert.rejects(access(['sales_rep'],'another'),/not your assigned/)});
