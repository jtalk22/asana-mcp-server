import { test } from 'node:test';
import assert from 'node:assert/strict';
import { qs, wrapDates, bulkLoop } from '../lib/asana-client.js';

test('qs joins arrays, stringifies booleans, skips null/undefined', () => {
  assert.equal(qs({ a: ['x', 'y'], b: true, c: false, d: null, e: undefined, f: 'z' }), '?a=x%2Cy&b=true&c=false&f=z');
  assert.equal(qs({}), '');
});

test('wrapDates wraps bare YYYY-MM-DD strings only', () => {
  assert.deepEqual(wrapDates({ f1: '2026-09-01', f2: 'text', f3: 5, f4: ['opt'] }),
    { f1: { date: '2026-09-01' }, f2: 'text', f3: 5, f4: ['opt'] });
});

test('bulkLoop continues past failures and reports per-item results', async () => {
  const out = await bulkLoop(['a', 'b', 'c'], async (id) => { if (id === 'b') throw new Error('boom'); });
  assert.equal(out.ok, false);
  assert.equal(out.succeeded, 2);
  assert.equal(out.failed, 1);
  assert.deepEqual(out.results.map((r) => r.ok), [true, false, true]);
});
