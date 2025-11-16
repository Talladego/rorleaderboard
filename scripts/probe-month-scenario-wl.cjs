#!/usr/bin/env node
/*
  Probe per-character scenario W/L for a given month using score-based winner and scoreboardEntries to determine the player's team.

  Usage (PowerShell):
    node scripts/probe-month-scenario-wl.cjs --char 2495885 --year 2025 --month 11 --limitPages 50
*/

const DEFAULT_ENDPOINT = 'https://production-api.waremu.com/graphql/';

async function ensureFetch() {
  if (typeof fetch === 'function') return fetch;
  try {
    const mod = await import('node-fetch');
    return mod.default;
  } catch {
    throw new Error('Global fetch not found. Please run with Node 18+ or install node-fetch.');
  }
}

async function gql(endpoint, query, variables) {
  const f = await ensureFetch();
  const res = await f(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables })
  });
  if (!res.ok) {
    let text = await res.text();
    try { const parsed = JSON.parse(text); if (parsed.errors) throw new Error(parsed.errors.map(e => e.message).join('; ')); } catch {}
    throw new Error('Network error ' + res.status + (text ? ': ' + text.slice(0,200) : ''));
  }
  const json = await res.json();
  if (json.errors) throw new Error(json.errors.map(e => e.message).join('; '));
  return json.data;
}

function monthBoundsUTC(year, month1){
  const from = new Date(Date.UTC(year, month1-1, 1, 0, 0, 0));
  const to = new Date(Date.UTC(year, month1, 1, 0, 0, 0));
  return { fromIso: from.toISOString(), toIso: to.toISOString() };
}

const SCEN_PAGE = `
  query ScenProbe($id: ID!, $from: Long!, $to: Long!, $first: Int!, $after: String){
    scenarios(first:$first, after:$after, characterId:$id, from:$from, to:$to){
      pageInfo { hasNextPage endCursor }
      nodes {
        id points scoreboardEntries { team character { id } }
      }
    }
  }
`;

const TOTALS_QUERY = `
  query Totals($id: ID!){
    wins: scenarios(first:1, characterId:$id, wins:true){ totalCount }
    losses: scenarios(first:1, characterId:$id, wins:false){ totalCount }
  }
`;

async function pickPageSize(endpoint, id, from, to){
  const candidates = [100, 50, 25, 10];
  for (const f of candidates) {
    try {
      await gql(endpoint, SCEN_PAGE, { id: String(id), from, to, first: f, after: null });
      return f;
    } catch (e) {
      const msg = String((e && e.message) || e).toLowerCase();
      if (msg.includes('maximum allowed items')) continue;
      throw e;
    }
  }
  return 10;
}

async function probeMonth(endpoint, charId, year, month1, limitPages){
  const { fromIso, toIso } = monthBoundsUTC(year, month1);
  // API expects seconds for scenarios list; use seconds consistently
  const fromMs = new Date(fromIso).getTime();
  const toMs = new Date(toIso).getTime();
  const from = Math.floor(fromMs/1000);
  const to = Math.floor(toMs/1000);
  const first = await pickPageSize(endpoint, charId, from, to);
  let after = null; let pages = 0;
  let wins = 0, losses = 0, unknown = 0, nodes = 0;
  while (pages < (limitPages || 50)){
    const data = await gql(endpoint, SCEN_PAGE, { id: String(charId), from, to, first, after });
    const arr = (data && data.scenarios && data.scenarios.nodes) || [];
    if (!arr.length) break;
    for (const s of arr){
      nodes++;
      const pts = Array.isArray(s.points) ? s.points.map(x=>Number(x)) : [];
      if (pts.length < 2 || Number.isNaN(pts[0]) || Number.isNaN(pts[1])) { unknown++; continue; }
      const winnerTeam = pts[0] >= pts[1] ? 0 : 1;
      const me = Array.isArray(s.scoreboardEntries) ? s.scoreboardEntries.find(se => String(se && se.character && se.character.id) === String(charId)) : null;
      let playerTeam = null;
      if (me) {
        const tRaw = me.team; const t = typeof tRaw === 'number' ? tRaw : (typeof tRaw === 'string' ? parseInt(tRaw,10) : NaN);
        if (!Number.isNaN(t)) playerTeam = t;
      }
      if (playerTeam == null) { unknown++; continue; }
      if (playerTeam === winnerTeam) wins++; else losses++;
    }
    const pi = data && data.scenarios && data.scenarios.pageInfo;
    if (!pi || !pi.hasNextPage || !pi.endCursor) break;
    after = pi.endCursor; pages++;
  }
  return { fromIso, toIso, wins, losses, unknown, nodes };
}

async function fetchTotals(endpoint, charId){
  const data = await gql(endpoint, TOTALS_QUERY, { id: String(charId) });
  return { totalWins: (data && data.wins && data.wins.totalCount) || 0, totalLosses: (data && data.losses && data.losses.totalCount) || 0 };
}

async function main(){
  const args = process.argv.slice(2);
  const get = (k) => {
    const i = args.findIndex(x => x === k || x.startsWith(k + '='));
    if (i === -1) return null;
    const v = args[i].includes('=') ? args[i].split('=')[1] : args[i+1];
    return v ?? null;
  };
  const endpoint = get('--endpoint') || DEFAULT_ENDPOINT;
  const charId = Number(get('--char') || '2495885');
  const year = Number(get('--year') || '2025');
  const month1 = Number(get('--month') || '11');
  const limitPages = Number(get('--limitPages') || '50');
  const month = await probeMonth(endpoint, charId, year, month1, limitPages);
  const totals = await fetchTotals(endpoint, charId);
  const out = { characterId: charId, year, month: month1, month, totals };
  console.log(JSON.stringify(out, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });
