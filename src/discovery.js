import { discover, personCredits, resolveTmdbItemToStremioMeta, searchPerson, searchTitles } from './tmdb.js';

const GENRES = {
  Akční: { movie: 28, series: 10759 },
  Dobrodružný: { movie: 12, series: 10759 },
  Animovaný: { movie: 16, series: 16 },
  Komedie: { movie: 35, series: 35 },
  Krimi: { movie: 80, series: 80 },
  Dokumentární: { movie: 99, series: 99 },
  Drama: { movie: 18, series: 18 },
  Rodinný: { movie: 10751, series: 10751 },
  Fantasy: { movie: 14, series: 10765 },
  Historický: { movie: 36, series: 18 },
  Horor: { movie: 27, series: 9648 },
  Hudební: { movie: 10402, series: 10767 },
  Mysteriózní: { movie: 9648, series: 9648 },
  Romantický: { movie: 10749, series: 18 },
  'Sci-Fi': { movie: 878, series: 10765 },
  Thriller: { movie: 53, series: 9648 },
  Válečný: { movie: 10752, series: 10768 },
  Western: { movie: 37, series: 37 }
};

export const genreNames = Object.keys(GENRES);

function stripPrefix(query = '') {
  const raw = String(query).trim();
  const patterns = [
    { re: /^(herec|herečka|actor|actress)\s*:\s*/i, role: 'actor' },
    { re: /^(režisér|reziser|director)\s*:\s*/i, role: 'director' },
    { re: /^(osoba|person)\s*:\s*/i, role: 'person' }
  ];
  for (const p of patterns) {
    if (p.re.test(raw)) return { query: raw.replace(p.re, '').trim(), role: p.role };
  }
  return { query: raw, role: 'auto' };
}

function normalize(s = '') {
  return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function creditMatchesType(c, type) {
  return type === 'series' ? c.media_type === 'tv' : c.media_type === 'movie';
}

function pickPersonCredits(credits, role, type) {
  const rows = [];
  if (role === 'actor' || role === 'person' || role === 'auto') {
    for (const c of credits.cast || []) if (creditMatchesType(c, type)) rows.push(c);
  }
  if (role === 'director' || role === 'person' || role === 'auto') {
    for (const c of credits.crew || []) {
      if (creditMatchesType(c, type) && c.job === 'Director') rows.push(c);
    }
  }
  const map = new Map();
  for (const row of rows) {
    if (!map.has(`${row.media_type}:${row.id}`)) map.set(`${row.media_type}:${row.id}`, row);
  }
  return [...map.values()].sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
}

async function mapLimited(items, limit, mapper) {
  const out = new Array(items.length);
  let index = 0;
  async function worker() {
    while (true) {
      const i = index++;
      if (i >= items.length) return;
      try { out[i] = await mapper(items[i], i); }
      catch (e) { console.warn('[resolver]', e.message); out[i] = null; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out.filter(Boolean);
}

async function personSearch(query, role, type, limit) {
  const people = await searchPerson(query);
  if (!people.length) return [];
  const exact = people.find(p => normalize(p.name) === normalize(query));
  const person = exact || people[0];
  const credits = await personCredits(person.id);
  const selected = pickPersonCredits(credits, role, type).slice(0, limit);
  return mapLimited(selected, 8, item => resolveTmdbItemToStremioMeta(item, type));
}

async function titleSearch(query, type, limit) {
  const titles = (await searchTitles(query, type)).slice(0, limit);
  return mapLimited(titles, 8, item => resolveTmdbItemToStremioMeta(item, type));
}

export async function searchDiscovery(rawQuery, type, limit = 80) {
  const parsed = stripPrefix(rawQuery);
  if (!parsed.query) return [];

  if (parsed.role !== 'auto') return personSearch(parsed.query, parsed.role, type, limit);

  const [people, titles] = await Promise.all([
    searchPerson(parsed.query),
    searchTitles(parsed.query, type)
  ]);

  const exactPerson = people.find(p => normalize(p.name) === normalize(parsed.query));
  if (exactPerson) {
    const personResults = await personSearch(parsed.query, 'auto', type, limit);
    if (personResults.length) return personResults;
  }

  if (titles.length) return titleSearch(parsed.query, type, limit);
  if (people.length) return personSearch(parsed.query, 'auto', type, limit);
  return [];
}

async function loadFivePages(type, opts) {
  const pages = await Promise.all([0, 1, 2, 3, 4].map(i => discover(type, { ...opts, page: opts.page + i })));
  return pages.flat();
}

export async function getDiscoveryCatalog(type, catalogId, extra = {}) {
  const skip = Math.max(0, Number(extra.skip || 0));
  const stremioPage = Math.floor(skip / 100);
  const tmdbStartPage = stremioPage * 5 + 1;
  const mode = catalogId.includes('top') ? 'top' : catalogId.includes('new') ? 'new' : 'popular';
  const genreId = extra.genre && GENRES[extra.genre] ? GENRES[extra.genre][type] : null;

  let rows;
  if (catalogId.includes('czsk')) {
    const [cs, sk] = await Promise.all([
      loadFivePages(type, { mode, genreId, page: tmdbStartPage, language: 'cs' }),
      loadFivePages(type, { mode, genreId, page: tmdbStartPage, language: 'sk' })
    ]);
    const map = new Map([...cs, ...sk].map(x => [x.id, x]));
    rows = [...map.values()].sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
  } else {
    rows = await loadFivePages(type, { mode, genreId, page: tmdbStartPage });
  }

  const selected = rows.slice(0, 100);
  return mapLimited(selected, 10, item => resolveTmdbItemToStremioMeta(item, type));
}
