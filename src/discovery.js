import { personCredits, resolveTmdbItemToStremioMeta, searchPerson } from './tmdb.js';

function stripPrefix(query = '') {
  const raw = String(query).trim();
  const patterns = [
    { re: /^(herec|herečka|herecka|actor|actress)\s*:\s*/i, role: 'actor' },
    { re: /^(režisér|reziser|režiser|director)\s*:\s*/i, role: 'director' },
    { re: /^(producent|producer)\s*:\s*/i, role: 'producer' },
    { re: /^(scenárista|scenarista|writer)\s*:\s*/i, role: 'writer' },
    { re: /^(osoba|person)\s*:\s*/i, role: 'person' }
  ];
  for (const p of patterns) if (p.re.test(raw)) return { query: raw.replace(p.re, '').trim(), role: p.role };
  return { query: raw, role: 'auto' };
}
function normalize(s = '') { return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9\s]/g, ' ').replace(/\s+/g, ' ').toLowerCase().trim(); }
function creditDate(c) { return Date.parse((c.media_type === 'tv' ? c.first_air_date : c.release_date) || '') || 0; }
function pickPersonCredits(credits, role, type) {
  const rows = [];
  const mediaType = type === 'series' ? 'tv' : 'movie';
  if (role === 'actor' || role === 'person' || role === 'auto') for (const c of credits.cast || []) if (c.media_type === mediaType) rows.push(c);
  if (role === 'director') for (const c of credits.crew || []) if (c.media_type === mediaType && c.job === 'Director') rows.push(c);
  if (role === 'producer') for (const c of credits.crew || []) if (c.media_type === mediaType && ['Producer','Executive Producer','Co-Producer','Associate Producer'].includes(c.job)) rows.push(c);
  if (role === 'creator') for (const c of credits.crew || []) if (c.media_type === mediaType && ['Director','Producer','Executive Producer','Co-Producer','Associate Producer'].includes(c.job)) rows.push(c);
  if (role === 'writer') for (const c of credits.crew || []) if (c.media_type === mediaType && ['Writer','Screenplay','Story'].includes(c.job)) rows.push(c);
  const map = new Map(); for (const row of rows) if (!map.has(`${row.media_type}:${row.id}`)) map.set(`${row.media_type}:${row.id}`, row);
  return [...map.values()].sort((a,b)=>creditDate(b)-creditDate(a)||(b.popularity||0)-(a.popularity||0));
}
async function mapLimited(items, limit, mapper) { const out=new Array(items.length);let index=0;async function worker(){while(true){const i=index++;if(i>=items.length)return;try{out[i]=await mapper(items[i],i);}catch(e){console.warn('[resolver]',e.message);out[i]=null;}}}await Promise.all(Array.from({length:Math.min(limit,items.length||1)},worker));return out.filter(Boolean); }
function bestPersonMatch(people,query){if(!people?.length)return null;const q=normalize(query);const exact=people.find(p=>normalize(p.name)===q);if(exact)return exact;return people[0];}
function isDocumentary(meta){return Array.isArray(meta?.genres)&&meta.genres.some(g=>normalize(g)==='documentary'||normalize(g)==='dokumentarni'||normalize(g)==='dokumentarny');}
function isShort(meta){const runtime=Number(meta?._tmdb?.runtime||meta?.runtime||0);return Number.isFinite(runtime)&&runtime>0&&runtime<=40;}
async function resolvePersonFilmography(query,role,type){const people=await searchPerson(query);if(!people.length)return[];const person=bestPersonMatch(people,query);const credits=await personCredits(person.id);const selected=pickPersonCredits(credits,role,type);return mapLimited(selected,12,item=>resolveTmdbItemToStremioMeta(item,type));}
export async function searchFilmography(rawQuery,type,category='main',forcedRole=null){
  const parsed=stripPrefix(rawQuery);if(!parsed.query)return[];const role=forcedRole||(parsed.role==='auto'||parsed.role==='person'?'actor':parsed.role);
  const all=await resolvePersonFilmography(parsed.query,role,type);
  if(category==='creator')return all;
  if(type==='series'){
    if(category==='special')return all.filter(m=>isDocumentary(m));
    return all.filter(m=>!isDocumentary(m));
  }
  if(category==='special')return all.filter(m=>isDocumentary(m)||isShort(m));
  return all.filter(m=>!isDocumentary(m)&&!isShort(m));
}
