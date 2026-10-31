import axios from 'axios';
import * as cheerio from 'cheerio';
import { cached } from './cache.js';

const BASE = 'https://www.csfd.cz';
const UA = 'Mozilla/5.0 (compatible; CSFD-Discovery-Stremio/1.0; +https://github.com/petomalik6-duda/stremio-csfd-discovery-addon)';

function normalize(s = '') {
  return String(s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

async function getHtml(url, ttlMs) {
  return cached(`csfd:${url}`, ttlMs, async () => {
    const { data } = await axios.get(url, {
      timeout: 12000,
      headers: {
        'User-Agent': UA,
        'Accept-Language': 'cs-CZ,cs;q=0.9,sk;q=0.8,en;q=0.5'
      },
      maxRedirects: 4
    });
    return data;
  });
}

function parseJsonLd($) {
  const values = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text().trim();
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) values.push(...parsed);
      else if (parsed?.['@graph']) values.push(...parsed['@graph']);
      else values.push(parsed);
    } catch {
      // Ignore invalid structured data and use HTML fallbacks.
    }
  });
  return values;
}

function names(value) {
  if (!value) return [];
  const arr = Array.isArray(value) ? value : [value];
  return arr.map(v => typeof v === 'string' ? v : v?.name).filter(Boolean);
}

function normalizeRating(value) {
  const n = Number(String(value ?? '').replace(',', '.'));
  if (!Number.isFinite(n)) return null;
  if (n <= 10) return Math.round(n * 10);
  if (n <= 100) return Math.round(n);
  return null;
}

export async function searchCsfdTitle(title, year) {
  if (!title) return null;
  const url = `${BASE}/hledat/?q=${encodeURIComponent(title)}`;
  const html = await getHtml(url, 12 * 60 * 60 * 1000);
  const $ = cheerio.load(html);
  const candidates = [];

  $('a[href*="/film/"]').each((_, el) => {
    const href = $(el).attr('href');
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    if (!href || !text) return;
    const idMatch = href.match(/\/film\/(\d+)-/);
    if (!idMatch) return;

    const parentText = $(el).closest('article, li, .search-result, .box').text().replace(/\s+/g, ' ').trim();
    const yearMatch = parentText.match(/\b(19|20)\d{2}\b/);
    const foundYear = yearMatch ? Number(yearMatch[0]) : null;
    const a = normalize(text);
    const b = normalize(title);
    let score = a === b ? 100 : a.includes(b) || b.includes(a) ? 70 : 0;
    if (year && foundYear && Number(year) === foundYear) score += 25;

    candidates.push({
      id: Number(idMatch[1]),
      title: text,
      year: foundYear,
      url: new URL(href, BASE).toString(),
      score
    });
  });

  const deduped = [...new Map(candidates.map(x => [x.id, x])).values()];
  deduped.sort((a, b) => b.score - a.score);
  return deduped[0] || null;
}

export async function fetchCsfdDetail(url) {
  if (!url) return null;
  const html = await getHtml(url, 7 * 24 * 60 * 60 * 1000);
  const $ = cheerio.load(html);
  const jsonLd = parseJsonLd($);
  const movie = jsonLd.find(x => ['Movie', 'TVSeries', 'CreativeWork'].includes(x?.['@type'])) || {};
  const aggregate = movie.aggregateRating || {};
  const ogImage = $('meta[property="og:image"]').attr('content') || null;
  const h1 = $('h1').first().text().replace(/\s+/g, ' ').trim();

  let rating = normalizeRating(aggregate.ratingValue);
  if (rating == null) {
    const bodyText = $('body').text().replace(/\s+/g, ' ');
    const m = bodyText.match(/(\d{1,3})\s*%/);
    if (m) rating = Number(m[1]);
  }

  const date = movie.dateCreated || movie.datePublished || '';
  const yearMatch = String(date).match(/\b(19|20)\d{2}\b/);
  const description = movie.description || $('meta[name="description"]').attr('content') || '';

  return {
    url,
    name: movie.name || h1 || null,
    year: yearMatch ? Number(yearMatch[0]) : null,
    rating,
    ratingCount: aggregate.ratingCount ? Number(aggregate.ratingCount) : null,
    description,
    poster: movie.image?.url || movie.image || ogImage,
    directors: names(movie.director),
    actors: names(movie.actor),
    genres: Array.isArray(movie.genre) ? movie.genre : movie.genre ? [movie.genre] : []
  };
}

export async function enrichFromCsfd(title, year) {
  try {
    const match = await searchCsfdTitle(title, year);
    if (!match || match.score < 60) return null;
    const detail = await fetchCsfdDetail(match.url);
    return detail ? { ...detail, match } : null;
  } catch (error) {
    console.warn('[csfd] enrichment failed:', error.message);
    return null;
  }
}
