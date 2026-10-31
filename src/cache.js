const store = new Map();

export function getCached(key) {
  const item = store.get(key);
  if (!item) return undefined;
  if (item.expiresAt <= Date.now()) {
    store.delete(key);
    return undefined;
  }
  return item.value;
}

export function setCached(key, value, ttlMs) {
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
  return value;
}

export async function cached(key, ttlMs, loader) {
  const hit = getCached(key);
  if (hit !== undefined) return hit;
  const value = await loader();
  setCached(key, value, ttlMs);
  return value;
}

export function cacheStats() {
  const now = Date.now();
  let live = 0;
  for (const [key, item] of store) {
    if (item.expiresAt > now) live += 1;
    else store.delete(key);
  }
  return { entries: live };
}
