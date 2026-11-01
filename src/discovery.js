import { imageUrl, personCredits, searchPerson } from './tmdb.js';
import { externalPosterByTitle } from './externalArtwork.js';

const PERSON_TTL = 12 * 60 * 60 * 1000;
const FILMOGRAPHY_TTL = 6 * 60 * 60 * 1000;
const EXTERNAL_TTL = 7 * 24 * 60 * 60 * 1000;
const PERSON_QUERY_BATCH = 8;

const personCache = new Map();
const personInflight = new Map();
const creditsCache = new Map();
const creditsInflight = new Map();
const externalArtworkCache = new Map();
const externalArtworkInflight = new Map();

function stripPrefix(query = '') {
  const raw = String(query).trim();
  const patterns = [
    { re: /^(herec|herečka|herecka|actor|actress)\s*:\s*/i, role: 'actor' },
    { re: /^(režisér|reziser|režiser|director)\s*:\s*/i, role: 'director' },
    { re: /^(producent|producer)\s*:\s*/i, role: 'producer' },
    { re: /^(scenárista|scenarista|writer)\s*:\s*/i, role: 'writer' },
    { re: /^(osoba|person)\s*:\s*/i, role: 'person' }
  ];
  for (const p of patterns) {
    if (p.re.test(raw)) return { query: raw.replace(p.re, '').trim(), role: p.role };
  }
  return { query: raw, role: 'auto' };
}

