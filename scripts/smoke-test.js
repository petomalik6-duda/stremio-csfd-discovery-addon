import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { __fuzzyTest } from '../src/discovery.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const port = 19123;
const child = spawn(process.execPath, ['server.js'], {
  env: { ...process.env, PORT: String(port), TMDB_API_KEY: '', TMDB_READ_ACCESS_TOKEN: '' },
  stdio: ['ignore', 'pipe', 'pipe']
});

let stderr = '';
child.stderr.on('data', chunk => { stderr += String(chunk); });

async function waitForHealth() {
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.ok) return res.json();
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(`Server did not become healthy. ${stderr}`);
}

try {
  const typo = 'silvester stalone';
  const target = 'Sylvester Stallone';
  assert.ok(__fuzzyTest.nameSimilarity(typo, target) > 0.80);
  const fuzzyQueries = [
    ...__fuzzyTest.primaryPersonQueries(typo),
    ...__fuzzyTest.fallbackPersonQueries(typo)
  ];
  assert.ok(fuzzyQueries.includes('sylvester'));
  assert.ok(fuzzyQueries.includes('stallone'));

  const health = await waitForHealth();
  assert.equal(health.ok, true);
  assert.equal(health.tmdbConfigured, false);
  assert.equal(health.peopleEnabled, true);
  assert.equal(health.richPersonProfiles, true);
  assert.equal(health.compactPersonProfile, true);
  assert.equal(health.fuzzySearchVersion, 2);
  assert.equal(health.parallelPersonSearch, true);
  assert.equal(health.personSearchCacheHours, 12);
  assert.equal(health.personFilmographyCatalogs, true);
  assert.equal(health.popularPersonCatalogs, false);
  assert.equal(health.upcomingPersonCatalogs, true);
  assert.equal(health.standardFilmographyMediaIds, true);
  assert.equal(health.filmographyPagination, true);
  assert.equal(health.filmographyPageSize, 20);
  assert.equal(health.filmographyRatingSource, 'TMDB');

  const manifestRes = await fetch(`http://127.0.0.1:${port}/manifest.json`);
  assert.equal(manifestRes.ok, true);
  const manifest = await manifestRes.json();
  assert.equal(manifest.id, 'cz.csfd.discovery.v1');
  assert.equal(manifest.version, pkg.version);
  assert.ok(Array.isArray(manifest.catalogs));
  assert.ok(manifest.types.includes('person'));
  assert.equal(manifest.nuvio?.people?.richProfiles, true);
  assert.equal(manifest.nuvio?.people?.compactProfileText, true);
  assert.equal(manifest.nuvio?.people?.fuzzySearchVersion, 2);
  assert.equal(manifest.nuvio?.people?.parallelSearch, true);
  assert.ok(!manifest.nuvio?.filmography?.modes?.includes('popular'));
  assert.ok(manifest.nuvio?.filmography?.modes?.includes('upcoming'));

  const peopleCatalog = manifest.catalogs.find(c => c.type === 'person' && c.id === 'csfd-people');
  assert.ok(peopleCatalog);
  assert.ok(peopleCatalog.extra?.some(e => e.name === 'search' && e.isRequired === true));

  const movieFilmography = manifest.catalogs.find(c => c.type === 'movie' && c.id === 'csfd-person-movies');
  const seriesFilmography = manifest.catalogs.find(c => c.type === 'series' && c.id === 'csfd-person-series');
  const upcomingMovies = manifest.catalogs.find(c => c.type === 'movie' && c.id === 'csfd-person-upcoming-movies');
  const upcomingSeries = manifest.catalogs.find(c => c.type === 'series' && c.id === 'csfd-person-upcoming-series');
  const popularMovies = manifest.catalogs.find(c => c.id === 'csfd-person-popular-movies');
  const popularSeries = manifest.catalogs.find(c => c.id === 'csfd-person-popular-series');

  assert.equal(popularMovies, undefined);
  assert.equal(popularSeries, undefined);

  for (const catalog of [movieFilmography, seriesFilmography, upcomingMovies, upcomingSeries]) {
    assert.ok(catalog);
    assert.equal(catalog.pageSize, 20);
    assert.ok(catalog.extra?.some(e => e.name === 'search' && e.isRequired === true));
    assert.ok(catalog.extra?.some(e => e.name === 'skip'));
  }

  const metaResource = manifest.resources.find(r => typeof r === 'object' && r.name === 'meta');
  assert.ok(metaResource);
  assert.ok(metaResource.types.includes('person'));
  assert.ok(metaResource.idPrefixes.includes('person:'));

  const streamResource = manifest.resources.find(r => typeof r === 'object' && r.name === 'stream');
  assert.equal(streamResource, undefined);
  assert.equal(manifest.idPrefixes.includes('person-credit:'), false);

  console.log('Smoke test passed:', {
    version: manifest.version,
    catalogs: manifest.catalogs.length,
    addon: manifest.name,
    fuzzySearchVersion: health.fuzzySearchVersion,
    parallelPersonSearch: health.parallelPersonSearch,
    typoSimilarity: __fuzzyTest.nameSimilarity(typo, target).toFixed(3),
    typoRecoveryQueries: fuzzyQueries.filter(q => q === 'sylvester' || q === 'stallone'),
    peopleCatalog: peopleCatalog.name,
    upcomingMovies: upcomingMovies.name,
    upcomingSeries: upcomingSeries.name,
    filmographyPageSize: movieFilmography.pageSize
  });
} finally {
  child.kill('SIGTERM');
}
