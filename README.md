# ČSFD Discovery – Stremio addon

Stremio discovery addon for movies and series with:

- search by title,
- search by actor/actress (`herec:`, `herečka:`),
- search by director (`režisér:` / `reziser:`),
- automatic person detection for queries such as `Tom Hanks`,
- TMDB -> IMDb matching so other Stremio stream addons can recognize the selected title,
- ČSFD metadata enrichment on the detail page,
- movie and series discovery catalogs,
- `skip` pagination with 100-item Stremio pages,
- genre filtering,
- CZ/SK discovery catalogs,
- Render deployment blueprint.

## Search examples

```text
Tom Hanks
herec: Brad Pitt
herečka: Nicole Kidman
režisér: Christopher Nolan
reziser: Denis Villeneuve
osoba: Quentin Tarantino
```

An exact person-name match is treated as a creator/person search. Otherwise title search has priority, with a person-search fallback.

## Catalogs

### Movies

- 🔎 ČSFD Discovery – Hľadať film / herca / režiséra
- 🔥 Discovery – Populárne filmy
- ⭐ Discovery – Najlepšie hodnotené filmy
- 🆕 Discovery – Nové filmy
- 🇨🇿🇸🇰 Discovery – CZ/SK filmy

### Series

- 🔎 ČSFD Discovery – Hľadať seriál / herca / režiséra
- 🔥 Discovery – Populárne seriály
- ⭐ Discovery – Najlepšie hodnotené seriály
- 🆕 Discovery – Nové seriály
- 🇨🇿🇸🇰 Discovery – CZ/SK seriály

Browse catalogs support Stremio `skip` pagination and genre filtering.

## Data flow

```text
Stremio search/catalog
        |
        v
TMDB title/person discovery
        |
        v
TMDB external IDs
        |
        +----> IMDb ID returned to Stremio whenever available
        |
        v
Stremio detail request
        |
        +----> TMDB metadata
        |
        +----> ČSFD title match + rating / creators / link
```

The addon deliberately keeps ČSFD enrichment non-fatal. If ČSFD changes markup or temporarily rejects a request, the TMDB/IMDb result still works.

## Environment

Copy `.env.example` to `.env` and configure either a TMDB v3 API key or a v4 read token:

```bash
TMDB_API_KEY=your_key_here
# or
TMDB_READ_ACCESS_TOKEN=your_read_token_here
```

Do not commit credentials.

## Local run

```bash
npm install
cp .env.example .env
# add your TMDB key/token to .env
npm start
```

Default local URL:

```text
http://127.0.0.1:10000
```

Manifest:

```text
http://127.0.0.1:10000/manifest.json
```

## Render

The repository contains `render.yaml`.

1. Create a new Render Blueprint/Web Service from this repository.
2. Set `TMDB_API_KEY` in Render environment variables.
3. Deploy.
4. Open `https://YOUR-SERVICE.onrender.com/health` and confirm `tmdbConfigured: true`.
5. Install `https://YOUR-SERVICE.onrender.com/manifest.json` in Stremio/Nuvio.

## Diagnostics

- `/health` – service and TMDB configuration status
- `/stats` – in-memory cache stats
- `/debug/search?type=movie&q=Tom%20Hanks` – debug person/title search

## Notes

The browse catalogs use TMDB as the stable discovery/indexing source. ČSFD is used to enrich detail metadata (rating, creators, ČSFD link) and is cached/rate-limited through the addon cache layer. The next planned step is a dedicated ČSFD chart/catalog parser for native ČSFD rankings.
