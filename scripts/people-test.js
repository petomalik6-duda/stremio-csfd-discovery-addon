import assert from 'node:assert/strict';
import axios from 'axios';

process.env.TMDB_API_KEY = 'test-only';
const { getPersonMeta } = await import('../src/people.js');
let active = 0;
let peak = 0;
axios.defaults.adapter = async config => {
  let data;
  if (config.url.endsWith('/combined_credits')) {
    data = { cast: [
      { id: 911430, media_type: 'movie', title: 'F1', release_date: '2025-06-25' },
      { id: 911430, media_type: 'movie', title: 'F1 duplicate' },
      { id: 9, media_type: 'tv', name: 'A series' },
      { id: 10, media_type: 'movie', title: 'Unavailable' },
      { id: 11, media_type: 'tv', name: 'Talk show', genre_ids: [10767] }
    ], crew: [] };
  } else if (config.url.endsWith('/person/287')) {
    data = { id: 287, name: 'Brad Pitt', external_ids: {} };
  } else {
    active++;
    peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 5));
    active--;
    if (config.url.endsWith('/movie/10')) throw new Error('Unavailable fixture');
    const tv = config.url.includes('/tv/');
    data = { id: tv ? 9 : 911430, title: 'F1', name: 'A series',
      overview: 'Full synopsis', release_date: '2025-06-25', runtime: 155,
      poster_path: '/poster.jpg', backdrop_path: '/background.jpg',
      genres: [{ name: 'Drama' }], external_ids: { imdb_id: tv ? 'tt0000009' : 'tt16311594' },
      credits: { cast: [{ name: 'Brad Pitt' }], crew: [{ job: 'Director', name: 'Joseph Kosinski' }] }
    };
  }
  return { data, status: 200, statusText: 'OK', headers: {}, config };
};
const person = await getPersonMeta('person:287');
assert.equal(person.credits.length, 3);
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
