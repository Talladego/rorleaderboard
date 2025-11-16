import { gql } from './graphql';

export type ProbeRange = { label?: string; fromIso: string; toIso: string };
export type ProbeStats = {
  label: string;
  fromIso: string; toIso: string;
  nodes: number;
  winners: Record<string, number>;
  pointsPresent: number; pointsMissing: number;
  pointsOrderWins: number; pointsDestroWins: number;
  scoreboardPresent: number; scoreboardMissing: number;
  scoreboardHasPlayer: number; scoreboardNoPlayer: number;
  inferredWinnerBase: '0-based' | '1-based' | 'unknown' | 'mixed';
};

type ScenarioNode = {
  id: string;
  winner?: number | string | null;
  startTime?: number;
  endTime?: number;
  points?: Array<number | string> | null;
  scoreboardEntries?: Array<{ team?: number | string | null; character?: { id?: string | number } | null }> | null;
};

const SCEN_PAGE = `
  query ScenProbe($id: ID!, $from: Long!, $to: Long!, $first: Int!, $after: String){
    scenarios(first:$first, after:$after, characterId:$id, from:$from, to:$to){
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        winner
        startTime
        endTime
        points
        scoreboardEntries { team character { id } }
      }
    }
  }
`;

function toMs(iso: string) { return new Date(iso).getTime(); }

export async function probeCharacterScenarios(
  characterId: number | string,
  ranges: ProbeRange[],
  opts?: { limitPages?: number; log?: (msg: any) => void }
): Promise<ProbeStats[]> {
  const log = opts?.log || (() => {});
  const results: ProbeStats[] = [];
  for (const r of ranges) {
    const label = r.label || `${r.fromIso} → ${r.toIso}`;
    const from = toMs(r.fromIso);
    const to = toMs(r.toIso);
    let after: string | undefined;
    let pages = 0;
    const first = 100;
    const winners: Record<string, number> = {};
    let pointsPresent = 0, pointsMissing = 0, pointsOrderWins = 0, pointsDestroWins = 0;
    let scoreboardPresent = 0, scoreboardMissing = 0, scoreboardHasPlayer = 0, scoreboardNoPlayer = 0;
    let nodesCount = 0;
    const observedWinners = new Set<number>();

    while (pages < (opts?.limitPages ?? 20)) {
      const data = await gql<any>(SCEN_PAGE, { id: String(characterId), from, to, first, after });
      const nodes: ScenarioNode[] = data?.scenarios?.nodes || [];
      if (!nodes.length) break;
      for (const n of nodes) {
        nodesCount++;
        // winner collection
        const wRaw = (n as any)?.winner; const w = typeof wRaw === 'number' ? wRaw : (typeof wRaw === 'string' ? parseInt(wRaw, 10) : NaN);
        if (!Number.isNaN(w)) { winners[String(w)] = (winners[String(w)] || 0) + 1; observedWinners.add(w); }
        // points
        if (Array.isArray(n.points) && n.points.length >= 2) {
          pointsPresent++;
          const o = Number(n.points[0]); const d = Number(n.points[1]);
          if (!Number.isNaN(o) && !Number.isNaN(d)) {
            if (o >= d) pointsOrderWins++; else pointsDestroWins++;
          }
        } else { pointsMissing++; }
        // scoreboardEntries
        if (Array.isArray(n.scoreboardEntries)) {
          scoreboardPresent++;
          const me = n.scoreboardEntries.find(se => String(se?.character?.id) === String(characterId));
          if (me) scoreboardHasPlayer++; else scoreboardNoPlayer++;
        } else { scoreboardMissing++; }
      }
      const pi = data?.scenarios?.pageInfo;
      if (!pi?.hasNextPage || !pi?.endCursor) break;
      after = pi.endCursor; pages++;
    }
    let inferredWinnerBase: ProbeStats['inferredWinnerBase'] = 'unknown';
    if (observedWinners.size) {
      const has2 = observedWinners.has(2);
      const only01 = observedWinners.has(0) || observedWinners.has(1);
      if (has2 && (observedWinners.has(1) || observedWinners.has(2)) && !observedWinners.has(0)) inferredWinnerBase = '1-based';
      else if (only01 && !has2) inferredWinnerBase = '0-based';
      else inferredWinnerBase = 'mixed';
    }
    const stat: ProbeStats = {
      label, fromIso: r.fromIso, toIso: r.toIso,
      nodes: nodesCount, winners,
      pointsPresent, pointsMissing,
      pointsOrderWins, pointsDestroWins,
      scoreboardPresent, scoreboardMissing,
      scoreboardHasPlayer, scoreboardNoPlayer,
      inferredWinnerBase
    };
    results.push(stat);
    log({ probe: 'scenario', characterId, ...stat });
  }
  return results;
}

// Convenience dev helper for quick manual testing in browser console
export async function probeDefault_2495885(opts?: { limitPages?: number; log?: (msg: any)=>void }) {
  const ranges: ProbeRange[] = [
    { label: 'April 2025', fromIso: '2025-04-01T00:00:00Z', toIso: '2025-04-30T23:59:59Z' },
    { label: 'September 2025', fromIso: '2025-09-01T00:00:00Z', toIso: '2025-09-30T23:59:59Z' }
  ];
  return probeCharacterScenarios(2495885, ranges, opts);
}
