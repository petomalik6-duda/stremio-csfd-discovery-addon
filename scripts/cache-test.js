import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCache } from '../src/cache.js';

test('expired entries are pruned without reading the expired key', () => {
  let time = 0;
  const cache = createCache({ maxEntries: 2, now: () => time });
  cache.setCached('old', 1, 10);
  time = 11;
  cache.setCached('new', 2, 20);
  assert.equal(cache.cacheStats().entries, 1);
  assert.equal(cache.getCached('old'), undefined);
});

test('cache is bounded and retains recently used entries', () => {
  const cache = createCache({ maxEntries: 2 });
  cache.setCached('a', 1, 1000);
  cache.setCached('b', 2, 1000);
  assert.equal(cache.getCached('a'), 1);
  cache.setCached('c', 3, 1000);
  assert.equal(cache.getCached('b'), undefined);
  assert.equal(cache.cacheStats().entries, 2);
});

test('concurrent misses share a loader; failed loads can be retried', async () => {
  const cache = createCache();
  let calls = 0;
  let release;
  const loader = () => { calls++; return new Promise(resolve => { release = resolve; }); };
  const first = cache.cached('shared', 1000, loader);
  const second = cache.cached('shared', 1000, loader);
  await Promise.resolve();
  release(42);
  assert.deepEqual(await Promise.all([first, second]), [42, 42]);
  assert.equal(calls, 1);
  assert.equal(cache.cacheStats().inflight, 0);
  await assert.rejects(cache.cached('retry', 1000, () => { throw new Error('offline'); }));
  assert.equal(await cache.cached('retry', 1000, () => 7), 7);
});

test('stale complete profiles return immediately while one refresh runs', async () => {
  const { createRefreshingCache } = await import('../src/cache.js');
  let time = 0, calls = 0, finish;
  const cache = createRefreshingCache({ freshMs: 10, retainMs: 100000, now: () => time });
  assert.equal(await cache.get('person', async () => 'old'), 'old');
  time = 11;
  const loader = () => { calls++; return new Promise(resolve => { finish = resolve; }); };
  assert.equal(await cache.get('person', loader), 'old');
  assert.equal(await cache.get('person', loader), 'old');
  assert.equal(calls, 1);
  finish('new');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(await cache.get('person', loader), 'new');
  time = 30;
  assert.equal(await cache.get('person', async () => { throw new Error('offline'); }), 'new');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(await cache.get('person', () => { throw new Error('must back off'); }), 'new');
});
