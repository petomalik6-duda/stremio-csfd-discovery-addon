import 'dotenv/config';
import express from 'express';
import { cacheStats } from './src/cache.js';
import { genreNames, getDiscoveryCatalog, searchDiscovery } from './src/discovery.js';
import { getMetaById, toPublicMeta } from './src/meta.js';
import { getPersonCredits, getPersonMeta, searchPeople } from './src/people.js';
import { probeTmdb } from './src/tmdb.js';

const PORT = Number(process.env.PORT || 10000);
const ADDON_VERSION = process.env.npm_package_version || '1.2.0';
const ADDON_ID = process.env.ADDON_ID || 'cz.csfd.discovery.v1';
const app = express();

const searchableBrowseExtra = [
  { name: 'search', isRequired: false },
  { name: 'genre', isRequired: false, options: genreNames },
  { name: 'skip', isRequired: false }
];
const browseExtra = [
  { name: 'genre', isRequired: false, options: genreNames },
  { name: 'skip', isRequired: false }
];
const peopleSearchExtra = [
  { name: 'search', isRequired: true },
  { name: 'skip', isRequired: false }
];

const catalogs = [
  { type: 'person', id: 'csfd-people', name: '👤 People – herci, režiséri a tvorcovia', extra: peopleSearchExtra },
  { type: 'movie', id: 'csfd-popular-movies', name: '🔥 Discovery – Populárne filmy', extra: searchableBrowseExtra },
  { type: 'movie', id: 'csfd-top-movies', name: '⭐ Discovery – Najlepšie hodnotené filmy', extra: browseExtra },
  { type: 'movie', id: 'csfd-new-movies', name: '🆕 Discovery – Nové filmy', extra: browseExtra },
  { type: 'movie', id: 'csfd-czsk-movies', name: '🇨🇿🇸🇰 Discovery – CZ/SK filmy', extra: browseExtra },
  { type: 'series', id: 'csfd-popular-series', name: '🔥 Discovery – Populárne seriály', extra: searchableBrowseExtra },
  { type: 'series', id: 'csfd-top-series', name: '⭐ Discovery – Najlepšie hodnotené seriály', extra: browseExtra },
  { type: 'series', id: 'csfd-new-series', name: '🆕 Discovery – Nové seriály', extra: browseExtra },
  { type: 'series', id: 'csfd-czsk-series', name: '🇨🇿🇸🇰 Discovery – CZ/SK seriály', extra: browseExtra }
];

