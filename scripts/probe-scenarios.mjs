// Probe script to test scenarios query shapes and fetch most recent scenarios for a character
// Usage: node scripts/probe-scenarios.mjs [characterId] [first]

const endpoint = 'https://production-api.waremu.com/graphql/';

async function gql(query, variables = {}) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables })
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { throw new Error(`Non-JSON response: ${text.slice(0,200)}`); }
  if (!res.ok || json.errors) {
    const msg = json?.errors?.map(e=>e.message).join('; ') || `${res.status} ${res.statusText}`;
    const err = new Error(msg);
    err.raw = json;
    throw err;
  }
  return json.data;
}

function simplifyNodes(nodes, keys) {
  return (nodes || []).slice(0, 5).map(n => {
    const o = {};
    for (const k of keys) { if (k in (n || {})) o[k] = n[k]; }
    return o;
  });
}

async function tryQuery(label, query, vars, nodeKeys) {
  const t0 = Date.now();
  try {
    const data = await gql(query, vars);
    const conn = data?.scenarios;
    const nodes = conn?.nodes || [];
    const pageInfo = conn?.pageInfo || {};
    const dt = Date.now() - t0;
    console.log(`\n[OK] ${label}: nodes=${nodes.length}, hasNext=${!!pageInfo.hasNextPage}, dt=${dt}ms`);
    if (nodes.length) {
      console.log(' sample:', simplifyNodes(nodes, nodeKeys));
    }
    return { ok: true, nodes, pageInfo };
  } catch (e) {
    console.log(`\n[ERR] ${label}:`, e.message);
    return { ok: false, error: e };
  }
}

