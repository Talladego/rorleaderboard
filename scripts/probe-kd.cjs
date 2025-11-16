#!/usr/bin/env node
/*
  Probe K/D paging completeness for a character over a date range.
  Usage:
    node scripts/probe-kd.cjs <characterId> <fromISO> <toISO>
  Example:
    node scripts/probe-kd.cjs 2469976 2025-11-01 2025-11-30
*/

const endpoint = 'https://production-api.waremu.com/graphql/';

async function gql(query, variables) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables })
  });
  if (!res.ok) throw new Error('Network ' + res.status + ' ' + (await res.text()).slice(0, 200));
  const json = await res.json();
  if (json.errors) throw new Error(json.errors.map(e=>e.message).join('; '));
  return json.data;
}

function toSeconds(iso) { return Math.floor(new Date(iso).getTime() / 1000); }

const [,, charArg, fromArg, toArg, firstArg] = process.argv;
if (!charArg || !fromArg || !toArg) {
  console.error('Usage: node scripts/probe-kd.cjs <characterId> <fromISO> <toISO> [pageSize]');
  process.exit(1);
}
const characterId = Number(charArg);
const fromSec = toSeconds(fromArg.endsWith('Z') ? fromArg : fromArg + 'T00:00:00Z');
const toSec = toSeconds(toArg.endsWith('Z') ? toArg : toArg + 'T23:59:59Z');

const KD_QUERY = `
  query KD($id: UnsignedInt!, $from: Int!, $to: Int!, $first: Int!, $afterK: String, $afterD: String) {
    killsRecent: kills(first: $first, after: $afterK, where: { time: { gte: $from, lte: $to }, killerCharacterId: { eq: $id } }) {
      totalCount
      pageInfo { hasNextPage endCursor }
      nodes { id time instance { id } victim { character { id name } } }
    }
    deathsRecent: kills(first: $first, after: $afterD, where: { time: { gte: $from, lte: $to }, victimCharacterId: { eq: $id } }) {
      totalCount
      pageInfo { hasNextPage endCursor }
      nodes { id time instance { id } deathblow { id name } }
    }
  }
`;

async function fetchKD(first, afterK, afterD) {
  const data = await gql(KD_QUERY, { id: characterId, from: fromSec, to: toSec, first, afterK, afterD });
  return {
    kills: data?.killsRecent || { nodes: [], pageInfo: { hasNextPage: false }, totalCount: 0 },
    deaths: data?.deathsRecent || { nodes: [], pageInfo: { hasNextPage: false }, totalCount: 0 },
  };
}

(async () => {
  let pageSize = Number(firstArg) || 0;
  if (!pageSize || !Number.isFinite(pageSize)) {
    const sizes = [100, 50, 25, 10];
    for (const f of sizes) {
      try { await fetchKD(f); pageSize = f; break; }
      catch (e) { if (String(e.message).toLowerCase().includes('maximum allowed items')) continue; else throw e; }
    }
  }

  const seenKillIds = new Set();
  const seenDeathIds = new Set();
  let kills = 0, deaths = 0;
  let totalKills = 0, totalDeaths = 0;
  let afterK, afterD;
  let pageK = 0, pageD = 0;

  // First page
  const p1 = await fetchKD(pageSize, undefined, undefined);
  totalKills = p1.kills.totalCount || 0;
  totalDeaths = p1.deaths.totalCount || 0;
  for (const n of p1.kills.nodes || []) { const id = String(n?.id ?? `${n?.time}|${n?.victim?.character?.id}|${n?.instance?.id}`); if (!seenKillIds.has(id)) { seenKillIds.add(id); kills++; } }
  for (const n of p1.deaths.nodes || []) { const id = String(n?.id ?? `${n?.time}|${n?.deathblow?.id}|${n?.instance?.id}`); if (!seenDeathIds.has(id)) { seenDeathIds.add(id); deaths++; } }
  afterK = p1.kills.pageInfo?.endCursor; afterD = p1.deaths.pageInfo?.endCursor;
  pageK++; pageD++;
  console.log(`[Probe] Using page size ${pageSize}. First page totals: kills=${totalKills}, deaths=${totalDeaths}`);

  // Continue paging until no next page
  while (true) {
    const data = await fetchKD(pageSize, afterK, afterD);
    for (const n of data.kills.nodes || []) { const id = String(n?.id ?? `${n?.time}|${n?.victim?.character?.id}|${n?.instance?.id}`); if (!seenKillIds.has(id)) { seenKillIds.add(id); kills++; } }
    for (const n of data.deaths.nodes || []) { const id = String(n?.id ?? `${n?.time}|${n?.deathblow?.id}|${n?.instance?.id}`); if (!seenDeathIds.has(id)) { seenDeathIds.add(id); deaths++; } }
    const nextK = !!data.kills.pageInfo?.hasNextPage;
    const nextD = !!data.deaths.pageInfo?.hasNextPage;
    afterK = data.kills.pageInfo?.endCursor; afterD = data.deaths.pageInfo?.endCursor;
    pageK += data.kills.nodes?.length ? 1 : 0;
    pageD += data.deaths.nodes?.length ? 1 : 0;
    if (!nextK && !nextD) break;
  }

  const missingKills = Math.max(0, totalKills - kills);
  const missingDeaths = Math.max(0, totalDeaths - deaths);

  console.log(`[Probe Result] Character ${characterId} ${new Date(fromSec*1000).toISOString()} -> ${new Date(toSec*1000).toISOString()}`);
  console.log(`  Kills fetched: ${kills}/${totalKills} (missing ${missingKills}) in ~${pageK} pages`);
  console.log(`  Deaths fetched: ${deaths}/${totalDeaths} (missing ${missingDeaths}) in ~${pageD} pages`);
  if (missingKills || missingDeaths) {
    console.log('  Note: If missing > 0, server pageInfo/totalCount or page size caps may cause early termination; double-check by reducing page size to 10 and retry.');
  }
})().catch((e) => { console.error('[Probe Error]', e); process.exit(1); });
