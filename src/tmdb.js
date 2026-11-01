import axios from 'axios';
import { cached } from './cache.js';

const TMDB_BASE = 'https://api.themoviedb.org/3';
const IMAGE_BASE = 'https://image.tmdb.org/t/p';
const API_KEY = process.env.TMDB_API_KEY || '';
const TOKEN = process.env.TMDB_READ_ACCESS_TOKEN || '';

function ensureConfigured() {
  if (!API_KEY && !TOKEN) throw new Error('TMDB is not configured. Set TMDB_API_KEY or TMDB_READ_ACCESS_TOKEN.');
}
async function tmdb(path, params = {}, ttlMs = 10 * 60 * 1000) {
  ensureConfigured(); const key = `tmdb:${path}:${JSON.stringify(params)}`;
  return cached(key, ttlMs, async () => { const headers = TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}; const requestParams = API_KEY ? { ...params, api_key: API_KEY } : params; const { data } = await axios.get(`${TMDB_BASE}${path}`, { params: requestParams, headers, timeout: 12000 }); return data; });
}
export async function probeTmdb() { try { await tmdb('/configuration', {}, 5 * 60 * 1000); return { ok: true }; } catch (error) { const status = error.response?.status || null; const message = error.response?.data?.status_message || error.message || 'TMDB request failed'; return { ok: false, status, message }; } }
export function imageUrl(path, size = 'w500') { return path ? `${IMAGE_BASE}/${size}${path}` : null; }
export async function searchPerson(query) { const data = await tmdb('/search/person', { query, language: 'cs-CZ', include_adult: false }, 6 * 60 * 60 * 1000); return data.results || []; }
export async function searchPersonNgram(query) { const data = await tmdb('/search/person', { query, language: 'cs-CZ', include_adult: false, search_type: 'ngram' }, 6 * 60 * 60 * 1000); return data.results || []; }
export async function personDetails(personId) { return tmdb(`/person/${personId}`, { language: 'cs-CZ', append_to_response: 'external_ids,images' }, 24 * 60 * 60 * 1000); }
export async function searchTitles(query, type) { const endpoint = type === 'series' ? '/search/tv' : '/search/movie'; const data = await tmdb(endpoint, { query, language: 'cs-CZ', include_adult: false }, 30 * 60 * 1000); return data.results || []; }
export async function personCredits(personId) { return tmdb(`/person/${personId}/combined_credits`, { language: 'cs-CZ' }, 24 * 60 * 60 * 1000); }
export async function details(type, id) { const endpoint = type === 'series' ? `/tv/${id}` : `/movie/${id}`; return tmdb(endpoint, { language: 'cs-CZ', append_to_response: 'external_ids,credits' }, 24 * 60 * 60 * 1000); }
export async function findByImdb(imdbId) { return tmdb(`/find/${imdbId}`, { external_source: 'imdb_id', language: 'cs-CZ' }, 24 * 60 * 60 * 1000); }
export async function discover(type, { mode = 'popular', genreId = null, page = 1, language = null } = {}) { const endpoint = type === 'series' ? '/discover/tv' : '/discover/movie'; const year = new Date().getUTCFullYear(); const params = { language: 'cs-CZ', page, include_adult: false }; if (mode === 'top') { params.sort_by = 'vote_average.desc'; params['vote_count.gte'] = type === 'series' ? 300 : 1000; } else if (mode === 'new') { params.sort_by = type === 'series' ? 'first_air_date.desc' : 'primary_release_date.desc'; if (type === 'series') params['first_air_date.gte'] = `${year - 1}-01-01`; else params['primary_release_date.gte'] = `${year - 1}-01-01`; } else params.sort_by = 'popularity.desc'; if (genreId) params.with_genres = genreId; if (language) params.with_original_language = language; const data = await tmdb(endpoint, params, 3 * 60 * 60 * 1000); return data.results || []; }
export async function resolveTmdbItemToStremioMeta(item, fallbackType) { const type = item.media_type === 'tv' || fallbackType === 'series' ? 'series' : 'movie'; const data = await details(type, item.id); const imdbId = data.external_ids?.imdb_id || null; const title = type === 'series' ? data.name : data.title; const originalTitle = type === 'series' ? data.original_name : data.original_title; const date = type === 'series' ? data.first_air_date : data.release_date; const year = date ? String(date).slice(0, 4) : undefined; const genres = (data.genres || []).map(g => g.name).filter(Boolean); return { id: imdbId || `tmdb:${type}:${data.id}`, type, name: title || originalTitle || 'Bez názvu', poster: imageUrl(data.poster_path, 'w500'), background: imageUrl(data.backdrop_path, 'w1280'), description: data.overview || '', releaseInfo: year, year: year ? Number(year) : undefined, genres, imdbRating: data.vote_average ? Number(data.vote_average).toFixed(1) : undefined, _tmdb: { id: data.id, imdbId, originalTitle, cast: (data.credits?.cast || []).slice(0, 12).map(p => p.name), directors: (data.credits?.crew || []).filter(p => p.job === 'Director').map(p => p.name) } }; }
