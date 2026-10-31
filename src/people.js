import { imageUrl, personCredits, personDetails, searchPerson } from './tmdb.js';

function normalize(value = '') {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function personSearchMeta(person) {
  const knownFor = (person.known_for || [])
    .map(item => item.title || item.name)
    .filter(Boolean)
    .slice(0, 4);

  return {
    id: `person:${person.id}`,
    type: 'person',
    name: person.name || 'Neznáma osoba',
    poster: imageUrl(person.profile_path, 'w500'),
    posterShape: 'poster',
    description: [person.known_for_department, knownFor.length ? `Známy/a z: ${knownFor.join(', ')}` : '']
      .filter(Boolean)
      .join('\n'),
    behaviorHints: {
      nuvioPerson: true,
      tmdbPersonId: person.id
    }
  };
}

export async function searchPeople(query, limit = 20) {
  const people = await searchPerson(query);
  const exact = people.filter(p => normalize(p.name) === normalize(query));
  const rest = people.filter(p => normalize(p.name) !== normalize(query));
  return [...exact, ...rest].slice(0, limit).map(personSearchMeta);
}

function uniqueCredits(credits) {
  const seen = new Set();
  return [...(credits.cast || []), ...(credits.crew || [])]
    .filter(item => item.media_type === 'movie' || item.media_type === 'tv')
    .filter(item => {
      const key = `${item.media_type}:${item.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => {
      const dateA = Date.parse(a.release_date || a.first_air_date || '') || 0;
      const dateB = Date.parse(b.release_date || b.first_air_date || '') || 0;
      if (dateA !== dateB) return dateB - dateA;
      return (b.popularity || 0) - (a.popularity || 0);
    });
}

function countCredits(credits) {
  const unique = list => new Set(list.map(item => `${item.media_type}:${item.id}`)).size;
  const acting = credits.cast || [];
  const directing = (credits.crew || []).filter(item => String(item.job || '').toLowerCase() === 'director');
  const writing = (credits.crew || []).filter(item => ['writer', 'screenplay', 'story', 'teleplay'].includes(String(item.job || '').toLowerCase()));
  return {
    actingMovies: unique(acting.filter(x => x.media_type === 'movie')),
    actingSeries: unique(acting.filter(x => x.media_type === 'tv')),
    directingMovies: unique(directing.filter(x => x.media_type === 'movie')),
    directingSeries: unique(directing.filter(x => x.media_type === 'tv')),
    writingMovies: unique(writing.filter(x => x.media_type === 'movie')),
    writingSeries: unique(writing.filter(x => x.media_type === 'tv'))
  };
}

function nestedFilmography(credits, limit = 80) {
  let movieEpisode = 0;
  let seriesEpisode = 0;

  return uniqueCredits(credits)
    .slice(0, limit)
    .map(item => {
      const type = item.media_type === 'tv' ? 'series' : 'movie';
      const isMovie = type === 'movie';
      const name = item.title || item.name || item.original_title || item.original_name || 'Bez názvu';
      const released = item.release_date || item.first_air_date || null;
      const role = item.character || item.job || null;
      const episode = isMovie ? ++movieEpisode : ++seriesEpisode;
      const overview = [
        role ? `${item.character ? 'Postava' : 'Úloha'}: ${role}` : null,
        item.overview || null
      ].filter(Boolean).join('\n\n');

      return {
        id: `filmography:${type}:${item.id}`,
        name: `${isMovie ? '🎬' : '📺'} ${name}`,
        title: name,
        released: released || undefined,
        thumbnail: imageUrl(item.backdrop_path || item.poster_path, 'w780'),
        overview: overview || undefined,
        description: overview || undefined,
        rating: Number.isFinite(Number(item.vote_average)) && Number(item.vote_average) > 0
          ? Number(item.vote_average).toFixed(1)
          : undefined,
        // NuvioTV treats any meta with videos as series-like. Season 1 is movies,
        // season 2 is TV, which keeps the nested People filmography easy to browse.
        season: isMovie ? 1 : 2,
        episode,
        number: episode,
        available: true,
        streams: [
          {
            name: 'Filmografia',
            title: '▶ Otvoriť normálny detail a všetky zdroje',
            description: `Otvorí ${isMovie ? 'film' : 'seriál'} v bežnom Nuvio detaile, kde sa načítajú všetky nainštalované stream addony.`,
            externalUrl: `nuvio://tmdb/${type}/${item.id}`
          }
        ]
      };
    });
}

