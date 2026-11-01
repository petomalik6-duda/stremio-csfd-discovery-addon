import 'dotenv/config';
import express from 'express';
import { cacheStats } from './src/cache.js';
import { searchFilmography } from './src/discovery.js';
import { getMetaById, toPublicMeta } from './src/meta.js';
import { getPersonCredits, getPersonMeta, searchPeople } from './src/people.js';
import { probeTmdb } from './src/tmdb.js';

const PORT = Number(process.env.PORT || 10000);
const ADDON_VERSION = process.env.npm_package_version || '1.4.8';
const ADDON_ID = process.env.ADDON_ID || 'cz.csfd.discovery.v1';
const FILMOGRAPHY_PAGE_SIZE = 20;
const app = express();

const searchExtra = [{ name: 'search', isRequired: true }];
const pagedSearchExtra = [...searchExtra, { name: 'skip' }];
const catalogs = [
  { type: 'person', id: 'csfd-people', name: '👤 Osoby', extra: searchExtra },
  { type: 'movie', id: 'csfd-person-popular-movies', name: '⭐ Populárne filmy osoby', extra: pagedSearchExtra, pageSize: FILMOGRAPHY_PAGE_SIZE },
  { type: 'series', id: 'csfd-person-popular-series', name: '⭐ Populárne seriály osoby', extra: pagedSearchExtra, pageSize: FILMOGRAPHY_PAGE_SIZE },
  { type: 'movie', id: 'csfd-person-movies', name: '🎬 Filmografia osoby – filmy', extra: pagedSearchExtra, pageSize: FILMOGRAPHY_PAGE_SIZE },
  { type: 'series', id: 'csfd-person-series', name: '📺 Filmografia osoby – seriály', extra: pagedSearchExtra, pageSize: FILMOGRAPHY_PAGE_SIZE },
  { type: 'movie', id: 'csfd-person-creator-movies', name: '🎥 Réžia/produkcia osoby – filmy', extra: pagedSearchExtra, pageSize: FILMOGRAPHY_PAGE_SIZE },
  { type: 'series', id: 'csfd-person-creator-series', name: '🎥 Réžia/produkcia osoby – seriály', extra: pagedSearchExtra, pageSize: FILMOGRAPHY_PAGE_SIZE },
  { type: 'movie', id: 'csfd-person-upcoming-movies', name: '📅 Pripravované filmy osoby', extra: pagedSearchExtra, pageSize: FILMOGRAPHY_PAGE_SIZE },
  { type: 'series', id: 'csfd-person-upcoming-series', name: '📅 Pripravované seriály osoby', extra: pagedSearchExtra, pageSize: FILMOGRAPHY_PAGE_SIZE },
  { type: 'movie', id: 'csfd-person-special-movies', name: '🎞️ Dokumenty a krátke filmy osoby', extra: pagedSearchExtra, pageSize: FILMOGRAPHY_PAGE_SIZE },
  { type: 'series', id: 'csfd-person-documentary-series', name: '🎞️ Dokumentárne seriály osoby', extra: pagedSearchExtra, pageSize: FILMOGRAPHY_PAGE_SIZE }
];

const manifest = {
  id: ADDON_ID,
  version: ADDON_VERSION,
  name: 'ČSFD – osoby a filmografia',
  description: 'Vyhľadávanie osôb s čistým profilom a posterovými katalógmi pre populárne tituly, filmy, seriály, réžiu/produkciu, pripravované tituly a dokumenty.',
  resources: [
    'catalog',
    { name: 'meta', types: ['movie', 'series', 'person'], idPrefixes: ['tt', 'tmdb:', 'person:'] }
  ],
  types: ['movie', 'series', 'person'],
  catalogs,
  idPrefixes: ['tt', 'tmdb:', 'person:'],
  behaviorHints: { configurable: false, configurationRequired: false },
  nuvio: {
    people: {
      enabled: true,
      catalogId: 'csfd-people',
      idPrefix: 'person:',
      richProfiles: true,
      compactProfileText: true
    },
    filmography: {
      standardMediaIds: true,
      completeResponse: true,
      ratingSource: 'TMDB',
      pagination: true,
      pageSize: FILMOGRAPHY_PAGE_SIZE,
      modes: ['popular', 'acting', 'creator', 'upcoming', 'documentary']
    }
  }
};

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Cache-Control', 'public, max-age=300');
  next();
});
app.use(express.json());

function parseExtra(raw = '') {
  const out = {};
  if (!raw) return out;
  for (const part of String(raw).split('&')) {
    const [key, value = ''] = part.split('=');
    if (key) out[decodeURIComponent(key)] = decodeURIComponent(value.replace(/\+/g, ' '));
  }
  return out;
}

function knownCatalog(type, id) {
  return catalogs.some(c => c.type === type && c.id === id);
}

function parseSkip(value) {
  const skip = Number.parseInt(String(value ?? '0'), 10);
  return Number.isFinite(skip) && skip > 0 ? skip : 0;
}

function toFilmographyCatalogMeta(meta) {
  const clean = toPublicMeta(meta);
  if (!clean) return clean;
  const n = Number(clean.imdbRating);
  const rating = clean.imdbRating != null && clean.imdbRating !== '' && Number.isFinite(n) ? n.toFixed(1) : null;
  const year = String(clean.releaseInfo || '').trim() || null;
  const labels = [year, rating ? `⭐ ${rating}` : null].filter(Boolean);
  return { ...clean, releaseInfo: labels.length ? labels.join(' • ') : clean.releaseInfo };
}

