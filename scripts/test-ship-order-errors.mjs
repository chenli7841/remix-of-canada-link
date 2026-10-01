import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import ts from 'typescript';
import assert from 'node:assert/strict';
import { test } from 'node:test';

function load(name, deps) {
  const exports = {};
  const js = ts.transpileModule(readFileSync(`src/lib/ship-api/${name}.ts`, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(js, { exports, require: (id) => {
    if (!(id in deps)) throw new Error(`Unexpected import ${id}`);
    return deps[id];
  }, Response, Headers, console, process });
  return exports;
}
const auth = load('auth.server', { 'node:crypto': crypto });
const { throwShipCreateError } = load('order-errors.server', { './auth.server': auth });
for (const error of [
  { code: 'PT409', message: 'DOMESTIC_NUMBER_CONFLICT' },
  { code: '23505', constraint: 'domestic_tracking_global_unique', message: 'private detail' },
  { code: '23505', message: '国内单号已被其他订单使用，请核对后重试' },
  { code: '23505', message: 'duplicate key value violates unique constraint "uq_fo_user_domestic_tracking"' },
]) {
  test(`domestic conflict returns non-retryable 409: ${error.constraint || error.message}`, async () => {
    let caught;
    try { throwShipCreateError(error); } catch (e) { caught = e; }
    const response = auth.shipApiError(caught, 'test');
    const body = await response.json();
    assert.equal(response.status, 409);
    assert.equal(body.error.code, 'DOMESTIC_NUMBER_CONFLICT');
    assert.equal(body.error.retryable, false);
    assert.equal(body.error.fields[0].path, 'domesticNumber');
    assert.ok(!JSON.stringify(body).includes('private detail'));
  });
}
test('unrelated unique/database errors are not misreported as domestic conflicts', () => {
  for (const error of [{code:'23505',message:'duplicate key on request_no'}, {code:'08006',message:'connection failed'}]) {
    assert.throws(() => throwShipCreateError(error), (e) => e === error);
  }
});
test('existing route and validation error mappings remain intact', () => {
  for (const [code, expected] of [['PT404','ROUTE_NOT_FOUND'],['PT422','VALIDATION_FAILED']]) {
    assert.throws(() => throwShipCreateError({code,message:'test'}), e => e.code === expected);
  }
});