const manifest = {
  id: ADDON_ID,
  version: ADDON_VERSION,
  name: 'ČSFD Discovery – filmy, seriály a tvorcovia',
  description: 'Vyhľadávanie filmov, seriálov a People podľa názvu, herca alebo režiséra. TMDB/IMDb matching pre kompatibilitu so stream add-onmi a ČSFD obohatenie detailu.',
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
      tmdbPersonIdHint: 'behaviorHints.tmdbPersonId',
      detailEndpoint: '/people/{id}.json',
      creditsEndpoint: '/people/{id}/credits.json'
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

async function catalogResponse(type, id, extra = {}) {
  if (!knownCatalog(type, id)) return { metas: [] };
  const skip = Math.max(0, Number(extra.skip || 0));
  const q = String(extra.search || '').trim();

  if (type === 'person') {
    if (!q) return { metas: [] };
    const started = Date.now();
    const rows = await searchPeople(q, 20);
    const page = rows.slice(skip, skip + 20);
    console.log(`[people-search] q=${JSON.stringify(q)} count=${page.length} ms=${Date.now() - started}`);
    return { metas: page };
  }

  if (q) {
    const started = Date.now();
    const rows = await searchDiscovery(q, type, 20);
    const page = rows.slice(skip, skip + 20).map(toPublicMeta);
    console.log(`[search] type=${type} q=${JSON.stringify(q)} count=${page.length} ms=${Date.now() - started}`);
    return { metas: page };
  }

  const rows = await getDiscoveryCatalog(type, id, extra);
  return { metas: rows.map(toPublicMeta) };
}

app.get('/', (_req, res) => {
  res.type('html').send(`<!doctype html>
<html lang="sk"><head><meta charset="utf-8"><title>ČSFD Discovery</title></head>
<body style="font-family:system-ui;max-width:800px;margin:40px auto;padding:0 20px">
<h1>ČSFD Discovery – Stremio/Nuvio addon</h1>
<p>Vyhľadáva filmy, seriály a osoby. People výsledky používajú samostatný typ <code>person</code> s TMDB person ID a detailom osoby.</p>
<ul>
<li><a href="/manifest.json">manifest.json</a></li>
<li><a href="/health">health</a></li>
<li><a href="/stats">stats</a></li>
<li><a href="/debug/people?q=Brad%20Pitt">debug People: Brad Pitt</a></li>
<li><a href="/debug/search?type=movie&q=Tom%20Hanks">debug filmy: Tom Hanks</a></li>
</ul>
<p>Príklady: <code>Brad Pitt</code>, <code>Tom Hanks</code>, <code>Christopher Nolan</code>, <code>Denis Villeneuve</code>.</p>
</body></html>`);
});

app.get('/manifest.json', (_req, res) => res.json(manifest));

app.get('/catalog/:type/:id.json', async (req, res, next) => {
  try { res.json(await catalogResponse(req.params.type, req.params.id, req.query)); }
  catch (e) { next(e); }
});

app.get('/catalog/:type/:id/:extra.json', async (req, res, next) => {
  try { res.json(await catalogResponse(req.params.type, req.params.id, parseExtra(req.params.extra))); }
  catch (e) { next(e); }
});

app.get('/meta/:type/:id.json', async (req, res, next) => {
  try {
    const isPersonProfile = String(req.params.id).startsWith('person:') &&
      (req.params.type === 'person' || req.params.type === 'series');
    if (isPersonProfile) {
      return res.json({ meta: await getPersonMeta(req.params.id) });
    }
    if (!['movie', 'series'].includes(req.params.type)) return res.json({ meta: null });
    res.json({ meta: await getMetaById(req.params.type, req.params.id) });
  } catch (e) { next(e); }
});

app.get('/people/search.json', async (req, res, next) => {
  try {
    const q = String(req.query.search || req.query.q || '').trim();
    const people = q ? await searchPeople(q, 20) : [];
    res.json({ people });
  } catch (e) { next(e); }
});

app.get('/people/:id.json', async (req, res, next) => {
  try {
    const meta = await getPersonMeta(req.params.id);
    res.json({ person: meta });
  } catch (e) { next(e); }
});

app.get('/people/:id/credits.json', async (req, res, next) => {
  try {
    const credits = await getPersonCredits(req.params.id);
    res.json({ personId: String(req.params.id).replace(/^person:/, ''), credits });
  } catch (e) { next(e); }
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
    at: new Date().toISOString()
  });
});

app.get('/stats', (_req, res) => res.json({ ok: true, cache: cacheStats(), catalogs: catalogs.length, peopleEnabled: true }));

app.get('/debug/people', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    const started = Date.now();
    const people = q ? await searchPeople(q, 20) : [];
    console.log(`[debug-people] q=${JSON.stringify(q)} count=${people.length} ms=${Date.now() - started}`);
    res.json({ ok: true, q, count: people.length, elapsedMs: Date.now() - started, people });
  } catch (e) { next(e); }
});

app.get('/debug/search', async (req, res, next) => {
  try {
    const type = req.query.type === 'series' ? 'series' : 'movie';
    const q = String(req.query.q || '').trim();
    const started = Date.now();
    const metas = q ? await searchDiscovery(q, type, 20) : [];
    console.log(`[debug-search] type=${type} q=${JSON.stringify(q)} count=${metas.length} ms=${Date.now() - started}`);
    res.json({ ok: true, type, q, count: metas.length, elapsedMs: Date.now() - started, metas: metas.map(toPublicMeta) });
  } catch (e) { next(e); }
});

app.use((err, req, res, _next) => {
  const status = err.response?.status || 500;
  const detail = err.response?.data?.status_message || err.message;
  console.error('[error]', req.method, req.originalUrl, status, detail);
  res.status(status >= 400 && status < 600 ? status : 500).json({ error: 'Addon request failed', detail });
});

app.listen(PORT, '0.0.0.0', async () => {
  console.log(`ČSFD Discovery v${ADDON_VERSION} listening on ${PORT}`);
  const tmdb = await probeTmdb();
  if (tmdb.ok) console.log('[tmdb] connectivity OK');
  else console.error('[tmdb] connectivity FAILED', tmdb.status || '', tmdb.message);
});
