#!/usr/bin/env node
/*
  Scenario probe CLI
  - Compares scenario data across given date ranges for a character
  - Gathers: winner distribution, inferred winner base (0/1 vs 1/2), points availability and points-based winners,
             scoreboard availability and whether the player appears on it

  Usage examples (PowerShell):
    node scripts/probe-scenarios.cjs --char 2495885 --range 2025-04-01,2025-04-30 --range 2025-09-01,2025-09-30 --limitPages 20
    npm run probe -- --char 2495885 --range 2025-04-01,2025-04-30 --range 2025-09-01,2025-09-30
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

const SCEN_PAGE = `
  query ScenProbe($id: ID!, $from: Long!, $to: Long!, $first: Int!, $after: String){
    scenarios(first:$first, after:$after, characterId:$id, from:$from, to:$to){
      pageInfo { hasNextPage endCursor }
      nodes {
        id winner startTime endTime points
        scoreboardEntries { team character { id } }
      }
    }
  }
`;

const SCEN_PAGE_MIN = `
  query ScenProbeMin($id: ID!, $from: Long!, $to: Long!, $first: Int!, $after: String){
    scenarios(first:$first, after:$after, characterId:$id, from:$from, to:$to){
      pageInfo { hasNextPage endCursor }
      nodes { id winner startTime endTime }
    }
  }
`;

const SCEN_PAGE_UNBOUNDED_MIN = `
  query ScenProbeUnboundedMin($id: ID!, $first: Int!, $after: String){
    scenarios(first:$first, after:$after, characterId:$id){
      pageInfo { hasNextPage endCursor }
      nodes { id winner startTime endTime }
    }
  }
`;

function toMs(iso) { return new Date(iso).getTime(); }
function normDateStart(s) { return /\dT/.test(s) ? s : s + 'T00:00:00Z'; }
function normDateEnd(s) { return /\dT/.test(s) ? s : s + 'T23:59:59Z'; }

async function probeRange(endpoint, characterId, range, limitPages = 20) {
  const from = toMs(range.fromIso);
  const to = toMs(range.toIso);
  let after; let pages = 0;

  // Determine an acceptable page size by probing common candidates
  async function pickFirst() {
    const candidates = [100, 50, 25, 10];
    for (const f of candidates) {
      try {
        await gql(endpoint, SCEN_PAGE, { id: String(characterId), from, to, first: f, after: null });
        return f;
      } catch (e) {
        const msg = String((e && e.message) || e).toLowerCase();
        if (msg.includes('maximum allowed items')) continue;
        // For other errors, rethrow to fail fast
        throw e;
      }
    }
    // Last resort
    return 10;
  }
  const first = await pickFirst();

  async function fetchBounded(queryDoc, fromVal, toVal) {
    return gql(endpoint, queryDoc, { id: String(characterId), from: fromVal, to: toVal, first, after });
  }

  const winners = Object.create(null);
  const observedWinners = new Set();
  let pointsPresent = 0, pointsMissing = 0, pointsOrderWins = 0, pointsDestroWins = 0;
  let scoreboardPresent = 0, scoreboardMissing = 0, scoreboardHasPlayer = 0, scoreboardNoPlayer = 0;
  let nodesCount = 0;

  while (pages < limitPages) {
    let data = await fetchBounded(SCEN_PAGE, from, to);
    let nodes = (data && data.scenarios && data.scenarios.nodes) || [];
    // If zero nodes, retry with minimal selection to rule out cost/field issues
    if (!nodes.length) {
      try {
        data = await fetchBounded(SCEN_PAGE_MIN, from, to);
        nodes = (data && data.scenarios && data.scenarios.nodes) || [];
        // If still zero, try assuming the API expects seconds instead of milliseconds
        if (!nodes.length) {
          const fromSec = Math.floor(from / 1000);
          const toSec = Math.floor(to / 1000);
          try {
            data = await fetchBounded(SCEN_PAGE_MIN, fromSec, toSec);
            nodes = (data && data.scenarios && data.scenarios.nodes) || [];
          } catch {}
        }
      } catch {}
    }
    if (!nodes.length) break;
    for (const n of nodes) {
      nodesCount++;
      const wRaw = n && n.winner; const w = (typeof wRaw === 'number') ? wRaw : (typeof wRaw === 'string' ? parseInt(wRaw, 10) : NaN);
      if (!Number.isNaN(w)) { winners[String(w)] = (winners[String(w)] || 0) + 1; observedWinners.add(w); }
      if (Array.isArray(n.points) && n.points.length >= 2) {
        pointsPresent++;
        const o = Number(n.points[0]); const d = Number(n.points[1]);
        if (!Number.isNaN(o) && !Number.isNaN(d)) { if (o >= d) pointsOrderWins++; else pointsDestroWins++; }
      } else pointsMissing++;
      if (Array.isArray(n.scoreboardEntries)) {
        scoreboardPresent++;
        const me = n.scoreboardEntries.find(se => String(se && se.character && se.character.id) === String(characterId));
        if (me) scoreboardHasPlayer++; else scoreboardNoPlayer++;
      } else scoreboardMissing++;
    }
    const pi = data && data.scenarios && data.scenarios.pageInfo;
    if (!pi || !pi.hasNextPage || !pi.endCursor) break;
    after = pi.endCursor; pages++;
  }

  let inferredWinnerBase = 'unknown';
  if (observedWinners.size) {
    const has2 = observedWinners.has(2);
    const has0 = observedWinners.has(0);
    const has1 = observedWinners.has(1);
    if (has2 && has1 && !has0) inferredWinnerBase = '1-based';
    else if ((has0 || has1) && !has2) inferredWinnerBase = '0-based';
    else inferredWinnerBase = 'mixed';
  }

  return {
    label: range.label || `${range.fromIso} → ${range.toIso}`,
    fromIso: range.fromIso,
    toIso: range.toIso,
    nodes: nodesCount,
    winners,
    inferredWinnerBase,
    pointsPresent, pointsMissing,
    pointsOrderWins, pointsDestroWins,
    scoreboardPresent, scoreboardMissing,
    scoreboardHasPlayer, scoreboardNoPlayer
  };
}

async function main() {
  const args = process.argv.slice(2);
  const get = (k) => {
    const i = args.findIndex(x => x === k || x.startsWith(k + '='));
    if (i === -1) return null;
    const v = args[i].includes('=') ? args[i].split('=')[1] : args[i+1];
    return v ?? null;
  };
  const getAll = (k) => {
    const res = [];
    for (let i=0;i<args.length;i++){
      const x = args[i];
      if (x === k) { if (args[i+1]) res.push(args[i+1]); i++; continue; }
      if (x.startsWith(k+'=')) { res.push(x.split('=')[1]); }
    }
    return res;
  };

  const endpoint = get('--endpoint') || DEFAULT_ENDPOINT;
  const charRaw = get('--char');
  const characterId = charRaw ? Number(charRaw) : 2495885;
  const limitPages = Number(get('--limitPages') || '20');
  let ranges = getAll('--range').map(r => {
    const [fromS, toS] = r.split(',').map(s => s.trim());
    return { fromIso: normDateStart(fromS), toIso: normDateEnd(toS) };
  });
  if (!ranges.length) {
    ranges = [
      { label: 'April 2025', fromIso: '2025-04-01T00:00:00Z', toIso: '2025-04-30T23:59:59Z' },
      { label: 'September 2025', fromIso: '2025-09-01T00:00:00Z', toIso: '2025-09-30T23:59:59Z' }
    ];
  }

  console.log('[Probe] endpoint =', endpoint);
  console.log('[Probe] characterId =', characterId);
  console.log('[Probe] limitPages =', limitPages);
  console.log('[Probe] ranges =', ranges);

  const out = [];
  for (const r of ranges) {
    try {
      const stat = await probeRange(endpoint, characterId, r, limitPages);
      console.log('\n=== Range:', stat.label, '===');
      console.log(JSON.stringify(stat, null, 2));
      out.push(stat);
    } catch (e) {
      console.warn('Range failed', r, e);
    }
  }

  console.log('\n[Probe] done. Summary:');
  console.log(JSON.stringify({ characterId, endpoint, limitPages, ranges: out }, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
