import assert from 'node:assert/strict';
import axios from 'axios';

process.env.TMDB_API_KEY = 'test-only';
const { getPersonMeta, parsePersonId } = await import('../src/people.js');
let active = 0;
let peak = 0;
let requests = 0;
axios.defaults.adapter = async config => {
  requests++;
  let data;
  if (config.url.startsWith('https://www.csfd.cz/')) {
    data = '<html></html>';
  } else if (config.url.endsWith('/search/person')) {
    data = { results: [{ id: 287, name: 'Brad Pitt', popularity: 100, known_for_department: 'Acting' }] };
  } else if (config.url.endsWith('/find/tt16311594')) {
    data = { movie_results: [{ id: 911430 }] };
  } else if (config.url.endsWith('/find/tt0000009')) {
    data = { tv_results: [{ id: 9 }] };
  } else if (config.url.endsWith('/combined_credits')) {
    data = { cast: [
      { id: 911430, media_type: 'movie', title: 'F1', release_date: '2025-06-25' },
      { id: 911430, media_type: 'movie', title: 'F1 duplicate' },
      { id: 9, media_type: 'tv', name: 'A series' },
      { id: 10, media_type: 'movie', title: 'Unavailable' },
      { id: 11, media_type: 'tv', name: 'Talk show', genre_ids: [10767] },
      { id: 12, media_type: 'tv', name: 'News', genre_ids: [10763] },
      { id: 13, media_type: 'movie', title: 'Archive', character: 'Himself (archive footage)' },
      { id: 14, media_type: 'movie', title: 'Honorary', character: 'Self' }
    ], crew: [
      { id: 14, media_type: 'movie', title: 'Actual work', job: 'Director' },
      { id: 15, media_type: 'movie', title: 'Thanks only', job: 'Special Thanks' }
    ] };
  } else if (config.url.endsWith('/person/287')) {
    data = { id: 287, name: 'Brad Pitt', biography: 'Biography', birthday: '1963-12-18', place_of_birth: 'Shawnee', external_ids: { imdb_id: 'nm0000093' } };
  } else {
    active++;
    peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 5));
    active--;
    if (config.url.endsWith('/movie/10')) throw new Error('Unavailable fixture');
    const tv = config.url.includes('/tv/');
    const id = Number(config.url.split('/').pop());
    data = { id, title: 'F1', name: 'A series',
      overview: 'Full synopsis', release_date: '2025-06-25', runtime: 155,
      poster_path: '/poster.jpg', backdrop_path: '/background.jpg',
      genres: [{ name: 'Drama' }], external_ids: { imdb_id: tv ? 'tt0000009' : id === 911430 ? 'tt16311594' : null },
      credits: { cast: [{ name: 'Brad Pitt' }], crew: [{ job: 'Director', name: 'Joseph Kosinski' }] }
    };
  }
  return { data, status: 200, statusText: 'OK', headers: {}, config };
};
const [person, samePerson] = await Promise.all([getPersonMeta('person:287'), getPersonMeta('person:287')]);
assert.strictEqual(person, samePerson);
const initialRequests = requests;
assert.strictEqual(await getPersonMeta('person:287'), person);
assert.equal(requests, initialRequests, 'warm profiles must not repeat title requests');
assert.equal(person.credits.length, 4);
const movie = person.credits.find(c => c.id === 'tt16311594');
assert.ok(movie);
assert.equal(movie.description, 'Full synopsis');
assert.equal(movie.runtime, '155 min');
assert.deepEqual(movie.cast, ['Brad Pitt']);
assert.deepEqual(movie.director, ['Joseph Kosinski']);
assert.equal(movie.ids.imdb, movie.id);
assert.equal(movie.behaviorHints.defaultVideoId, 'tt16311594');
assert.equal(person.credits.find(c => c.type === 'series').behaviorHints, undefined);
assert.equal(movie.ids.tmdb, '911430');
assert.equal(movie._tmdb, undefined);
assert.ok(person.credits.some(c => c.id === 'tt0000009' && c.type === 'series'));
assert.ok(person.credits.some(c => c.id === 'tmdb:movie:10'));
assert.ok(peak <= 6);
console.log('Person filmography regression test passed');

for (const raw of ['0', '-1', '1.5', '1e3', 'person:1e3', 'person:287junk', 'tmdb:movie:287', '9007199254740992']) {
  assert.equal(parsePersonId(raw), null, raw);
  assert.equal(await getPersonMeta(raw), null);
}
assert.ok(person.credits.some(c => c.id === 'tmdb:movie:14'), 'real crew credit survives excluded cast credit');
assert.equal(person.credits.some(c => ['12', '13', '15'].includes(c.id.split(':').pop())), false);
const canonical = await getPersonMeta('tmdb:287');
assert.equal(canonical.id, 'tmdb:287');
assert.equal(person.id, 'person:287');
assert.strictEqual(canonical.credits, person.credits);
assert.equal(canonical.birthday, '1963-12-18');
assert.equal(canonical.birthPlace, 'Shawnee');
assert.deepEqual(canonical.ids, { tmdb: '287', imdb: 'nm0000093' });

const { app } = await import('../server.js');
const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
async function get(path) {
  const response = await fetch(base + path);
  assert.equal(response.status, 200, path);
  return response.json();
}
try {
  const manifest = await get('/manifest.json');
  assert.deepEqual(manifest.catalogs.map(c => [c.type, c.id]), [
    ['person', 'csfd-people'],
    ['movie', 'csfd-person-movies'], ['series', 'csfd-person-series'],
    ['movie', 'csfd-person-creator-movies'], ['series', 'csfd-person-creator-series'],
    ['movie', 'csfd-person-upcoming-movies'], ['series', 'csfd-person-upcoming-series'],
    ['movie', 'csfd-person-special-movies'], ['series', 'csfd-person-documentary-series']
  ]);
  const catalog = manifest.catalogs.find(c => c.type === 'person');
  assert.ok(catalog.extra.some(e => e.name === 'search' && e.isRequired));
  for (const path of [
    `/catalog/person/${catalog.id}/search=Brad%20Pitt.json`,
    `/catalog/person/${catalog.id}.json?search=Brad%20Pitt`
  ]) {
    const { metas } = await get(path);
    assert.equal(metas[0].id, 'tmdb:287');
    const { meta } = await get(`/meta/person/${metas[0].id}.json`);
    assert.equal(meta.id, metas[0].id);
    assert.equal(meta.type, 'person');
    assert.equal(meta.description.includes('Biography'), true);
    assert.equal(meta.credits.length, 4);
    for (const id of ['tt16311594', 'tt0000009', 'tmdb:movie:14']) {
      const title = meta.credits.find(c => c.id === id);
      assert.ok(title, id);
      const detail = (await get(`/meta/${title.type}/${title.id}.json`)).meta;
      assert.equal(detail.id, title.id);
      assert.equal(detail.type, title.type);
    }
  }
  assert.equal((await get('/meta/person/person:287.json')).meta.id, 'person:287');
  assert.equal((await get('/meta/person/tmdb:movie:287.json')).meta, null);
  assert.deepEqual((await get('/catalog/person/csfd-people.json')).metas, []);
  assert.deepEqual((await get('/catalog/person/unknown/search=Brad.json')).metas, []);
  assert.equal((await get('/meta/movie/tmdb:series:9.json')).meta, null);
  assert.equal((await get('/people/person:287.json')).person.id, 'person:287');
  console.log('AIOStreams people HTTP contract passed');
} finally {
  await new Promise(resolve => server.close(resolve));
}