function normalize(s = '') {
  return String(s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim();
}

function getFresh(cache, key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > hit.ttl) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

function setFresh(cache, key, value, ttl) {
  cache.set(key, { value, at: Date.now(), ttl });
  return value;
}

async function shared(cache, inflight, key, ttl, loader) {
  const hit = getFresh(cache, key);
  if (hit !== null) return hit;
  if (inflight.has(key)) return inflight.get(key);
  const promise = (async () => {
    try {
      return setFresh(cache, key, await loader(), ttl);
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, promise);
  return promise;
}

function levenshtein(a, b) {
  a = normalize(a);
  b = normalize(b);
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let previous = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const current = [i];
    for (let j = 1; j <= n; j++) {
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    previous = current;
  }
  return previous[n];
}

function tokenSimilarity(a, b) {
  const x = normalize(a);
  const y = normalize(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.startsWith(y) || y.startsWith(x)) return 0.96;
  if (x.includes(y) || y.includes(x)) return 0.92;
  return Math.max(0, 1 - levenshtein(x, y) / Math.max(x.length, y.length));
}

function nameSimilarity(a, b) {
  const x = normalize(a);
  const y = normalize(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const xa = x.split(' ').filter(Boolean);
  const ya = y.split(' ').filter(Boolean);
  if (xa.length === 1 || ya.length === 1) return tokenSimilarity(x, y) * 0.72;

  let forward = 0;
  for (const q of xa) {
    let best = 0;
    for (const t of ya) best = Math.max(best, tokenSimilarity(q, t));
    forward += best;
  }
  forward /= xa.length;

  let reverse = 0;
  for (const t of ya) {
    let best = 0;
    for (const q of xa) best = Math.max(best, tokenSimilarity(t, q));
    reverse += best;
  }
  reverse /= ya.length;

  return forward * 0.42 + reverse * 0.13 + tokenSimilarity(xa[0], ya[0]) * 0.25 + tokenSimilarity(xa.at(-1), ya.at(-1)) * 0.20;
}

function swapIYVariants(token) {
  const out = new Set();
  for (let i = 0; i < token.length; i++) {
    if (token[i] === 'i') out.add(token.slice(0, i) + 'y' + token.slice(i + 1));
    if (token[i] === 'y') out.add(token.slice(0, i) + 'i' + token.slice(i + 1));
  }
  return [...out];
}

function duplicateConsonantVariants(token) {
  const out = new Set();
  const consonant = /[bcdfghjklmnpqrstvwxyz]/;
  for (let i = 1; i < token.length - 1; i++) {
    if (consonant.test(token[i])) out.add(token.slice(0, i) + token[i] + token.slice(i));
  }
  return [...out];
}

function deletionVariants(token) {
  if (token.length < 6) return [];
  const out = [];
  for (let i = 1; i < token.length - 1; i++) out.push(token.slice(0, i) + token.slice(i + 1));
  return out;
}

function primaryPersonQueries(query) {
  const q = normalize(query);
  const tokens = q.split(' ').filter(Boolean);
  const out = new Set([q]);
  for (const token of tokens) {
    out.add(token);
    if (token.length >= 5) out.add(token.slice(0, 5));
    if (token.length >= 6) out.add(token.slice(0, 6));
    for (const v of swapIYVariants(token)) out.add(v);
  }
  return [...out].filter(x => x.length >= 2).slice(0, 12);
}

function fallbackPersonQueries(query) {
  const tokens = normalize(query).split(' ').filter(Boolean);
  const out = new Set();
  for (const token of [...tokens].reverse()) {
    if (token.length >= 5) {
      for (let n = 4; n <= Math.min(7, token.length - 1); n++) out.add(token.slice(0, n));
      for (const v of swapIYVariants(token)) out.add(v);
      for (const v of duplicateConsonantVariants(token)) out.add(v);
      for (const v of deletionVariants(token)) out.add(v);
    }
  }
  return [...out].filter(x => x.length >= 3).slice(0, 20);
}

function rankPeople(people, query) {
  const qt = normalize(query).split(' ').filter(Boolean);
  const qFirst = qt[0] || '';
  const qLast = qt.at(-1) || '';
  return (people || []).map((person, index) => {
    const pt = normalize(person.name).split(' ').filter(Boolean);
    const similarity = nameSimilarity(query, person.name);
    const first = tokenSimilarity(qFirst, pt[0] || '');
    const last = tokenSimilarity(qLast, pt.at(-1) || '');
    const fullName = pt.length > 1;
    const popularity = Math.max(0, Number(person.popularity) || 0);
    return {
      p: person,
      index,
      similarity,
      first,
      last,
      fullName,
      score: similarity + first * 0.24 + last * 0.30 + (qt.length > 1 && fullName ? 0.18 : -0.22) + Math.min(0.14, Math.log10(popularity + 1) * 0.04)
    };
  }).sort((a, b) => b.score - a.score || b.similarity - a.similarity || a.index - b.index);
}

function bestPersonRank(people, query) {
  return rankPeople(people, query)[0] || null;
}

function bestPersonMatch(people, query) {
  const qt = normalize(query).split(' ').filter(Boolean);
  const best = bestPersonRank(people, query);
  if (!best) return null;
  if (qt.length > 1) {
    if (!best.fullName || best.first < 0.66 || best.last < 0.66 || best.similarity < 0.66) return null;
  } else if (best.similarity < 0.52) return null;
  return best.p;
}

function confidentPersonMatch(people, query) {
  const qt = normalize(query).split(' ').filter(Boolean);
  const best = bestPersonRank(people, query);
  if (!best) return false;
  if (qt.length > 1) return best.fullName && best.first >= 0.76 && best.last >= 0.76 && best.similarity >= 0.80;
  return best.similarity >= 0.82;
}

async function runPersonQueries(queries, add) {
  for (let i = 0; i < queries.length; i += PERSON_QUERY_BATCH) {
    const batch = queries.slice(i, i + PERSON_QUERY_BATCH);
    const results = await Promise.allSettled(batch.map(q => searchPerson(q)));
    for (const result of results) {
      if (result.status === 'fulfilled') add(result.value);
    }
  }
}

async function findPeopleFuzzyUncached(query) {
  const combined = [];
  const seen = new Set();
  const add = rows => {
    for (const person of rows || []) {
      if (!seen.has(person.id)) {
        seen.add(person.id);
        combined.push(person);
      }
    }
  };

  const primary = primaryPersonQueries(query);
  await runPersonQueries(primary, add);
  if (confidentPersonMatch(combined, query)) return combined;

  const primarySet = new Set(primary);
  const fallback = fallbackPersonQueries(query).filter(q => !primarySet.has(q));
  await runPersonQueries(fallback, add);
  return combined;
}

async function findPeopleFuzzy(query) {
  const key = normalize(query);
  return shared(personCache, personInflight, key, PERSON_TTL, () => findPeopleFuzzyUncached(query));
}

async function resolvePerson(query) {
  return bestPersonMatch(await findPeopleFuzzy(query), query);
}

export async function searchPeopleFuzzy(query, limit = 20) {
  const q = String(query || '').trim();
  if (!q) return [];
  const people = await findPeopleFuzzy(q);
  const ranked = rankPeople(people, q);
  const best = bestPersonMatch(people, q);
  if (!best) return [];
  return [
    best,
    ...ranked.map(r => r.p).filter(p => p.id !== best.id && nameSimilarity(q, p.name) >= 0.64)
  ].slice(0, limit);
}

function creditDate(credit) {
  return Date.parse((credit.media_type === 'tv' ? credit.first_air_date : credit.release_date) || '') || 0;
}

function creditPopularity(credit) {
  return Math.max(0, Number(credit?.popularity) || 0);
}

function pickPersonCredits(credits, role, type) {
  const rows = [];
  const mediaType = type === 'series' ? 'tv' : 'movie';

  if (['actor', 'person', 'auto'].includes(role)) {
    for (const c of credits.cast || []) if (c.media_type === mediaType) rows.push(c);
  }
  if (role === 'director') {
    for (const c of credits.crew || []) if (c.media_type === mediaType && c.job === 'Director') rows.push(c);
  }
  if (role === 'producer') {
    for (const c of credits.crew || []) {
      if (c.media_type === mediaType && ['Producer', 'Executive Producer', 'Co-Producer', 'Associate Producer'].includes(c.job)) rows.push(c);
    }
  }
  if (role === 'creator') {
    for (const c of credits.crew || []) {
      if (c.media_type === mediaType && ['Director', 'Producer', 'Executive Producer', 'Co-Producer', 'Associate Producer'].includes(c.job)) rows.push(c);
    }
  }
  if (role === 'writer') {
    for (const c of credits.crew || []) {
      if (c.media_type === mediaType && ['Writer', 'Screenplay', 'Story'].includes(c.job)) rows.push(c);
    }
  }

  const unique = new Map();
  for (const row of rows) {
    const key = `${row.media_type}:${row.id}`;
    if (!unique.has(key)) unique.set(key, row);
  }
  return [...unique.values()].sort((a, b) => creditDate(b) - creditDate(a) || creditPopularity(b) - creditPopularity(a));
}

function isDocumentaryCredit(item) {
  return Array.isArray(item?.genre_ids) && item.genre_ids.includes(99);
}

function fastMeta(item, type) {
  const series = type === 'series';
  const date = series ? item.first_air_date : item.release_date;
  const year = date ? String(date).slice(0, 4) : undefined;
  return {
    id: `tmdb:${type}:${item.id}`,
    type,
    name: (series ? item.name : item.title) || (series ? item.original_name : item.original_title) || 'Bez názvu',
    poster: imageUrl(item.poster_path, 'w500'),
    background: imageUrl(item.backdrop_path, 'w1280'),
    description: item.overview || '',
    releaseInfo: year,
    year: year ? Number(year) : undefined,
    imdbRating: item.vote_average ? Number(item.vote_average).toFixed(1) : undefined,
    _tmdb: { id: item.id, fast: true }
  };
}

async function getCredits(id) {
  return shared(creditsCache, creditsInflight, String(id), FILMOGRAPHY_TTL, () => personCredits(id));
}

function externalKey(item, type) {
  return `${type}:${item.id}`;
}

function cachedExternal(item, type) {
  return getFresh(externalArtworkCache, externalKey(item, type));
}

function warmExternal(item, type) {
  const key = externalKey(item, type);
  if (getFresh(externalArtworkCache, key) !== null || externalArtworkInflight.has(key)) return;
  const promise = (async () => {
    try {
      const art = await externalPosterByTitle(item, type);
      setFresh(externalArtworkCache, key, art || false, EXTERNAL_TTL);
      if (art?.poster) console.log(`[poster-warmed] source=${art.source} type=${type} id=${item.id}`);
    } catch (e) {
      setFresh(externalArtworkCache, key, false, 6 * 60 * 60 * 1000);
      console.warn('[poster-warm-error]', type, item.id, e.message);
    } finally {
      externalArtworkInflight.delete(key);
    }
  })();
  externalArtworkInflight.set(key, promise);
}

async function fastFilmography(query, role, type) {
  const person = await resolvePerson(query);
  if (!person) return [];
  const selected = pickPersonCredits(await getCredits(person.id), role, type);
  const base = selected.map(item => ({ item, meta: fastMeta(item, type) }));

  let warmCount = 0;
  for (const entry of base) {
    if (entry.meta.poster) continue;
    const cached = cachedExternal(entry.item, type);
    if (cached?.poster) {
      entry.meta.poster = cached.poster;
      continue;
    }
    if (cached === false) continue;
    if (warmCount < 6) {
      warmExternal(entry.item, type);
      warmCount++;
    }
  }

  const missing = base.filter(x => !x.meta.poster).length;
  if (missing) console.log(`[poster-async] person=${JSON.stringify(person.name)} type=${type} unresolved-now=${missing} warming=${warmCount}`);
  return base;
}

function applyCatalogMode(rows, category) {
  if (category === 'special') return rows.filter(x => isDocumentaryCredit(x.item));
  if (category === 'creator') return rows;

  const nonDocumentary = rows.filter(x => !isDocumentaryCredit(x.item));
  if (category === 'upcoming') {
    const now = Date.now();
    return nonDocumentary
      .filter(x => creditDate(x.item) > now)
      .sort((a, b) => creditDate(a.item) - creditDate(b.item) || creditPopularity(b.item) - creditPopularity(a.item));
  }
  return nonDocumentary;
}

export async function searchFilmography(rawQuery, type, category = 'main', forcedRole = null) {
  const parsed = stripPrefix(rawQuery);
  if (!parsed.query || normalize(parsed.query).length < 4) return [];
  const role = forcedRole || (parsed.role === 'auto' || parsed.role === 'person' ? 'actor' : parsed.role);
  const rows = await fastFilmography(parsed.query, role, type);
  return applyCatalogMode(rows, category).map(x => x.meta);
}

export const __fuzzyTest = {
  normalize,
  nameSimilarity,
  primaryPersonQueries,
  fallbackPersonQueries
};