async function catalogResponse(type, id, extra = {}) {
  if (!knownCatalog(type, id)) return { metas: [] };
  const q = String(extra.search || '').trim();
  if (!q) return { metas: [] };

  const started = Date.now();
  if (type === 'person') {
    const rows = await searchPeople(q, 20);
    return { metas: rows };
  }

  let category = 'main';
  let forcedRole = null;

  if (id === 'csfd-person-special-movies' || id === 'csfd-person-documentary-series') category = 'special';
  if (id === 'csfd-person-creator-movies' || id === 'csfd-person-creator-series') {
    category = 'creator';
    forcedRole = 'creator';
  }
  if (id === 'csfd-person-popular-movies' || id === 'csfd-person-popular-series') category = 'popular';
  if (id === 'csfd-person-upcoming-movies' || id === 'csfd-person-upcoming-series') category = 'upcoming';

  const rows = await searchFilmography(q, type, category, forcedRole);
  const skip = parseSkip(extra.skip);
  const metas = rows
    .slice(skip, skip + FILMOGRAPHY_PAGE_SIZE)
    .map(toFilmographyCatalogMeta);

  console.log(`[filmography-search] type=${type} category=${category} q=${JSON.stringify(q)} skip=${skip} count=${metas.length} total=${rows.length} ms=${Date.now() - started}`);
  return { metas };
}

app.get('/', (_req, res) => res.type('html').send('<!doctype html><html lang="sk"><body><h1>ČSFD – osoby a filmografia</h1><p>Vyhľadávanie osôb s čistým profilom a 10 posterovými filmografickými katalógmi.</p><a href="/manifest.json">manifest.json</a></body></html>'));
app.get('/manifest.json', (_req, res) => res.json(manifest));
app.get('/catalog/:type/:id.json', async (req, res, next) => {
  try {
    res.json(await catalogResponse(req.params.type, req.params.id, req.query));
  } catch (e) {
    next(e);
  }
});
app.get('/catalog/:type/:id/:extra.json', async (req, res, next) => {
  try {
    res.json(await catalogResponse(req.params.type, req.params.id, parseExtra(req.params.extra)));
  } catch (e) {
    next(e);
  }
});

app.get('/meta/:type/:id.json', async (req, res, next) => {
  try {
    if (String(req.params.id).startsWith('person:') && req.params.type === 'person') {
      return res.json({ meta: await getPersonMeta(req.params.id) });
    }
    if (!['movie', 'series'].includes(req.params.type)) return res.json({ meta: null });
    res.json({ meta: await getMetaById(req.params.type, req.params.id) });
  } catch (e) {
    next(e);
  }
});

app.get('/people/search.json', async (req, res, next) => {
  try {
    const q = String(req.query.search || req.query.q || '').trim();
    res.json({ people: q ? await searchPeople(q, 20) : [] });
  } catch (e) {
    next(e);
  }
});
app.get('/people/:id.json', async (req, res, next) => {
  try {
    res.json({ person: await getPersonMeta(req.params.id) });
  } catch (e) {
    next(e);
  }
});
app.get('/people/:id/credits.json', async (req, res, next) => {
  try {
    res.json({
      personId: String(req.params.id).replace(/^person:/, ''),
      credits: await getPersonCredits(req.params.id)
    });
  } catch (e) {
    next(e);
  }
});

app.get('/health', async (_req, res) => {
  const configured = Boolean(process.env.TMDB_API_KEY || process.env.TMDB_READ_ACCESS_TOKEN);
  const tmdb = configured ? await probeTmdb() : { ok: false, message: 'TMDB credentials are not configured' };
  res.json({
    ok: true,
    addon: manifest.name,
    version: ADDON_VERSION,
    tmdbConfigured: configured,
    tmdb,
    peopleEnabled: true,
    richPersonProfiles: true,
    compactPersonProfile: true,
    personFilmographyCatalogs: true,
    personHighlightCatalogs: true,
    standardFilmographyMediaIds: true,
    filmographyPagination: true,
    filmographyPageSize: FILMOGRAPHY_PAGE_SIZE,
    filmographyRatingSource: 'TMDB',
    catalogCount: catalogs.length,
    catalogs: catalogs.map(c => c.id),
    at: new Date().toISOString()
  });
});

app.get('/stats', (_req, res) => res.json({
  ok: true,
  cache: cacheStats(),
  richPersonProfiles: true,
  compactPersonProfile: true,
  personHighlightCatalogs: true,
  catalogs: catalogs.length,
  catalogIds: catalogs.map(c => c.id)
}));

app.use((err, req, res, _next) => {
  const status = err.response?.status || 500;
  const detail = err.response?.data?.status_message || err.message;
  console.error('[error]', req.method, req.originalUrl, status, detail);
  res.status(status >= 400 && status < 600 ? status : 500).json({ error: 'Addon request failed', detail });
});

app.listen(PORT, '0.0.0.0', () => console.log(`[startup] ${manifest.name} v${ADDON_VERSION} listening on ${PORT}`));
