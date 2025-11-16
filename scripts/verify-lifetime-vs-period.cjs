#!/usr/bin/env node
/*
  Verify lifetime kill/death totals are >= sums from monthly or weekly leaderboards over a year range.

  Usage examples:
    node scripts/verify-lifetime-vs-period.cjs --char 1983378 --mode monthly --fromYear 2025 --toYear 2025
    node scripts/verify-lifetime-vs-period.cjs --char 2808133 --mode weekly --fromYear 2025 --toYear 2025
*/

const DEFAULT_ENDPOINT = 'https://production-api.waremu.com/graphql/';

async function ensureFetch(){
  if (typeof fetch === 'function') return fetch;
  try { const m = await import('node-fetch'); return m.default; } catch { throw new Error('fetch not found; use Node 18+ or install node-fetch'); }
}

async function gql(endpoint, query, variables){
  const f = await ensureFetch();
  const res = await f(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query, variables }) });
  if (!res.ok) { const t = await res.text(); throw new Error('Network ' + res.status + ': ' + t.slice(0,200)); }
  const json = await res.json(); if (json.errors) throw new Error(json.errors.map(e=>e.message).join('; '));
  return json.data;
}

const MONTHLY_QUERY = `
  query Monthly($year: Int!, $month: Int!){
    monthlyKillLeaderboard(year: $year, month: $month){ rank kills deaths character { id name } }
  }
`;
const WEEKLY_QUERY = `
  query Weekly($year: Int!, $week: Int!){
    weeklyKillLeaderboard(year: $year, week: $week){ rank kills deaths character { id name } }
  }
`;
const LIFETIME_KD = `
  query Life($id: UnsignedInt!){
    byKills: kills(first:1, where:{ killerCharacterId:{ eq:$id } }){ totalCount }
    byDeaths: kills(first:1, where:{ victimCharacterId:{ eq:$id } }){ totalCount }
  }
`;

function isoWeeksInYearUTC(y){
  const d = new Date(Date.UTC(y, 11, 28)); // Dec 28
  // ISO week number of Dec 28 is the number of weeks in the year
  const weekNum = getISOWeekUTC(d);
  return weekNum;
}
function getISOWeekUTC(d){
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (date.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  date.setUTCDate(date.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const diff = date - firstThursday;
  return 1 + Math.floor(diff / 86400000 / 7);
}

async function sumMonthly(endpoint, charId, year){
  let kills=0,deaths=0; const rows=[]; const now=new Date(); const lastMonth=(year===now.getUTCFullYear())?(now.getUTCMonth()+1):12;
  for(let m=1;m<=lastMonth;m++){
    try{
      const data=await gql(endpoint, MONTHLY_QUERY, { year, month:m });
      const list=(data&&data.monthlyKillLeaderboard)||[];
      const entry=list.find(e=>String(e&&e.character&&e.character.id)===String(charId));
      const k=entry?(entry.kills||0):0; const d=entry?(entry.deaths||0):0;
      kills+=k; deaths+=d; rows.push({ month:m,kills:k,deaths:d, present:!!entry });
    }catch(e){ rows.push({month:m,error:String(e&&e.message||e)}); }
  }
  return { year, kills, deaths, rows };
}

async function sumWeekly(endpoint, charId, year){
  let kills=0,deaths=0; const rows=[]; const now=new Date();
  const lastWeek=(year===getISOWeekYearUTC(now))?getISOWeekUTC(now):isoWeeksInYearUTC(year);
  for(let w=1;w<=lastWeek;w++){
    try{
      const data=await gql(endpoint, WEEKLY_QUERY, { year, week:w });
      const list=(data&&data.weeklyKillLeaderboard)||[];
      const entry=list.find(e=>String(e&&e.character&&e.character.id)===String(charId));
      const k=entry?(entry.kills||0):0; const d=entry?(entry.deaths||0):0;
      kills+=k; deaths+=d; rows.push({ week:w,kills:k,deaths:d, present:!!entry });
    }catch(e){ rows.push({week:w,error:String(e&&e.message||e)}); }
  }
  return { year, kills, deaths, rows };
}
function getISOWeekYearUTC(d){
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayNum + 3);
  return date.getUTCFullYear();
}

async function main(){
  const args=process.argv.slice(2);
  const get=(k)=>{const i=args.findIndex(x=>x===k||x.startsWith(k+'=')); if(i===-1) return null; return args[i].includes('=')?args[i].split('=')[1]:args[i+1];};
  const endpoint=get('--endpoint')||DEFAULT_ENDPOINT;
  const charId=Number(get('--char'));
  const mode=(get('--mode')||'monthly').toLowerCase();
  const fromYear=Number(get('--fromYear')||'2025');
  const toYear=Number(get('--toYear')||String(new Date().getUTCFullYear()));
  if(!charId||!Number.isFinite(charId)){ console.error('Provide --char <id>'); process.exit(1);} 
  const acc={ kills:0, deaths:0, byYear:[] };
  for(let y=fromYear;y<=toYear;y++){
    const sum = (mode==='weekly') ? await sumWeekly(endpoint,charId,y) : await sumMonthly(endpoint,charId,y);
    acc.kills+=sum.kills; acc.deaths+=sum.deaths; acc.byYear.push(sum);
  }
  const life=await gql(endpoint, LIFETIME_KD, { id: charId });
  const lifeKills=(life&&life.byKills&&life.byKills.totalCount)||0;
  const lifeDeaths=(life&&life.byDeaths&&life.byDeaths.totalCount)||0;
  const okKills = lifeKills >= acc.kills;
  const okDeaths = lifeDeaths >= acc.deaths;
  const out={ characterId:charId, mode, fromYear, toYear, summed: { kills: acc.kills, deaths: acc.deaths }, lifetime: { kills: lifeKills, deaths: lifeDeaths }, ok: { kills: okKills, deaths: okDeaths }, details: acc.byYear };
  console.log(JSON.stringify(out,null,2));
  if(!okKills || !okDeaths){ console.error('Violation: lifetime < summed period totals'); process.exitCode=2; }
}

main().catch(e=>{ console.error(e); process.exit(1); });
