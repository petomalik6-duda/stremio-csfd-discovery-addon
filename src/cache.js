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
