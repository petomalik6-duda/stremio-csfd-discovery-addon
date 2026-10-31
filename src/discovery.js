import { discover, personCredits, resolveTmdbItemToStremioMeta, searchPerson, searchTitles } from './tmdb.js';

const GENRES = {
  Akční: { movie: 28, series: 10759 }, Dobrodružný: { movie: 12, series: 10759 }, Animovaný: { movie: 16, series: 16 },
  Komedie: { movie: 35, series: 35 }, Krimi: { movie: 80, series: 80 }, Dokumentární: { movie: 99, series: 99 },
  Drama: { movie: 18, series: 18 }, Rodinný: { movie: 10751, series: 10751 }, Fantasy: { movie: 14, series: 10765 },
  Historický: { movie: 36, series: 18 }, Horor: { movie: 27, series: 9648 }, Hudební: { movie: 10402, series: 10767 },
  Mysteriózní: { movie: 9648, series: 9648 }, Romantický: { movie: 10749, series: 18 }, 'Sci-Fi': { movie: 878, series: 10765 },
  Thriller: { movie: 53, series: 9648 }, Válečný: { movie: 10752, series: 10768 }, Western: { movie: 37, series: 37 }
};
export const genreNames = Object.keys(GENRES);

function stripPrefix(query = '') {
  const raw = String(query).trim();
  const patterns = [
    { re: /^(herec|herečka|herecka|actor|actress)\s*:\s*/i, role: 'actor' },
    { re: /^(režisér|reziser|režiser|director)\s*:\s*/i, role: 'director' },
    { re: /^(scenárista|scenarista|writer)\s*:\s*/i, role: 'writer' },
    { re: /^(osoba|person)\s*:\s*/i, role: 'person' }
  ];
  for (const p of patterns) if (p.re.test(raw)) return { query: raw.replace(p.re, '').trim(), role: p.role };
  return { query: raw, role: 'auto' };
}
function normalize(s = '') { return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9\s]/g, ' ').replace(/\s+/g, ' ').toLowerCase().trim(); }
function creditMatchesType(c, type) { return type === 'series' ? c.media_type === 'tv' : c.media_type === 'movie'; }
function creditDate(c) { return Date.parse((c.media_type === 'tv' ? c.first_air_date : c.release_date) || '') || 0; }
function pickPersonCredits(credits, role, type) {
  const rows = [];
  if (role === 'actor' || role === 'person' || role === 'auto') for (const c of credits.cast || []) if (creditMatchesType(c, type)) rows.push(c);
  if (role === 'director' || role === 'person' || role === 'auto') for (const c of credits.crew || []) if (creditMatchesType(c, type) && c.job === 'Director') rows.push(c);
  if (role === 'writer' || role === 'person' || role === 'auto') for (const c of credits.crew || []) if (creditMatchesType(c, type) && ['Writer', 'Screenplay', 'Story'].includes(c.job)) rows.push(c);
  const map = new Map(); for (const row of rows) if (!map.has(`${row.media_type}:${row.id}`)) map.set(`${row.media_type}:${row.id}`, row);
  return [...map.values()].sort((a,b) => creditDate(b)-creditDate(a) || (b.popularity||0)-(a.popularity||0));
}
async function mapLimited(items, limit, mapper) {
  const out = new Array(items.length); let index = 0;
  async function worker(){ while(true){ const i=index++; if(i>=items.length)return; try{out[i]=await mapper(items[i],i);}catch(e){console.warn('[resolver]',e.message);out[i]=null;} } }
  await Promise.all(Array.from({length:Math.min(limit,items.length)},worker)); return out.filter(Boolean);
}
function bestPersonMatch(people, query) {
  if(!people?.length)return null; const q=normalize(query); const exact=people.find(p=>normalize(p.name)===q); if(exact)return {person:exact,strong:true};
  const top=people[0], n=normalize(top.name), qp=q.split(' ').filter(Boolean), np=n.split(' ').filter(Boolean), common=qp.filter(x=>np.includes(x)).length, overlap=qp.length?common/qp.length:0;
  return {person:top,strong:(q.length>=4&&(n.includes(q)||q.includes(n)))||overlap>=0.75};
}
async function personSearch(query, role, type, limit, offset=0) {
  const people=await searchPerson(query); if(!people.length)return []; const person=(bestPersonMatch(people,query)?.person)||people[0]; const credits=await personCredits(person.id);
  const effectiveLimit=Math.min(Math.max(1,Number(limit)||20),50), effectiveOffset=Math.max(0,Number(offset)||0);
  const selected=pickPersonCredits(credits,role,type).slice(effectiveOffset,effectiveOffset+effectiveLimit);
  return mapLimited(selected,12,item=>resolveTmdbItemToStremioMeta(item,type));
}
async function titleSearch(query,type,limit){const effectiveLimit=Math.min(Math.max(1,limit||20),20);const titles=(await searchTitles(query,type)).slice(0,effectiveLimit);return mapLimited(titles,12,item=>resolveTmdbItemToStremioMeta(item,type));}

export async function searchFilmography(rawQuery,type,limit=20,offset=0){
  const parsed=stripPrefix(rawQuery); if(!parsed.query)return [];
  // Filmography rows are acting filmography. Crew/director/writer credits must not leak into actor filmography.
  // Explicit role prefixes remain supported for debug/special searches.
  const role = parsed.role === 'auto' || parsed.role === 'person' ? 'actor' : parsed.role;
  return personSearch(parsed.query,role,type,limit,offset);
}
export async function searchTitlesDiscovery(rawQuery,type,limit=20){const parsed=stripPrefix(rawQuery);if(!parsed.query)return [];return titleSearch(parsed.query,type,limit);}
export async function searchDiscovery(rawQuery,type,limit=20){const parsed=stripPrefix(rawQuery);if(!parsed.query)return [];if(parsed.role!=='auto')return personSearch(parsed.query,parsed.role,type,limit);const [people,titles]=await Promise.all([searchPerson(parsed.query),searchTitles(parsed.query,type)]);const pm=bestPersonMatch(people,parsed.query);if(pm?.strong){const r=await personSearch(parsed.query,'actor',type,limit);if(r.length)return r;}if(titles.length)return titleSearch(parsed.query,type,limit);if(people.length)return personSearch(parsed.query,'actor',type,limit);return [];}
async function loadFivePages(type,opts){const pages=await Promise.all([0,1,2,3,4].map(i=>discover(type,{...opts,page:opts.page+i})));return pages.flat();}
export async function getDiscoveryCatalog(type,catalogId,extra={}){const skip=Math.max(0,Number(extra.skip||0)),stremioPage=Math.floor(skip/100),tmdbStartPage=stremioPage*5+1,mode=catalogId.includes('top')?'top':catalogId.includes('new')?'new':'popular',genreId=extra.genre&&GENRES[extra.genre]?GENRES[extra.genre][type]:null;let rows;if(catalogId.includes('czsk')){const [cs,sk]=await Promise.all([loadFivePages(type,{mode,genreId,page:tmdbStartPage,language:'cs'}),loadFivePages(type,{mode,genreId,page:tmdbStartPage,language:'sk'})]);const map=new Map([...cs,...sk].map(x=>[x.id,x]));rows=[...map.values()].sort((a,b)=>(b.popularity||0)-(a.popularity||0));}else rows=await loadFivePages(type,{mode,genreId,page:tmdbStartPage});return mapLimited(rows.slice(0,100),10,item=>resolveTmdbItemToStremioMeta(item,type));}
