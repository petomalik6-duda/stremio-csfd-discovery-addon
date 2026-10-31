import { enrichFromCsfd } from './csfd.js';
import { details, findByImdb, resolveTmdbItemToStremioMeta } from './tmdb.js';

function publicMeta(meta) {
  if (!meta) return null;
  const { _tmdb, ...clean } = meta;
  return Object.fromEntries(Object.entries(clean).filter(([, v]) => v !== undefined && v !== null));
}

function appendCsfd(meta, csfd) {
  if (!csfd) return publicMeta(meta);
  const ratingLine = csfd.rating != null ? `ČSFD: ${csfd.rating} %` : null;
  const directors = csfd.directors?.length ? `Režie: ${csfd.directors.join(', ')}` : null;
  const actors = csfd.actors?.length ? `Hrají: ${csfd.actors.slice(0, 10).join(', ')}` : null;
  const prefix = [ratingLine, directors, actors].filter(Boolean).join('\n');
  const description = [prefix, meta.description || csfd.description || ''].filter(Boolean).join('\n\n');

  return publicMeta({
    ...meta,
    description,
    poster: meta.poster || csfd.poster,
    imdbRating: csfd.rating != null ? (csfd.rating / 10).toFixed(1) : meta.imdbRating,
    links: csfd.url ? [{ name: 'ČSFD', category: 'csfd', url: csfd.url }] : undefined
  });
}

async function fromTmdb(type, id) {
  const data = await details(type, id);
  return resolveTmdbItemToStremioMeta({ id: data.id }, type);
}

export async function getMetaById(type, id) {
  let meta = null;

  if (/^tt\d+$/.test(id)) {
    const found = await findByImdb(id);
    const row = type === 'series' ? found.tv_results?.[0] : found.movie_results?.[0];
    if (!row) return null;
    meta = await resolveTmdbItemToStremioMeta(row, type);
  } else {
    const m = id.match(/^tmdb:(movie|series):(\d+)$/);
    if (!m) return null;
    if (m[1] !== type) return null;
    meta = await fromTmdb(type, Number(m[2]));
  }

  if (!meta) return null;
  const title = meta.name || meta._tmdb?.originalTitle;
  const year = meta.year || (meta.releaseInfo ? Number(String(meta.releaseInfo).slice(0, 4)) : undefined);
  const csfd = await enrichFromCsfd(title, year);
  return appendCsfd(meta, csfd);
}

export function toPublicMeta(meta) {
  return publicMeta(meta);
}