export async function getPersonMeta(rawId) {
  const id = Number(String(rawId).replace(/^person:/, ''));
  if (!Number.isFinite(id) || id <= 0) return null;

  const [person, credits] = await Promise.all([personDetails(id), personCredits(id)]);
  const counts = countCredits(credits);
  const roles = [];
  if (counts.actingMovies || counts.actingSeries) roles.push('Herectvo');
  if (counts.directingMovies || counts.directingSeries) roles.push('Réžia');
  if (counts.writingMovies || counts.writingSeries) roles.push('Scenár');

  const lines = [];
  if (person.biography) lines.push(person.biography);
  const stats = [
    counts.actingMovies ? `Filmy (herectvo): ${counts.actingMovies}` : null,
    counts.actingSeries ? `Seriály (herectvo): ${counts.actingSeries}` : null,
    counts.directingMovies ? `Filmy (réžia): ${counts.directingMovies}` : null,
    counts.directingSeries ? `Seriály (réžia): ${counts.directingSeries}` : null,
    counts.writingMovies ? `Filmy (scenár): ${counts.writingMovies}` : null,
    counts.writingSeries ? `Seriály (scenár): ${counts.writingSeries}` : null
  ].filter(Boolean);
  if (stats.length) lines.push(stats.join(' • '));
  lines.push('Vnorená filmografia je nižšie: sezóna 1 = filmy, sezóna 2 = seriály. Pri titule vyber „▶ Otvoriť normálny detail a všetky zdroje“. Pre priamy prístup ostávajú aj katalógy „🎬 Filmografia – filmy“ a „📺 Filmografia – seriály“.');

  const personName = person.name || 'Neznáma osoba';
  const personPhoto = imageUrl(person.profile_path, 'w500');
  const videos = nestedFilmography(credits);

  return {
    id: `person:${person.id}`,
    type: 'person',
    name: personName,
    poster: personPhoto,
    background: imageUrl(person.profile_path, 'h632'),
    posterShape: 'poster',
    description: lines.join('\n\n'),
    releaseInfo: person.birthday || undefined,
    genres: roles,
    videos,
    links: [
      { name: 'TMDB', category: 'tmdb', url: `https://www.themoviedb.org/person/${person.id}` }
    ],
    behaviorHints: {
      nuvioPerson: true,
      tmdbPersonId: person.id,
      knownForDepartment: person.known_for_department || null,
      placeOfBirth: person.place_of_birth || null,
      birthday: person.birthday || null,
      deathday: person.deathday || null,
      creditCounts: counts,
      nestedFilmography: true,
      nestedFilmographySeasons: { movies: 1, series: 2 }
    }
  };
}

export async function getPersonCredits(rawId) {
  const id = Number(String(rawId).replace(/^person:/, ''));
  if (!Number.isFinite(id) || id <= 0) return [];
  const credits = await personCredits(id);

  return uniqueCredits(credits).map(item => ({
    tmdbId: item.id,
    type: item.media_type === 'tv' ? 'series' : 'movie',
    name: item.title || item.name || item.original_title || item.original_name || 'Bez názvu',
    poster: imageUrl(item.poster_path, 'w500'),
    background: imageUrl(item.backdrop_path, 'w780'),
    year: String(item.release_date || item.first_air_date || '').slice(0, 4) || null,
    character: item.character || null,
    job: item.job || null,
    popularity: item.popularity || 0
  }));
}