(async () => {
  const id = (process.argv[2] || '2495885').toString();
  const first = parseInt(process.argv[3] || '20', 10);
  console.log('Probing scenarios for characterId =', id, 'first =', first);

  // Attempts: characterId param without time (most recent scenarios)
  const vars = { idStr: id, first };

  // One-field selection attempts to avoid schema errors for unknown fields
  const qWinner = `query Q($idStr: ID!, $first: Int!){ scenarios(first:$first, characterId:$idStr){ pageInfo{hasNextPage endCursor} nodes{ winner } } }`;
  const qWins   = `query Q($idStr: ID!, $first: Int!){ scenarios(first:$first, characterId:$idStr){ pageInfo{hasNextPage endCursor} nodes{ wins } } }`;
  const qWin    = `query Q($idStr: ID!, $first: Int!){ scenarios(first:$first, characterId:$idStr){ pageInfo{hasNextPage endCursor} nodes{ win } } }`;
  const qResult = `query Q($idStr: ID!, $first: Int!){ scenarios(first:$first, characterId:$idStr){ pageInfo{hasNextPage endCursor} nodes{ result } } }`;
  const qTimes  = `query Q($idStr: ID!, $first: Int!){ scenarios(first:$first, characterId:$idStr){ pageInfo{hasNextPage endCursor} nodes{ time startedAt endedAt createdAt } } }`;
  const qId     = `query Q($idStr: ID!, $first: Int!){ scenarios(first:$first, characterId:$idStr){ pageInfo{hasNextPage endCursor} nodes{ id } } }`;
  const qInst   = `query Q($idStr: ID!, $first: Int!){ scenarios(first:$first, characterId:$idStr){ pageInfo{hasNextPage endCursor} nodes{ instance{ id } } } }`;
  const qInstId = `query Q($idStr: ID!, $first: Int!){ scenarios(first:$first, characterId:$idStr){ pageInfo{hasNextPage endCursor} nodes{ instanceId } } }`;

  await tryQuery('characterId winner', qWinner, vars, ['winner']);
  await tryQuery('characterId wins', qWins, vars, ['wins']);
  await tryQuery('characterId win', qWin, vars, ['win']);
  await tryQuery('characterId result', qResult, vars, ['result']);
  await tryQuery('characterId time fields', qTimes, vars, ['time','startedAt','endedAt','createdAt']);
  await tryQuery('characterId record id', qId, vars, ['id']);
  await tryQuery('characterId instance.id', qInst, vars, ['instance']);
  await tryQuery('characterId instanceId', qInstId, vars, ['instanceId']);

  // Totals: verify totalCount availability and wins argument support
  const nowMs = Date.now();
  const fromMs = nowMs - 30*24*3600*1000; // last 30 days
  const nowSec = Math.floor(nowMs/1000);
  const fromSec = Math.floor(fromMs/1000);
  async function tryTotals(label, query, vars) {
    const t0 = Date.now();
    try {
      const data = await gql(query, vars);
      const wins = data?.wins?.totalCount ?? null;
      const losses = data?.losses?.totalCount ?? null;
      const dt = Date.now() - t0;
      console.log(`\n[OK] ${label}: wins=${wins} losses=${losses} dt=${dt}ms`);
    } catch (e) {
      console.log(`\n[ERR] ${label}:`, e.message);
    }
  }
  const qTotalsNoTime = `query Q($idStr: ID!){ wins: scenarios(first:1, characterId:$idStr, wins:true){ totalCount } losses: scenarios(first:1, characterId:$idStr, wins:false){ totalCount } }`;
  const qTotalsMs = `query Q($idStr: ID!, $from: Long!, $to: Long!){ wins: scenarios(first:1, characterId:$idStr, from:$from, to:$to, wins:true){ totalCount } losses: scenarios(first:1, characterId:$idStr, from:$from, to:$to, wins:false){ totalCount } }`;
  const qTotalsSec = `query Q($idStr: ID!, $from: Int!, $to: Int!){ wins: scenarios(first:1, characterId:$idStr, from:$from, to:$to, wins:true){ totalCount } losses: scenarios(first:1, characterId:$idStr, from:$from, to:$to, wins:false){ totalCount } }`;
  await tryTotals('totals no time (wins arg)', qTotalsNoTime, { idStr: id });
  await tryTotals('totals with ms from/to (wins arg)', qTotalsMs, { idStr: id, from: fromMs, to: nowMs });
  await tryTotals('totals with sec from/to (wins arg)', qTotalsSec, { idStr: id, from: fromSec, to: nowSec });

  // where participants.some.character.id
  const qWherePartWinner = `query Q($idStr: ID!, $first: Int!){ scenarios(first:$first, where:{ participants:{ some:{ character:{ id:{ eq:$idStr } } } } }){ pageInfo{hasNextPage endCursor} nodes{ winner } } }`;
  const qWherePartWins   = `query Q($idStr: ID!, $first: Int!){ scenarios(first:$first, where:{ participants:{ some:{ character:{ id:{ eq:$idStr } } } } }){ pageInfo{hasNextPage endCursor} nodes{ wins } } }`;
  await tryQuery('where participants winner', qWherePartWinner, vars, ['winner']);
  await tryQuery('where participants wins', qWherePartWins, vars, ['wins']);

  // where records.some.character.id
  const qWhereRecWinner = `query Q($idStr: ID!, $first: Int!){ scenarios(first:$first, where:{ records:{ some:{ character:{ id:{ eq:$idStr } } } } }){ pageInfo{hasNextPage endCursor} nodes{ winner } } }`;
  const qWhereRecWins   = `query Q($idStr: ID!, $first: Int!){ scenarios(first:$first, where:{ records:{ some:{ character:{ id:{ eq:$idStr } } } } }){ pageInfo{hasNextPage endCursor} nodes{ wins } } }`;
  await tryQuery('where records winner', qWhereRecWinner, vars, ['winner']);
  await tryQuery('where records wins', qWhereRecWins, vars, ['wins']);

  console.log('\nDone. Use the [OK]/[ERR] rows above to see which shapes work.');
})();
