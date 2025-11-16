#!/usr/bin/env node
/*
  Compare monthly leaderboard aggregated kills/deaths vs kill-event totalCount over the same period.

  Usage:
    node scripts/probe-monthly-vs-kd.cjs --char 1983378 --year 2025 --fromMonth 1 --toMonth 11
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
    monthlyKillLeaderboard(year: $year, month: $month){ rank kills deaths character { id name career level renownRank } }
  }
`;

const KD_TOTALS_QUERY = `
  query KDtotals($id: UnsignedInt!, $from: Int!, $to: Int!) {
    byKills: kills(first:1, where:{ time: { gte: $from, lte: $to }, killerCharacterId:{ eq:$id } }){ totalCount }
    byDeaths: kills(first:1, where:{ time: { gte: $from, lte: $to }, victimCharacterId:{ eq:$id } }){ totalCount }
  }
`;

function monthBoundsUTC(year, month1){
  const from = new Date(Date.UTC(year, month1-1, 1, 0, 0, 0));
  const to = new Date(Date.UTC(year, month1, 1, 0, 0, 0));
  return { fromIso: from.toISOString(), toIso: to.toISOString() };
}
function toSec(iso){ return Math.floor(new Date(iso).getTime()/1000); }

async function main(){
  const args = process.argv.slice(2);
  const get = (k)=>{ const i=args.findIndex(x=>x===k||x.startsWith(k+'=')); if(i===-1) return null; return args[i].includes('=')?args[i].split('=')[1]:args[i+1]; };
  const endpoint = get('--endpoint') || DEFAULT_ENDPOINT;
  const charId = Number(get('--char') || '1983378');
  const year = Number(get('--year') || '2025');
  const fromMonth = Number(get('--fromMonth') || '1');
  const toMonth = Number(get('--toMonth') || '11');

  let aggKills = 0, aggDeaths = 0;
  const monthly = [];
  for (let m = fromMonth; m <= toMonth; m++) {
    try {
      const data = await gql(endpoint, MONTHLY_QUERY, { year, month: m });
      const list = (data && data.monthlyKillLeaderboard) || [];
      const entry = list.find(e => String(e && e.character && e.character.id) === String(charId));
      const kills = entry ? (entry.kills||0) : 0;
      const deaths = entry ? (entry.deaths||0) : 0;
      aggKills += kills; aggDeaths += deaths;
      monthly.push({ month: m, kills, deaths });
    } catch (e) {
      monthly.push({ month: m, error: String(e && e.message || e) });
    }
  }

  // KD totals via kill events for the full span
  const fromIso = monthBoundsUTC(year, fromMonth).fromIso;
  const toIso = monthBoundsUTC(year, toMonth+1).fromIso;
  const fromSec = toSec(fromIso), toSecVal = toSec(toIso) - 1; // inclusive end
  const kd = await gql(endpoint, KD_TOTALS_QUERY, { id: charId, from: fromSec, to: toSecVal });
  const eventKills = (kd && kd.byKills && kd.byKills.totalCount) || 0;
  const eventDeaths = (kd && kd.byDeaths && kd.byDeaths.totalCount) || 0;

  const out = {
    characterId: charId,
    year,
    months: { from: fromMonth, to: toMonth, monthly },
    aggregates: { fromMonth, toMonth, leaderboardKills: aggKills, leaderboardDeaths: aggDeaths },
    killEventsTotals: { fromIso, toIso, kills: eventKills, deaths: eventDeaths },
    diff: { kills: aggKills - eventKills, deaths: aggDeaths - eventDeaths }
  };
  console.log(JSON.stringify(out, null, 2));
}

main().catch(e=>{ console.error(e); process.exit(1); });
