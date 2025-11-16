#!/usr/bin/env node
/*
  Scenario-by-ID probe CLI
  - Fetches specific ScenarioRecord(s) by id and prints comparable fields

  Usage (PowerShell):
    node scripts/probe-scenario-ids.cjs --id f3df20b0b4074b6f8190f755b482b936 --id 9472d18e363c4d259a96f59a427b40d8
    npm run probe:ids -- --id <id1> --id <id2>
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

const SCEN_BY_ID = `
  query ScenarioById($id: ID!){
    scenario(id: $id){
      id
      winner
      points
      startTime
      endTime
      tier
      queueType
      scenario { id name }
      scoreboardEntries { team character { id name career } }
    }
  }
`;

function toIso(ts) {
  if (typeof ts !== 'number') return null;
  // API may return ms; if it's too small, assume seconds and multiply
  if (ts < 10_000_000_000) ts = ts * 1000;
  return new Date(ts).toISOString();
}

function summarizeScenario(s) {
  const pts = Array.isArray(s.points) ? s.points.map(Number) : [];
  let winnerByPoints = null;
  if (pts.length >= 2 && !Number.isNaN(pts[0]) && !Number.isNaN(pts[1])) {
    winnerByPoints = (Number(pts[0]) >= Number(pts[1])) ? 0 : 1; // 0=Order,1=Destro
  }
  const teamCounts = { 0: 0, 1: 0, other: 0 };
  if (Array.isArray(s.scoreboardEntries)) {
    for (const e of s.scoreboardEntries) {
      const t = (typeof e.team === 'number') ? e.team : (typeof e.team === 'string' ? parseInt(e.team, 10) : NaN);
      if (t === 0) teamCounts[0]++; else if (t === 1) teamCounts[1]++; else teamCounts.other++;
    }
  }
  const wRaw = (typeof s.winner === 'number') ? s.winner : (typeof s.winner === 'string' ? parseInt(s.winner,10) : NaN);
  const inferredBase = !Number.isNaN(wRaw) ? (wRaw >= 2 ? '1-based' : '0-based') : 'unknown';
  const normalizedWinner = !Number.isNaN(wRaw) ? (wRaw >= 2 ? wRaw - 1 : wRaw) : null; // 0=Order,1=Destro when normalized
  return {
    id: s.id,
    scenario: s.scenario?.name || null,
    tier: s.tier ?? null,
    queueType: s.queueType ?? null,
    startTime: toIso(s.startTime),
    endTime: toIso(s.endTime),
    points: pts.length ? pts : null,
    winnerRaw: wRaw,
    winnerNormalized: normalizedWinner,
    inferredWinnerBase: inferredBase,
    winnerByPoints,
    scoreboardTeams: teamCounts
  };
}

async function main(){
  const args = process.argv.slice(2);
  const get = (k) => {
    const i = args.findIndex(x => x === k || x.startsWith(k + '='));
    if (i === -1) return null;
    const v = args[i].includes('=') ? args[i].split('=')[1] : args[i+1];
    return v ?? null;
  };
  const getAll = (k) => {
    const out = [];
    for (let i=0;i<args.length;i++){
      const x=args[i];
      if (x === k) { if (args[i+1]) out.push(args[i+1]); i++; continue; }
      if (x.startsWith(k+'=')) out.push(x.split('=')[1]);
    }
    return out;
  };

  const endpoint = get('--endpoint') || DEFAULT_ENDPOINT;
  const ids = getAll('--id');
  if (!ids.length) {
    console.log('Usage: node scripts/probe-scenario-ids.cjs --id <scenarioId> [--id <scenarioId> ...]');
    process.exit(1);
  }

  console.log('[Probe] endpoint =', endpoint);
  console.log('[Probe] scenario ids =', ids);

  const results = [];
  for (const id of ids) {
    try {
      const data = await gql(endpoint, SCEN_BY_ID, { id: String(id) });
      const s = data && data.scenario;
      if (!s) { console.warn('No scenario found for id', id); continue; }
      const summary = summarizeScenario(s);
      console.log('\n=== Scenario', id, '===');
      console.log(JSON.stringify(summary, null, 2));
      results.push(summary);
    } catch (e) {
      console.warn('Scenario fetch failed for', id, e);
    }
  }

  if (results.length >= 2) {
    const a = results[0], b = results[1];
    console.log('\n=== Comparison ===');
    const compare = {
      ids: [a.id, b.id],
      winnerRaw: [a.winnerRaw, b.winnerRaw],
      winnerNormalized: [a.winnerNormalized, b.winnerNormalized],
      inferredWinnerBase: [a.inferredWinnerBase, b.inferredWinnerBase],
      winnerByPoints: [a.winnerByPoints, b.winnerByPoints],
      points: [a.points, b.points],
      scoreboardTeams: [a.scoreboardTeams, b.scoreboardTeams],
      startTime: [a.startTime, b.startTime],
      endTime: [a.endTime, b.endTime],
      scenarioName: [a.scenario, b.scenario],
      tier: [a.tier, b.tier],
      queueType: [a.queueType, b.queueType]
    };
    console.log(JSON.stringify(compare, null, 2));
  }
}

main().catch((e)=>{ console.error(e); process.exit(1); });
