import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orderVolumetricWeight, savedVolumetricWeight } from '../src/lib/saved-volumetric-weight.ts';

test('order snapshot wins when waybill snapshot is absent or differs', () => {
  assert.equal(orderVolumetricWeight({volumetric_weight: 2.096}, [null]), 2.096);
  assert.equal(orderVolumetricWeight({volumetric_weight: 2.096}, [{volumetric_weight: 1.75}]), 2.096);
});
test('sum only complete saved waybill values and preserve zero', () => {
  assert.equal(orderVolumetricWeight(null, [{volumetric_weight: '1.25'}, {volumetric_weight: 0}]), 1.25);
  assert.equal(orderVolumetricWeight({volumetric_weight: 0}, [{volumetric_weight: 3}]), 0);
  assert.equal(orderVolumetricWeight(null, [{volumetric_weight: 1}, null]), null);
  assert.equal(orderVolumetricWeight(null, []), null);
});
test('invalid saved measurements remain unknown', () => {
  for (const value of [null, undefined, '', ' ', -1, Infinity, 'bad', false]) {
    assert.equal(savedVolumetricWeight({volumetric_weight: value}), null);
  }
});
