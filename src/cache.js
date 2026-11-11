const DEFAULT_MAX_ENTRIES = 2000;

export function createCache({ maxEntries = DEFAULT_MAX_ENTRIES, now = Date.now } = {}) {
  const store = new Map();
  const inflight = new Map();
  const limit = Number.isInteger(maxEntries) && maxEntries > 0 ? maxEntries : DEFAULT_MAX_ENTRIES;

  function prune() {
    const time = now();
    for (const [key, item] of store) {
      if (item.expiresAt <= time) store.delete(key);
    }
  }

  function getCached(key) {
    const item = store.get(key);
    if (!item) return undefined;
    if (item.expiresAt <= now()) {
      store.delete(key);
      return undefined;
    }
    // Promote a hit so eviction removes the least recently used entry.
    store.delete(key);
    store.set(key, item);
    return item.value;
  }

  function setCached(key, value, ttlMs) {
    prune();
    store.delete(key);
    if (ttlMs > 0) {
      store.set(key, { value, expiresAt: now() + ttlMs });
      while (store.size > limit) store.delete(store.keys().next().value);
    }
    return value;
  }

  async function cached(key, ttlMs, loader) {
    const hit = getCached(key);
    if (hit !== undefined) return hit;
    if (inflight.has(key)) return inflight.get(key);
    const pending = Promise.resolve().then(loader).then(value => setCached(key, value, ttlMs));
    inflight.set(key, pending);
    try {
      return await pending;
    } finally {
      inflight.delete(key);
    }
  }

  function cacheStats() {
    prune();
    return { entries: store.size, maxEntries: limit, inflight: inflight.size };
  }

  return { getCached, setCached, cached, cacheStats, prune };
}

const cache = createCache({ maxEntries: Number(process.env.CACHE_MAX_ENTRIES || DEFAULT_MAX_ENTRIES) });
const cleanup = setInterval(cache.prune, 60_000);
cleanup.unref();
export const { getCached, setCached, cached, cacheStats } = cache;

// A bounded profile store keeps the previous complete profile available while
// one background refresh runs. Failed refreshes retain the last good value.
export function createRefreshingCache({ maxEntries = 32, freshMs = 30 * 60_000, retainMs = 24 * 60 * 60_000, now = Date.now } = {}) {
  const records = createCache({ maxEntries, now });
  const pending = new Map();
  const retryAfter = new Map();
  function refresh(key, loader) {
    if (pending.has(key)) return pending.get(key);
    const request = Promise.resolve().then(loader).then(value => {
      records.setCached(key, { value, at: now() }, retainMs);
      return value;
    }).finally(() => { pending.delete(key); retryAfter.delete(key); });
    pending.set(key, request);
    return request;
  }
  return {
    async get(key, loader) {
      const old = records.getCached(key);
      if (!old) return refresh(key, loader);
      if (now() - old.at >= freshMs && now() >= (retryAfter.get(key) || 0)) {
        refresh(key, loader).catch(() => {
          // Do not retry on every request during an upstream outage.
          if (retryAfter.size >= maxEntries) retryAfter.delete(retryAfter.keys().next().value);
          retryAfter.set(key, now() + 60_000);
        });
      }
      return old.value;
    }
  };
}
