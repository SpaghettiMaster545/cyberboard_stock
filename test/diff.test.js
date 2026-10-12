import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffItems, summarizeItems } from '../src/diff.js';

const item = (over = {}) => ({ title: 'A', variant: null, group: 'a', available: false, price: 10, ...over });

test('detects restock, sell-out, price change, new and removed items', () => {
  const before = {
    1: item({ available: false }),
    2: item({ available: true }),
    3: item({ price: 10 }),
    4: item()
  };
  const after = {
    1: item({ available: true }),
    2: item({ available: false }),
    3: item({ price: 12.5 }),
    5: item({ title: 'B' })
  };
  const changes = diffItems(before, after).map((c) => [c.type, c.id]);
  assert.deepEqual(changes.sort(), [
    ['new', '5'],
    ['price', '3'],
    ['removed', '4'],
    ['restock', '1'],
    ['soldout', '2']
  ]);
  assert.equal(diffItems(before, after).find((c) => c.type === 'price').oldPrice, 10);
});

test('no changes for identical maps and ignores unknown prices', () => {
  const a = { 1: item({ price: null }) };
  assert.deepEqual(diffItems(a, { 1: item({ price: 99 }) }), []);
  assert.deepEqual(diffItems(a, a), []);
});

test('summarizeItems counts groups (products) and items (variants)', () => {
  const s = summarizeItems({
    1: item({ group: 'x', available: true }),
    2: item({ group: 'x', available: false }),
    3: item({ group: 'y', available: false })
  });
  assert.deepEqual(s, { itemCount: 3, inStockCount: 1, groupCount: 2, groupsInStock: 1 });
});
