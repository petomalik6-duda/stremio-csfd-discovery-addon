import { imageUrl, personCredits, personDetails } from './tmdb.js';
import { searchPeopleFuzzy } from './discovery.js';

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
      tmdbPersonId: person.id,
      richPersonProfile: true
    }
  };
}

export async function searchPeople(query, limit = 20) {
  const people = await searchPeopleFuzzy(query, limit);
  return people.map(personSearchMeta);
}

function creditDate(item) {
  return Date.parse(item.release_date || item.first_air_date || '') || 0;
}

function creditTitle(item) {
  return item.title || item.name || item.original_title || item.original_name || 'Bez názvu';
}

function creditYear(item) {
  return String(item.release_date || item.first_air_date || '').slice(0, 4) || null;
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
    });
}

function sortedCredits(credits) {
  return uniqueCredits(credits).sort((a, b) => {
    const dateDiff = creditDate(b) - creditDate(a);
    if (dateDiff !== 0) return dateDiff;
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

function formatDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return value || null;
  return `${Number(match[3])}. ${Number(match[2])}. ${match[1]}`;
}

function roleSummary(counts) {
  const roles = [];
  if (counts.actingMovies || counts.actingSeries) roles.push('Herectvo');
  if (counts.directingMovies || counts.directingSeries) roles.push('Réžia');
  if (counts.writingMovies || counts.writingSeries) roles.push('Scenár');
  return roles;
}

function statsSummary(counts) {
  return [
    counts.actingMovies ? `Filmy – herectvo: ${counts.actingMovies}` : null,
    counts.actingSeries ? `Seriály – herectvo: ${counts.actingSeries}` : null,
    counts.directingMovies ? `Filmy – réžia: ${counts.directingMovies}` : null,
    counts.directingSeries ? `Seriály – réžia: ${counts.directingSeries}` : null,
    counts.writingMovies ? `Filmy – scenár: ${counts.writingMovies}` : null,
    counts.writingSeries ? `Seriály – scenár: ${counts.writingSeries}` : null
  ].filter(Boolean);
}

export async function getPersonMeta(rawId) {
  const id = Number(String(rawId).replace(/^person:/, ''));
  if (!Number.isFinite(id) || id <= 0) return null;

  const [person, credits] = await Promise.all([personDetails(id), personCredits(id)]);
  const counts = countCredits(credits);
  const roles = roleSummary(counts);
  const stats = statsSummary(counts);

  const identity = [
    person.birthday ? `Narodenie: ${formatDate(person.birthday)}` : null,
    person.deathday ? `Úmrtie: ${formatDate(person.deathday)}` : null,
    person.place_of_birth ? `Miesto narodenia: ${person.place_of_birth}` : null,
    person.known_for_department ? `Hlavná profesia: ${person.known_for_department}` : null
  ].filter(Boolean);

  const sections = [];
  if (person.biography) sections.push(`BIOGRAFIA\n${person.biography}`);
  if (identity.length) sections.push(`ZÁKLADNÉ ÚDAJE\n${identity.join('\n')}`);
  if (roles.length) sections.push(`PROFESIE\n${roles.join(' • ')}`);
  if (stats.length) sections.push(`FILMOGRAFIA\n${stats.join(' • ')}`);
  sections.push('Plagátovú filmografiu nájdeš v katalógoch addonu: Populárne, Filmy, Seriály, Réžia/produkcia a Pripravované.');

  const personName = person.name || 'Neznáma osoba';
  const personPhoto = imageUrl(person.profile_path, 'w500');
  const imdbPersonId = person.external_ids?.imdb_id || null;
  const links = [
    { name: 'TMDB', category: 'tmdb', url: `https://www.themoviedb.org/person/${person.id}` },
    imdbPersonId ? { name: 'IMDb', category: 'imdb', url: `https://www.imdb.com/name/${imdbPersonId}/` } : null,
    person.homepage ? { name: 'Oficiálna stránka', category: 'website', url: person.homepage } : null
  ].filter(Boolean);

  return {
    id: `person:${person.id}`,
    type: 'person',
    name: personName,
    poster: personPhoto,
    background: imageUrl(person.profile_path, 'h632'),
    posterShape: 'poster',
    description: sections.join('\n\n'),
    releaseInfo: person.birthday ? String(person.birthday).slice(0, 4) : undefined,
    genres: roles,
    country: person.place_of_birth || undefined,
    website: person.homepage || undefined,
    links,
    app_extras: {
      person: {
        tmdbId: person.id,
        imdbId: imdbPersonId,
        birthday: person.birthday || null,
        deathday: person.deathday || null,
        placeOfBirth: person.place_of_birth || null,
        knownForDepartment: person.known_for_department || null,
        creditCounts: counts
      }
    },
    behaviorHints: {
      nuvioPerson: true,
      tmdbPersonId: person.id,
      richPersonProfile: true,
      knownForDepartment: person.known_for_department || null,
      placeOfBirth: person.place_of_birth || null,
      birthday: person.birthday || null,
      deathday: person.deathday || null,
      creditCounts: counts,
      filmographyCatalogsOnly: true
    }
  };
}

export async function getPersonCredits(rawId) {
  const id = Number(String(rawId).replace(/^person:/, ''));
  if (!Number.isFinite(id) || id <= 0) return [];
  const credits = await personCredits(id);

  return sortedCredits(credits).map(item => ({
    tmdbId: item.id,
    type: item.media_type === 'tv' ? 'series' : 'movie',
    name: creditTitle(item),
    poster: imageUrl(item.poster_path, 'w500'),
    background: imageUrl(item.backdrop_path, 'w780'),
    year: creditYear(item),
    character: item.character || null,
    job: item.job || null,
    popularity: item.popularity || 0
  }));
}
