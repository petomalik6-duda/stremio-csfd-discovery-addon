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
function levenshtein(a,b){a=normalize(a);b=normalize(b);const m=a.length,n=b.length;if(!m)return n;if(!n)return m;let prev=Array.from({length:n+1},(_,i)=>i);for(let i=1;i<=m;i++){const cur=[i];for(let j=1;j<=n;j++)cur[j]=Math.min(cur[j-1]+1,prev[j]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1));prev=cur;}return prev[n];}
function tokenSimilarity(a,b){const x=normalize(a),y=normalize(b);if(!x||!y)return 0;if(x===y)return 1;if(x.startsWith(y)||y.startsWith(x))return 0.96;if(x.includes(y)||y.includes(x))return 0.92;const d=levenshtein(x,y);return Math.max(0,1-d/Math.max(x.length,y.length));}
function nameSimilarity(a,b){const x=normalize(a),y=normalize(b);if(!x||!y)return 0;if(x===y)return 1;if(x.includes(y)||y.includes(x))return 0.94;const xa=x.split(' ').filter(Boolean),ya=y.split(' ').filter(Boolean);let forward=0;for(const q of xa){let best=0;for(const t of ya)best=Math.max(best,tokenSimilarity(q,t));forward+=best;}forward=xa.length?forward/xa.length:0;let reverse=0;for(const t of ya){let best=0;for(const q of xa)best=Math.max(best,tokenSimilarity(t,q));reverse+=best;}reverse=ya.length?reverse/ya.length:0;const whole=tokenSimilarity(x,y);return Math.max(whole,forward*0.82+reverse*0.18);}
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
function bestPersonMatch(people,query){if(!people?.length)return null;const q=normalize(query);const ranked=people.map((p,index)=>{const similarity=nameSimilarity(q,p.name);const popularity=Math.max(0,Number(p.popularity)||0);const popBoost=Math.min(0.10,Math.log10(popularity+1)*0.03);return {p,index,similarity,score:similarity+popBoost};}).sort((a,b)=>b.score-a.score||b.similarity-a.similarity||a.index-b.index);const best=ranked[0];if(!best)return null;const min=q.length<=2?0.90:q.length<=4?0.52:0.40;return best.similarity>=min?best.p:null;}
function typoVariants(query){const q=normalize(query);const parts=q.split(' ').filter(Boolean);const out=new Set([q]);if(parts.length>1){out.add(parts[0]);out.add(parts[parts.length-1]);for(const p of parts)if(p.length>=3)out.add(p);}for(const p of parts){if(p.length<4)continue;for(let i=0;i<p.length;i++)out.add(p.slice(0,i)+p.slice(i+1));}return [...out].filter(x=>x.length>=2).slice(0,14);}
async function findPeopleFuzzy(query){const direct=await searchPerson(query);let combined=[];const seen=new Set();const add=rows=>{for(const p of rows||[])if(!seen.has(p.id)){seen.add(p.id);combined.push(p);}};add(direct);let best=bestPersonMatch(combined,query);if(best&&nameSimilarity(query,best.name)>=0.78)return combined;for(const variant of typoVariants(query)){if(normalize(variant)===normalize(query))continue;try{add(await searchPerson(variant));}catch(e){console.warn('[person-fuzzy]',variant,e.message);}best=bestPersonMatch(combined,query);if(best&&nameSimilarity(query,best.name)>=0.82)break;}return combined;}
function isDocumentary(meta){return Array.isArray(meta?.genres)&&meta.genres.some(g=>normalize(g)==='documentary'||normalize(g)==='dokumentarni'||normalize(g)==='dokumentarny');}
function isShort(meta){const runtime=Number(meta?._tmdb?.runtime||meta?.runtime||0);return Number.isFinite(runtime)&&runtime>0&&runtime<=40;}
async function resolvePersonFilmography(query,role,type){const people=await findPeopleFuzzy(query);if(!people.length)return[];const person=bestPersonMatch(people,query);if(!person)return[];console.log(`[person-match] query=${JSON.stringify(query)} matched=${JSON.stringify(person.name)} similarity=${nameSimilarity(query,person.name).toFixed(3)}`);const credits=await personCredits(person.id);const selected=pickPersonCredits(credits,role,type);return mapLimited(selected,12,item=>resolveTmdbItemToStremioMeta(item,type));}
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
