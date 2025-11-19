export const endpoint = 'https://production-api.waremu.com/graphql/';

export async function gql<T = any>(query: string, variables?: Record<string, any>, opts?: { signal?: AbortSignal }): Promise<T> {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
    signal: opts?.signal
  });
  if (!res.ok) {
    let bodyText = await res.text();
    try {
      const parsed = JSON.parse(bodyText);
      if (parsed && parsed.errors) {
        throw new Error(parsed.errors.map((e: any) => e.message).join('; '));
      }
    } catch {}
    throw new Error('Network error ' + res.status + (bodyText ? ': ' + bodyText.slice(0, 200) : ''));
  }
  const json = await res.json();
  if (json.errors) {
    throw new Error(json.errors.map((e: any) => e.message).join('; '));
  }
  return json.data;
}

export const WEEKLY_QUERY = `
  query Weekly($year: Int!, $week: Int!){
    weeklyKillLeaderboard(year: $year, week: $week){
      rank
      kills
      deaths
      character { id name career level renownRank guildMembership { guild { id name realm } } }
    }
  }
`;

// Fallback without guildMembership for compatibility with older schemas
export const WEEKLY_QUERY_NO_GUILD = `
  query Weekly($year: Int!, $week: Int!){
    weeklyKillLeaderboard(year: $year, week: $week){
      rank
      kills
      deaths
      character { id name career level renownRank }
    }
  }
`;

export const MONTHLY_QUERY = `
  query Monthly($year: Int!, $month: Int!){
    monthlyKillLeaderboard(year: $year, month: $month){
      rank
      kills
      deaths
      character { id name career level renownRank guildMembership { guild { id name realm } } }
    }
  }
`;

// Fallback without guildMembership for compatibility with older schemas
export const MONTHLY_QUERY_NO_GUILD = `
  query Monthly($year: Int!, $month: Int!){
    monthlyKillLeaderboard(year: $year, month: $month){
      rank
      kills
      deaths
      character { id name career level renownRank }
    }
  }
`;

// Guild leaderboards
export const WEEKLY_GUILD_QUERY = `
  query WeeklyGuild($year: Int!, $week: Int!){
    weeklyGuildKillLeaderboard(year: $year, week: $week){
      rank
      kills
      deaths
      guild { id name realm }
    }
  }
`;

export const MONTHLY_GUILD_QUERY = `
  query MonthlyGuild($year: Int!, $month: Int!){
    monthlyGuildKillLeaderboard(year: $year, month: $month){
      rank
      kills
      deaths
      guild { id name realm }
    }
  }
`;

// Fetch character info by ID (career, level, renownRank)
export async function fetchCharacterInfo(
  id: number | string,
  options?: { signal?: AbortSignal }
): Promise<{ id: string | number; name?: string; career?: string; level?: number; renownRank?: number; guild?: { id?: string | number; name?: string; realm?: string } } | null> {
  const queryWithGuild = `
    query CharacterInfo($id: ID!) {
      character(id: $id) {
        id
        name
        career
        level
        renownRank
        guildMembership { guild { id name realm } }
      }
    }
  `;
  const queryNoGuild = `
    query CharacterInfoNoGuild($id: ID!) {
      character(id: $id) {
        id
        name
        career
        level
        renownRank
      }
    }
  `;
  // Try with guild first; if schema doesn't support it, fall back without guild
  try {
  const data = await gql<any>(queryWithGuild, { id: String(id) }, { signal: options?.signal });
    const c = data?.character;
    if (!c) return null;
  const gm = c.guildMembership;
  const g = gm?.guild;
  return { id: c.id, name: c.name, career: c.career, level: c.level, renownRank: c.renownRank, guild: g ? { id: g.id, name: g.name, realm: g.realm } : undefined };
  } catch {
    try {
      const data = await gql<any>(queryNoGuild, { id: String(id) }, { signal: options?.signal });
      const c = data?.character;
      if (!c) return null;
      return { id: c.id, name: c.name, career: c.career, level: c.level, renownRank: c.renownRank };
    } catch {
      return null;
    }
  }
}

// Try to resolve a character by exact name. Attempts multiple likely schema shapes to be robust.
export async function resolveCharacterByName(name: string, options?: { signal?: AbortSignal }): Promise<{ id: string | number; name: string; career?: string; level?: number; renownRank?: number } | null> {
  const nm = String(name).trim();
  if (!nm) return null;
  // Attempt 1: characters connection with where filter
  const tryCharactersWhere = async () => {
    const q = `
      query FindByName($name: String!) {
        characters(first: 1, where: { name: { eq: $name } }) {
          nodes { id name career level renownRank }
        }
      }
    `;
    const data = await gql<any>(q, { name: nm }, { signal: options?.signal });
    const node = data?.characters?.nodes?.[0];
    if (node?.id) return { id: node.id, name: node.name || nm, career: node.career, level: node.level, renownRank: node.renownRank };
    return null;
  };
  // Attempt 2: characterByName field
  const tryCharacterByName = async () => {
    const q = `
      query FindByName2($name: String!) {
        characterByName(name: $name) { id name career level renownRank }
      }
    `;
    const data = await gql<any>(q, { name: nm }, { signal: options?.signal });
    const node = data?.characterByName;
    if (node?.id) return { id: node.id, name: node.name || nm, career: node.career, level: node.level, renownRank: node.renownRank };
    return null;
  };
  // Attempt 3: characters connection without where, using query arg (fallback API shape)
  const tryCharactersQuery = async () => {
    const q = `
      query FindByName3($name: String!) {
        characters(first: 1, query: $name) { nodes { id name career level renownRank } }
      }
    `;
    const data = await gql<any>(q, { name: nm }, { signal: options?.signal });
    const node = data?.characters?.nodes?.[0];
    if (node?.id) return { id: node.id, name: node.name || nm, career: node.career, level: node.level, renownRank: node.renownRank };
    return null;
  };
  // Try attempts in order; ignore schema errors and continue
  try { const r = await tryCharactersWhere(); if (r) return r; } catch {}
  try { const r = await tryCharacterByName(); if (r) return r; } catch {}
  try { const r = await tryCharactersQuery(); if (r) return r; } catch {}
  return null;
}

// Try to resolve a guild by exact name. Attempts multiple likely schema shapes to be robust.
export async function resolveGuildByName(name: string, options?: { signal?: AbortSignal }): Promise<{ id: string | number; name: string; realm?: string } | null> {
  const nm = String(name).trim();
  if (!nm) return null;
  // Attempt 1: guilds connection with where filter
  const tryGuildsWhere = async () => {
    const q = `
      query FindGuildByName($name: String!) {
        guilds(first: 1, where: { name: { eq: $name } }) {
          nodes { id name realm }
        }
      }
    `;
    const data = await gql<any>(q, { name: nm }, { signal: options?.signal });
    const node = data?.guilds?.nodes?.[0];
    if (node?.id) return { id: node.id, name: node.name || nm, realm: node.realm };
    return null;
  };
  // Attempt 2: guildByName field
  const tryGuildByName = async () => {
    const q = `
      query FindGuildByName2($name: String!) {
        guildByName(name: $name) { id name realm }
      }
    `;
    const data = await gql<any>(q, { name: nm }, { signal: options?.signal });
    const node = data?.guildByName;
    if (node?.id) return { id: node.id, name: node.name || nm, realm: node.realm };
    return null;
  };
  // Attempt 3: guilds connection using query arg
  const tryGuildsQuery = async () => {
    const q = `
      query FindGuildByName3($name: String!) {
        guilds(first: 1, query: $name) { nodes { id name realm } }
      }
    `;
    const data = await gql<any>(q, { name: nm }, { signal: options?.signal });
    const node = data?.guilds?.nodes?.[0];
    if (node?.id) return { id: node.id, name: node.name || nm, realm: node.realm };
    return null;
  };
  try { const r = await tryGuildsWhere(); if (r) return r; } catch {}
  try { const r = await tryGuildByName(); if (r) return r; } catch {}
  try { const r = await tryGuildsQuery(); if (r) return r; } catch {}
  return null;
}

// Fetch lifetime totals for a single character id
export async function fetchLifetimeTotalsFor(id: number | string, options?: { signal?: AbortSignal }): Promise<{ kills: number; deaths: number; kd: number; scenarioWins: number; scenarioLosses: number }> {
  const query = `
    query Lifetime($id: UnsignedInt!, $idStr: ID!){
      byKills: kills(first:1, where:{ killerCharacterId:{ eq:$id } }){ totalCount }
      byDeaths: kills(first:1, where:{ victimCharacterId:{ eq:$id } }){ totalCount }
      wins: scenarios(first:1, characterId: $idStr, wins: true){ totalCount }
      losses: scenarios(first:1, characterId: $idStr, wins: false){ totalCount }
    }
  `;
  const data = await gql<any>(query, { id: Number(id), idStr: String(id) }, { signal: options?.signal });
  const kills = data?.byKills?.totalCount ?? 0;
  const deaths = data?.byDeaths?.totalCount ?? 0;
  const wins = data?.wins?.totalCount ?? 0;
  const losses = data?.losses?.totalCount ?? 0;
  return { kills, deaths, kd: deaths > 0 ? kills / deaths : kills, scenarioWins: wins, scenarioLosses: losses };
}

// Aggregation types
export type Opponent = { id: string | number; name: string; career?: string; count: number; diff?: number };
export type TopGuild = { id: string | number; name: string; count: number; diff?: number; realm?: string };
export type TopCareer = { career: string; count: number; diff?: number };

export async function fetchTopOpponents(
  id: number | string,
  opts: {
    fromIso?: string; toIso?: string; limit?: number; fullScan?: boolean; realm?: 0 | 1;
    includeScenarios?: boolean;
    onProgress?: (p: {
      victims: Opponent[]; killers: Opponent[];
      guildsKilled: TopGuild[]; careersKilled: TopCareer[];
      killersGuilds: TopGuild[]; killersCareers: TopCareer[];
      scenarioStats: { wins: number; losses: number };
      periodStats: { kills: number; deaths: number; kd: number };
      scanned?: { killsNodes: number; deathsNodes: number; killsTotal: number; deathsTotal: number; hitCap: boolean; scenarioPages?: number };
    }) => void;
    signal?: AbortSignal;
  } = {}
): Promise<{
  victims: Opponent[]; killers: Opponent[];
  guildsKilled: TopGuild[]; careersKilled: TopCareer[];
  killersGuilds: TopGuild[]; killersCareers: TopCareer[];
  scenarioStats: { wins: number; losses: number };
  periodStats: { kills: number; deaths: number; kd: number };
  scanned?: { killsNodes: number; deathsNodes: number; killsTotal: number; deathsTotal: number; hitCap: boolean; scenarioPages?: number };
}> {
  const maxList = opts.limit ?? 10;
  const toSeconds = (iso?: string) => (iso ? Math.floor(new Date(iso).getTime() / 1000) : undefined);
  const fromSec = toSeconds(opts.fromIso);
  const toSec = toSeconds(opts.toIso);

  type KDPage = { killsRecent: { nodes: any[]; pageInfo: { hasNextPage: boolean; endCursor?: string }; totalCount: number }; deathsRecent: { nodes: any[]; pageInfo: { hasNextPage: boolean; endCursor?: string }; totalCount: number } };
  async function fetchKDPage(first: number, afterK?: string, afterD?: string, fromOverride?: number, toOverride?: number): Promise<KDPage> {
    const query = `
      query KD($id: UnsignedInt!, $from: Int!, $to: Int!, $first: Int!, $afterK: String, $afterD: String) {
        killsRecent: kills(first: $first, after: $afterK, where: { time: { gte: $from, lte: $to }, killerCharacterId: { eq: $id } }) {
          totalCount
          pageInfo { hasNextPage endCursor }
          nodes { id instance { id } victim { character { id name career } guild { id name realm } } }
        }
        deathsRecent: kills(first: $first, after: $afterD, where: { time: { gte: $from, lte: $to }, victimCharacterId: { eq: $id } }) {
          totalCount
          pageInfo { hasNextPage endCursor }
          nodes { id instance { id } deathblow { id name career } attackers { character { id } guild { id name realm } } }
        }
      }
    `;
  const data = await gql<any>(query, { id: Number(id), from: (fromOverride ?? fromSec) ?? 0, to: (toOverride ?? toSec) ?? Math.floor(Date.now()/1000), first, afterK, afterD }, { signal: opts.signal });
    return {
      killsRecent: { nodes: data?.killsRecent?.nodes || [], pageInfo: data?.killsRecent?.pageInfo || { hasNextPage: false }, totalCount: data?.killsRecent?.totalCount ?? 0 },
      deathsRecent: { nodes: data?.deathsRecent?.nodes || [], pageInfo: data?.deathsRecent?.pageInfo || { hasNextPage: false }, totalCount: data?.deathsRecent?.totalCount ?? 0 }
    };
  }

  const spanMs = (opts.fromIso && opts.toIso) ? (new Date(opts.toIso).getTime() - new Date(opts.fromIso).getTime()) : 0;
  const dayMs = 24 * 3600 * 1000;
  const isLongPeriod = opts.fullScan ? true : (spanMs >= 8 * dayMs);
  const pageCandidates = [100, 50, 25, 10];
  let pageSize = 100;
  let killsRecent: any[] = [], deathsRecent: any[] = [];
  const seenKillIds = new Set<string>();
  const seenDeathIds = new Set<string>();
  let periodKillsTotal = 0, periodDeathsTotal = 0;
  let afterK: string | undefined, afterD: string | undefined;
  let scenarioPagesCounter = 0;
  const enableScenarios = opts.includeScenarios !== false;

  const emitProgress = (overrideScenario?: { wins: number; losses: number }) => {
    try {
      // Character-level maps
      const killsAgainst = new Map<string | number, number>();
      for (const k of killsRecent) { const vc = k?.victim?.character; if (!vc) continue; const key = vc.id; killsAgainst.set(key, (killsAgainst.get(key) || 0) + 1); }
      const deathsFrom = new Map<string | number, number>();
      for (const d of deathsRecent) { const kb = d?.deathblow; if (!kb) continue; const key = kb.id; deathsFrom.set(key, (deathsFrom.get(key) || 0) + 1); }

      // Guild-level maps
      const victimGuildCounts = new Map<string | number, { id: string|number; name: string; count: number; realm?: string }>();
      for (const k of killsRecent) {
        const g = k?.victim?.guild; if (!g) continue; const key = g.id;
        const prev = victimGuildCounts.get(key) || { id: key, name: g.name || 'Unknown Guild', realm: g.realm, count: 0 };
        prev.name = g.name || prev.name;
        prev.realm = g.realm || prev.realm;
        prev.count++; victimGuildCounts.set(key, prev);
      }
      const killerGuildCounts = new Map<string | number, { id: string|number; name: string; count: number; realm?: string }>();
      for (const d of deathsRecent) {
        const kb = d?.deathblow; if (!kb) continue; const attackers: any[] = d?.attackers || [];
        const a = attackers.find(at => String(at?.character?.id) === String(kb.id));
        const g = a?.guild; if (!g) continue; const key = g.id;
        const prev = killerGuildCounts.get(key) || { id: key, name: g.name || 'Unknown Guild', realm: g.realm, count: 0 };
        prev.name = g.name || prev.name;
        prev.realm = g.realm || prev.realm;
        prev.count++; killerGuildCounts.set(key, prev);
      }

      // Career-level maps
      const victimCareerCounts = new Map<string, { career: string; count: number }>();
      for (const k of killsRecent) {
        const c = k?.victim?.character?.career as string|undefined; if (!c) continue;
        const prev = victimCareerCounts.get(c) || { career: c, count: 0 }; prev.count++; victimCareerCounts.set(c, prev);
      }
      const killerCareerCounts = new Map<string, { career: string; count: number }>();
      for (const d of deathsRecent) {
        const c = d?.deathblow?.career as string|undefined; if (!c) continue;
        const prev = killerCareerCounts.get(c) || { career: c, count: 0 }; prev.count++; killerCareerCounts.set(c, prev);
      }
      const victims = Array.from(killsAgainst.entries()).map(([key,cnt]) => {
        const anyKill = killsRecent.find(x => String(x?.victim?.character?.id) === String(key));
        const name = anyKill?.victim?.character?.name || 'Unknown';
        const career = anyKill?.victim?.character?.career;
        const diff = cnt - (deathsFrom.get(key) || 0);
        return { id: key, name, career, count: cnt, diff } as Opponent;
      }).sort((a,b)=> b.count - a.count).slice(0, maxList);
      const killers = Array.from(deathsFrom.entries()).map(([key,cnt]) => {
        const anyDeath = deathsRecent.find(x => String(x?.deathblow?.id) === String(key));
        const name = anyDeath?.deathblow?.name || 'Unknown';
        const career = anyDeath?.deathblow?.career;
        const diff = (killsAgainst.get(key) || 0) - cnt;
        return { id: key, name, career, count: cnt, diff } as Opponent;
      }).sort((a,b)=> b.count - a.count).slice(0, maxList);
      const guildsKilled = (() => {
        return Array.from(victimGuildCounts.values()).map(v => {
          const other = killerGuildCounts.get(v.id)?.count || 0;
          return { id: v.id, name: v.name, count: v.count, diff: v.count - other, realm: v.realm } as TopGuild;
        }).sort((a,b)=>b.count-a.count).slice(0,maxList);
      })();
      const killersGuilds = (() => {
        return Array.from(killerGuildCounts.values()).map(v => {
          const other = victimGuildCounts.get(v.id)?.count || 0;
          return { id: v.id, name: v.name, count: v.count, diff: other - v.count, realm: v.realm } as TopGuild;
        }).sort((a,b)=>b.count-a.count).slice(0,maxList);
      })();
      const careersKilled = (() => {
        return Array.from(victimCareerCounts.values()).map(v => {
          const other = killerCareerCounts.get(v.career)?.count || 0;
          return { career: v.career, count: v.count, diff: v.count - other } as TopCareer;
        }).sort((a,b)=>b.count-a.count).slice(0,maxList);
      })();
      const killersCareers = (() => {
        return Array.from(killerCareerCounts.values()).map(v => {
          const other = victimCareerCounts.get(v.career)?.count || 0;
          return { career: v.career, count: v.count, diff: other - v.count } as TopCareer;
        }).sort((a,b)=>b.count-a.count).slice(0,maxList);
      })();
      const periodStats = { kills: periodKillsTotal, deaths: periodDeathsTotal, kd: periodDeathsTotal>0 ? periodKillsTotal/periodDeathsTotal : periodKillsTotal };
      const scanned = { killsNodes: Math.min(killsRecent.length, Math.max(0, periodKillsTotal||0)), deathsNodes: Math.min(deathsRecent.length, Math.max(0, periodDeathsTotal||0)), killsTotal: periodKillsTotal, deathsTotal: periodDeathsTotal, hitCap: !!opts.fullScan && (spanMs>0) && ((killsRecent.length + deathsRecent.length) < (periodKillsTotal+periodDeathsTotal)), scenarioPages: scenarioPagesCounter };
      // Use current score-based scenario tallies by default; only use an override if explicitly provided.
      const scen = overrideScenario ?? { wins: scenarioWins, losses: scenarioLosses };
      opts.onProgress?.({ victims, killers, guildsKilled, careersKilled, killersGuilds, killersCareers, scenarioStats: scen, periodStats, scanned });
    } catch {}
  };

  // Begin scenario W/L machinery (optional)
  let scenarioWins = 0, scenarioLosses = 0;
  // Also collect scenario ids directly from scenarios(...) for the character in the same window to include runs with zero K/D
  async function collectScenarioIdsFromList(): Promise<Set<string>>{
    const set = new Set<string>();
    if (fromSec == null || toSec == null) return set;
    const idStr = String(id);
    const sizes = [100, 50, 25, 10];
    let after: string | undefined; let pages = 0; let selectedFirst = 25;
    // pick a working page size
    for (const f of sizes){
      try {
        const q = `query TryFirst($id: ID!, $from: Long!, $to: Long!, $first: Int!){ scenarios(first:$first, characterId:$id, from:$from, to:$to){ pageInfo{ hasNextPage endCursor } nodes{ id startTime } } }`;
        await gql<any>(q, { id: idStr, from: Math.floor(fromSec), to: Math.floor(toSec!), first: f }, { signal: opts.signal });
        selectedFirst = f; break;
      } catch(e:any){ const msg=String(e?.message||e).toLowerCase(); if(msg.includes('maximum allowed items')) continue; else throw e; }
    }
    while(pages < 50){
      const q = `query Pick($id: ID!, $from: Long!, $to: Long!, $first: Int!, $after: String){ scenarios(first:$first, after:$after, characterId:$id, from:$from, to:$to){ pageInfo{ hasNextPage endCursor } nodes{ id startTime } } }`;
      const resp = await gql<any>(q, { id: idStr, from: Math.floor(fromSec), to: Math.floor(toSec!), first: selectedFirst, after }, { signal: opts.signal });
      const nodes: Array<{ id?: string; startTime?: number }> = resp?.scenarios?.nodes || [];
      for (const n of nodes){ const sid = String(n?.id||''); if(sid) set.add(sid); }
      const pi = resp?.scenarios?.pageInfo; if(!pi?.hasNextPage || !pi?.endCursor) break; after = pi.endCursor; pages++; scenarioPagesCounter = pages; emitProgress({ wins: scenarioWins, losses: scenarioLosses });
    }
    return set;
  }
  // Scenario details batch fetcher
  async function fetchScenarioBatch(ids: string[]): Promise<Array<{ id: string; points?: any; scoreboardEntries?: any[] }>>{
    if (!ids.length) return [];
    const varDefs = ids.map((_,i)=>`$v${i}: ID!`).join(' ');
    const body = ids.map((_,i)=>`a${i}: scenario(id: $v${i}){ id points scoreboardEntries { team character { id } } }`).join(' ');
    const query = `query Batch(${varDefs}){ ${body} }`;
    const vars: Record<string, any> = {}; ids.forEach((id, i)=> vars[`v${i}`] = id);
    const data = await gql<any>(query, vars, { signal: opts.signal });
    const out: Array<{ id: string; points?: any; scoreboardEntries?: any[] }> = [];
    ids.forEach((_,i)=>{ const key=`a${i}`; const s=data?.[key]; if(s){ out.push({ id: String(s.id||ids[i]), points: s.points, scoreboardEntries: s.scoreboardEntries||[] }); } });
    return out;
  }
  // Helper to process a set of scenario IDs in batches with concurrency; de-duplicates across calls
  const processedScenarioIds = new Set<string>();
  async function processScenarioIds(allIds: string[]) {
    const ids = allIds.filter(id => { const s=String(id); return s && !processedScenarioIds.has(s); });
    if (!ids.length) return;
    const batch = 20;
    const batches: string[][] = [];
    for (let i=0;i<ids.length;i+=batch){ batches.push(ids.slice(i, i+batch)); }
  // track processed batches only if needed for progress metrics (currently unused)
    const concurrency = 8;
    async function runOne(slice: string[]) {
      const infos = await fetchScenarioBatch(slice);
      let wInc = 0, lInc = 0;
      for (const s of infos){
        const sid = String(s.id||''); if (sid) processedScenarioIds.add(sid);
        const pts = Array.isArray(s.points) ? s.points.map((x:any)=> Number(x)) : [];
        if (pts.length < 2 || Number.isNaN(pts[0]) || Number.isNaN(pts[1])) continue;
        const winnerTeam = pts[0] >= pts[1] ? 0 : 1; // 0=Order,1=Destro
        // Determine player's team
        let playerTeam: number | null = null;
        const me = Array.isArray(s.scoreboardEntries) ? s.scoreboardEntries.find((se:any)=> String(se?.character?.id) === String(id)) : null;
        const pt = typeof me?.team === 'number' ? me.team : (typeof me?.team === 'string' ? parseInt(me?.team,10) : NaN);
        if (!Number.isNaN(pt)) playerTeam = pt; else if (typeof opts.realm === 'number') playerTeam = opts.realm;
        if (playerTeam != null){ if (playerTeam === winnerTeam) wInc++; else lInc++; }
      }
  scenarioWins += wInc; scenarioLosses += lInc;
      scenarioPagesCounter += 1; // count batches processed as pages for progress
      emitProgress({ wins: scenarioWins, losses: scenarioLosses });
    }
    let idx = 0;
    const workers: Promise<void>[] = [];
    for (let k=0;k<Math.min(concurrency, batches.length);k++){
      workers.push((async function worker(){
        while (idx < batches.length){
          const my = idx++;
          await runOne(batches[my]);
        }
      })());
    }
    await Promise.all(workers);
  }
  // Kick off list-driven scenario processing immediately if enabled; we'll also add KD-derived IDs later
  const listPromise: Promise<void> = enableScenarios ? (async () => {
    try {
      const fromList = await collectScenarioIdsFromList();
      if (fromList && fromList.size){ await processScenarioIds(Array.from(fromList.values())); }
    } catch(e){ console.warn('Failed to collect scenarios list for score-based W/L', e); }
  })() : Promise.resolve();

  try {
    // For long ranges, split into shards and page concurrently to overcome per-page caps
  const useShards = isLongPeriod && fromSec != null && toSec != null;
  // Dynamic parallelization: for spans > 45 days, segment by month boundaries; otherwise fallback to 3 equal slices.
  let monthlySegments: Array<{ from: number; to: number }> = [];
  let shardCount = 1;
  if (useShards) {
    const spanDays = spanMs / dayMs;
    if (spanDays > 45) {
      const startDate = new Date(fromSec! * 1000);
      const endDate = new Date(toSec! * 1000);
      let cursor = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), 1));
      if (cursor.getTime() < startDate.getTime()) {
        cursor = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), 1));
      }
      while (cursor.getTime() <= endDate.getTime()) {
        const monthStart = Math.max(Math.floor(cursor.getTime()/1000), fromSec!);
        const nextMonth = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth()+1, 1));
        const monthEndDate = new Date(nextMonth.getTime() - 1000); // inclusive last second of month
        const monthEnd = Math.min(Math.floor(monthEndDate.getTime()/1000), toSec!);
        if (monthStart <= monthEnd) monthlySegments.push({ from: monthStart, to: monthEnd });
        cursor = nextMonth;
      }
      shardCount = monthlySegments.length || 1;
    } else {
      shardCount = 3;
    }
  }
    if (shardCount === 1) {
      let firstOk=false, firstErr:any=null;
      for (const f of pageCandidates){
        try {
          const p1 = await fetchKDPage(f);
          for (const n of p1.killsRecent.nodes){ const kid=String(n?.id ?? `${n?.time}|${n?.victim?.character?.id}|${n?.instance?.id}`); if(!seenKillIds.has(kid)){ seenKillIds.add(kid); killsRecent.push(n);} }
          for (const n of p1.deathsRecent.nodes){ const did=String(n?.id ?? `${n?.time}|${n?.deathblow?.id}|${n?.instance?.id}`); if(!seenDeathIds.has(did)){ seenDeathIds.add(did); deathsRecent.push(n);} }
          afterK = p1.killsRecent.pageInfo.endCursor;
          afterD = p1.deathsRecent.pageInfo.endCursor;
          pageSize = f; firstOk=true;
          periodKillsTotal = p1.killsRecent.totalCount ?? killsRecent.length;
          periodDeathsTotal = p1.deathsRecent.totalCount ?? deathsRecent.length;
          emitProgress();
          break;
        } catch(e:any){ const msg=String(e?.message||e).toLowerCase(); if(msg.includes('maximum allowed items per page')||msg.includes('first')||msg.includes('page')){ firstErr=e; continue; } throw e; }
      }
      if(!firstOk && firstErr) throw firstErr;
      if(isLongPeriod){
        const days = Math.max(1, Math.floor(spanMs/dayMs));
        const totals = (periodKillsTotal||0)+(periodDeathsTotal||0);
        const maxNodes = opts.fullScan? Math.min(50000, Math.max(totals+1000, days*200)): Math.min(1200, days*15);
        let hasNextK=!!afterK, hasNextD=!!afterD;
        while(((hasNextK && killsRecent.length < periodKillsTotal) || (hasNextD && deathsRecent.length < periodDeathsTotal)) && (killsRecent.length + deathsRecent.length) < maxNodes){
          const p = await fetchKDPage(pageSize, afterK, afterD);
          if(p.killsRecent.nodes.length){ for (const n of p.killsRecent.nodes){ const kid=String(n?.id ?? `${n?.time}|${n?.victim?.character?.id}|${n?.instance?.id}`); if(!seenKillIds.has(kid)){ seenKillIds.add(kid); killsRecent.push(n);} } }
          if(p.deathsRecent.nodes.length){ for (const n of p.deathsRecent.nodes){ const did=String(n?.id ?? `${n?.time}|${n?.deathblow?.id}|${n?.instance?.id}`); if(!seenDeathIds.has(did)){ seenDeathIds.add(did); deathsRecent.push(n);} } }
          afterK = p.killsRecent.pageInfo.endCursor; afterD = p.deathsRecent.pageInfo.endCursor; hasNextK = !!p.killsRecent.pageInfo.hasNextPage; hasNextD = !!p.deathsRecent.pageInfo.hasNextPage; emitProgress(); if(!p.killsRecent.nodes.length && !p.deathsRecent.nodes.length) break;
        }
      }
    } else {
      // Sharded mode (month-based if available, otherwise equal slices)
      const shards: Array<{ from: number; to: number }> = monthlySegments.length ? monthlySegments : (() => {
        const totalSpan = (toSec! - fromSec!);
        const slice = Math.max(1, Math.floor(totalSpan / shardCount));
        const arr: Array<{ from: number; to: number }> = [];
        for (let i=0;i<shardCount;i++){
          const sFrom = fromSec! + i*slice;
          const sTo = (i===shardCount-1) ? toSec! : (sFrom + slice - 1);
          arr.push({ from: sFrom, to: sTo });
        }
        return arr;
      })();
      const maxShardConcurrency = Math.min(4, shards.length);
      let shardIndex = 0;
      async function runShard(sh: { from: number; to: number }) {
        let localPageSize = 100;
        let localAfterK: string|undefined; let localAfterD: string|undefined;
        let localKillsTotal = 0, localDeathsTotal = 0;
        let localAddedK = 0, localAddedD = 0;
        let firstOk=false, firstErr:any=null;
        for (const f of pageCandidates) {
          try {
            const p1 = await fetchKDPage(f, undefined, undefined, sh.from, sh.to);
            for (const n of p1.killsRecent.nodes){ const kid=String(n?.id ?? `${n?.time}|${n?.victim?.character?.id}|${n?.instance?.id}`); if(!seenKillIds.has(kid)){ seenKillIds.add(kid); killsRecent.push(n); localAddedK++; } }
            for (const n of p1.deathsRecent.nodes){ const did=String(n?.id ?? `${n?.time}|${n?.deathblow?.id}|${n?.instance?.id}`); if(!seenDeathIds.has(did)){ seenDeathIds.add(did); deathsRecent.push(n); localAddedD++; } }
            localAfterK = p1.killsRecent.pageInfo.endCursor;
            localAfterD = p1.deathsRecent.pageInfo.endCursor;
            localPageSize = f; firstOk=true;
            localKillsTotal = p1.killsRecent.totalCount ?? 0;
            localDeathsTotal = p1.deathsRecent.totalCount ?? 0;
            periodKillsTotal += localKillsTotal;
            periodDeathsTotal += localDeathsTotal;
            emitProgress();
            break;
          } catch(e:any){ const msg=String(e?.message||e).toLowerCase(); if(msg.includes('maximum allowed items per page')||msg.includes('first')||msg.includes('page')){ firstErr=e; continue; } throw e; }
        }
        if(!firstOk && firstErr) throw firstErr;
        const shardSpanMs = (sh.to - sh.from) * 1000;
        const days = Math.max(1, Math.floor(shardSpanMs/dayMs));
        const totals = (localKillsTotal||0)+(localDeathsTotal||0);
        const maxNodesLocal = opts.fullScan? Math.min(50000, Math.max(totals+1000, days*200)): Math.min(1200, days*15);
        let hasNextK=!!localAfterK, hasNextD=!!localAfterD;
        while(((hasNextK && localAddedK < (localKillsTotal||0)) || (hasNextD && localAddedD < (localDeathsTotal||0))) && ((localAddedK + localAddedD) < maxNodesLocal)){
          const p = await fetchKDPage(localPageSize, localAfterK, localAfterD, sh.from, sh.to);
          if(p.killsRecent.nodes.length){
            for (const n of p.killsRecent.nodes){
              const kid=String(n?.id ?? `${n?.time}|${n?.victim?.character?.id}|${n?.instance?.id}`);
              if(!seenKillIds.has(kid)){ seenKillIds.add(kid); killsRecent.push(n); localAddedK++; }
            }
          }
          if(p.deathsRecent.nodes.length){
            for (const n of p.deathsRecent.nodes){
              const did=String(n?.id ?? `${n?.time}|${n?.deathblow?.id}|${n?.instance?.id}`);
              if(!seenDeathIds.has(did)){ seenDeathIds.add(did); deathsRecent.push(n); localAddedD++; }
            }
          }
          localAfterK = p.killsRecent.pageInfo.endCursor; localAfterD = p.deathsRecent.pageInfo.endCursor; hasNextK = !!p.killsRecent.pageInfo.hasNextPage; hasNextD = !!p.deathsRecent.pageInfo.hasNextPage; emitProgress(); if(!p.killsRecent.nodes.length && !p.deathsRecent.nodes.length) break;
        }
      }
      const shardWorkers: Promise<void>[] = [];
      for (let c=0;c<maxShardConcurrency;c++){
        shardWorkers.push((async function worker(){
          while (shardIndex < shards.length){
            const myIdx = shardIndex++;
            await runShard(shards[myIdx]);
          }
        })());
      }
      await Promise.all(shardWorkers);
    }
  } catch{ killsRecent = killsRecent||[]; deathsRecent = deathsRecent||[]; }

  if (enableScenarios) {
    const scenarioTally = new Map<string,{kills:number;deaths:number}>();
    for (const k of killsRecent){ const iid=String(k?.instance?.id||''); if(!iid) continue; const cur=scenarioTally.get(iid)||{kills:0,deaths:0}; cur.kills++; scenarioTally.set(iid,cur);} 
    for (const d of deathsRecent){ const iid=String(d?.instance?.id||''); if(!iid) continue; const cur=scenarioTally.get(iid)||{kills:0,deaths:0}; cur.deaths++; scenarioTally.set(iid,cur);} 
    // possible fallback W/L by KD-only per-instance omitted as unused
  }

  // Compute scenario W/L strictly from scenario scores.
  // New: run work concurrently. We'll (a) start collecting scenario IDs from the list immediately,
  // and (b) fetch KD pages in parallel. When either source yields IDs, we'll batch-fetch
  // scenario details and update W/L progressively.
  const instanceIds = new Set<string>();
  if (enableScenarios) {
    for (const k of killsRecent){ const iid=String(k?.instance?.id||''); if(iid) instanceIds.add(iid); }
    for (const d of deathsRecent){ const iid=String(d?.instance?.id||''); if(iid) instanceIds.add(iid); }
  }
  // Also collect scenario ids directly from scenarios(...) for the character in the same window to include runs with zero K/D

  // After KD paging has completed, include any scenario instance ids observed only in KD events
  if (enableScenarios) {
    try {
      const kdIds = Array.from(instanceIds.values());
      await processScenarioIds(kdIds);
    } catch(e) { console.warn('Processing KD-derived scenario IDs failed', e); }
    // Make sure list-driven processing had a chance to finish
    try { await listPromise; } catch { /* noop */ }
  }

  const killsNodes = Math.min(killsRecent.length, Math.max(0, periodKillsTotal||0));
  const deathsNodes = Math.min(deathsRecent.length, Math.max(0, periodDeathsTotal||0));
  const totals = (periodKillsTotal||0)+(periodDeathsTotal||0);
  const hitCap = !!opts.fullScan && (spanMs>0) && ((killsNodes+deathsNodes) < totals);

  const countVictims = () => {
    const killsAgainst = new Map<string|number,number>(); for(const k of killsRecent){ const vc=k?.victim?.character; if(!vc) continue; const key=vc.id; killsAgainst.set(key,(killsAgainst.get(key)||0)+1); }
    const deathsFrom = new Map<string|number,number>(); for(const d of deathsRecent){ const kb=d?.deathblow; if(!kb) continue; const key=kb.id; deathsFrom.set(key,(deathsFrom.get(key)||0)+1); }
    const arr: Opponent[] = []; for(const [key,cnt] of killsAgainst.entries()){ const anyKill=killsRecent.find(x=>String(x?.victim?.character?.id)===String(key)); const name=anyKill?.victim?.character?.name||'Unknown'; const career=anyKill?.victim?.character?.career; const diff=cnt-(deathsFrom.get(key)||0); arr.push({ id:key, name, career, count:cnt, diff}); } return arr.sort((a,b)=>b.count-a.count).slice(0,maxList);
  };
  const countKillers = () => {
    const deathsFrom = new Map<string|number,number>(); for(const d of deathsRecent){ const kb=d?.deathblow; if(!kb) continue; const key=kb.id; deathsFrom.set(key,(deathsFrom.get(key)||0)+1); }
    const killsAgainst = new Map<string|number,number>(); for(const k of killsRecent){ const vc=k?.victim?.character; if(!vc) continue; const key=vc.id; killsAgainst.set(key,(killsAgainst.get(key)||0)+1); }
    const arr: Opponent[] = []; for(const [key,cnt] of deathsFrom.entries()){ const anyDeath=deathsRecent.find(x=>String(x?.deathblow?.id)===String(key)); const name=anyDeath?.deathblow?.name||'Unknown'; const career=anyDeath?.deathblow?.career; const diff=(killsAgainst.get(key)||0)-cnt; arr.push({ id:key, name, career, count:cnt, diff}); } return arr.sort((a,b)=>b.count-a.count).slice(0,maxList);
  };
  const countVictimGuilds = () => { const m=new Map<string|number,TopGuild>(); for(const k of killsRecent){ const g=k?.victim?.guild; if(!g) continue; const key=g.id; const cur=m.get(key)||{id:key,name:g.name||'Unknown Guild',count:0}; cur.count++; m.set(key,cur);} return Array.from(m.values()).sort((a,b)=>b.count-a.count).slice(0,maxList); };
  const countVictimCareers = () => { const m=new Map<string,TopCareer>(); for(const k of killsRecent){ const c=k?.victim?.character?.career as string|undefined; if(!c) continue; const cur=m.get(c)||{career:c,count:0}; cur.count++; m.set(c,cur);} return Array.from(m.values()).sort((a,b)=>b.count-a.count).slice(0,maxList); };
  const countKillerGuilds = () => { const m: Map<any, any> = new Map(); for(const d of deathsRecent){ const kb=d?.deathblow; if(!kb) continue; const attackers: any[] = d?.attackers || []; const a=attackers.find(at=>String(at?.character?.id)===String(kb.id)); const g=a?.guild; if(!g) continue; const key=g.id; let cur=m.get(key); if(!cur){ cur={ id:key, name:g.name||'Unknown Guild', count:0 }; m.set(key,cur);} cur.count++; } return Array.from(m.values()).sort((a,b)=>b.count-a.count).slice(0,maxList); };
  const countKillerCareers = () => { const m=new Map<string,TopCareer>(); for(const d of deathsRecent){ const kb=d?.deathblow; if(!kb) continue; const c=kb.career as string|undefined; if(!c) continue; const cur=m.get(c)||{career:c,count:0}; cur.count++; m.set(c,cur);} return Array.from(m.values()).sort((a,b)=>b.count-a.count).slice(0,maxList); };

  return {
    victims: countVictims(),
    killers: countKillers(),
    guildsKilled: countVictimGuilds(),
    careersKilled: countVictimCareers(),
    killersGuilds: countKillerGuilds(),
    killersCareers: countKillerCareers(),
    scenarioStats: { wins: scenarioWins, losses: scenarioLosses },
    periodStats: { kills: periodKillsTotal, deaths: periodDeathsTotal, kd: periodDeathsTotal>0 ? periodKillsTotal/periodDeathsTotal : periodKillsTotal },
    scanned: { killsNodes, deathsNodes, killsTotal: periodKillsTotal, deathsTotal: periodDeathsTotal, hitCap, scenarioPages: scenarioPagesCounter }
  };
}

// Guild-focused version of top opponents within a time window
export async function fetchTopOpponentsForGuild(
  id: number | string,
  opts: {
    fromIso?: string; toIso?: string; limit?: number; fullScan?: boolean;
    onProgress?: (p: {
      victims: Opponent[]; killers: Opponent[];
      guildsKilled: TopGuild[]; careersKilled: TopCareer[];
      killersGuilds: TopGuild[]; killersCareers: TopCareer[];
      memberKillers: Opponent[]; memberDeaths: Opponent[];
      periodStats: { kills: number; deaths: number; kd: number };
      scanned?: { killsNodes: number; killsTotal: number; deathsNodes: number; deathsTotal: number; hitCap?: boolean };
    }) => void;
    signal?: AbortSignal;
  } = {}
): Promise<{
  victims: Opponent[]; killers: Opponent[];
  guildsKilled: TopGuild[]; careersKilled: TopCareer[];
  killersGuilds: TopGuild[]; killersCareers: TopCareer[];
  memberKillers: Opponent[]; memberDeaths: Opponent[];
  periodStats: { kills: number; deaths: number; kd: number };
  scanned?: { killsNodes: number; killsTotal: number; deathsNodes: number; deathsTotal: number; hitCap?: boolean };
}> {
  const maxList = opts.limit ?? 10;
  const toSeconds = (iso?: string) => (iso ? Math.floor(new Date(iso).getTime() / 1000) : undefined);
  const fromSec = toSeconds(opts.fromIso);
  const toSec = toSeconds(opts.toIso);

  type KDPage = { killsRecent: { nodes: any[]; pageInfo: { hasNextPage: boolean; endCursor?: string }; totalCount: number }; deathsRecent: { nodes: any[]; pageInfo: { hasNextPage: boolean; endCursor?: string }; totalCount: number } };
  async function fetchKDPage(first: number, afterK?: string, afterD?: string): Promise<KDPage> {
    const query = `
      query KD($id: UnsignedInt!, $from: Int!, $to: Int!, $first: Int!, $afterK: String, $afterD: String) {
        killsRecent: kills(first: $first, after: $afterK, where: { time: { gte: $from, lte: $to }, killerGuildId: { eq: $id } }) {
          totalCount
          pageInfo { hasNextPage endCursor }
          nodes { id instance { id } deathblow { id name career } attackers { character { id } guild { id name realm } } victim { character { id name career } guild { id name realm } } }
        }
        deathsRecent: kills(first: $first, after: $afterD, where: { time: { gte: $from, lte: $to }, victimGuildId: { eq: $id } }) {
          totalCount
          pageInfo { hasNextPage endCursor }
          nodes { id instance { id } deathblow { id name career } victim { character { id name career } } attackers { character { id } guild { id name realm } } }
        }
      }
    `;
    const data = await gql<any>(query, { id: Number(id), from: Math.floor(fromSec ?? 0), to: Math.floor(toSec ?? Date.now()/1000), first, afterK, afterD }, { signal: opts.signal });
    return {
      killsRecent: { nodes: data?.killsRecent?.nodes || [], pageInfo: data?.killsRecent?.pageInfo || { hasNextPage: false }, totalCount: data?.killsRecent?.totalCount ?? 0 },
      deathsRecent: { nodes: data?.deathsRecent?.nodes || [], pageInfo: data?.deathsRecent?.pageInfo || { hasNextPage: false }, totalCount: data?.deathsRecent?.totalCount ?? 0 }
    };
  }

  const pageCandidates = [100, 50, 25, 10];
  let pageSize = 100;
  let killsRecent: any[] = [], deathsRecent: any[] = [];
  const seenKillIds = new Set<string>();
  const seenDeathIds = new Set<string>();
  let periodKillsTotal = 0, periodDeathsTotal = 0;
  let afterK: string | undefined, afterD: string | undefined;

  // pick a working page size
  let firstOk=false, firstErr:any=null;
  for (const f of pageCandidates) {
    try {
      const p1 = await fetchKDPage(f);
      for (const n of p1.killsRecent.nodes){ const kid=String(n?.id ?? `${n?.time}|${n?.victim?.character?.id}|${n?.instance?.id}`); if(!seenKillIds.has(kid)){ seenKillIds.add(kid); killsRecent.push(n);} }
      for (const n of p1.deathsRecent.nodes){ const did=String(n?.id ?? `${n?.time}|${n?.deathblow?.id}|${n?.instance?.id}`); if(!seenDeathIds.has(did)){ seenDeathIds.add(did); deathsRecent.push(n);} }
      afterK = p1.killsRecent.pageInfo.endCursor;
      afterD = p1.deathsRecent.pageInfo.endCursor;
      pageSize = f; firstOk=true;
      periodKillsTotal = p1.killsRecent.totalCount ?? killsRecent.length;
      periodDeathsTotal = p1.deathsRecent.totalCount ?? deathsRecent.length;
      break;
    } catch(e:any){ const msg=String(e?.message||e).toLowerCase(); if(msg.includes('maximum allowed items per page')||msg.includes('first')||msg.includes('page')){ firstErr=e; continue; } throw e; }
  }
  if(!firstOk && firstErr) throw firstErr;

  let hasNextK=!!afterK, hasNextD=!!afterD;
  while((hasNextK && killsRecent.length < periodKillsTotal) || (hasNextD && deathsRecent.length < periodDeathsTotal)){
    const p = await fetchKDPage(pageSize, afterK, afterD);
    if(p.killsRecent.nodes.length){ for (const n of p.killsRecent.nodes){ const kid=String(n?.id ?? `${n?.time}|${n?.victim?.character?.id}|${n?.instance?.id}`); if(!seenKillIds.has(kid)){ seenKillIds.add(kid); killsRecent.push(n);} } }
    if(p.deathsRecent.nodes.length){ for (const n of p.deathsRecent.nodes){ const did=String(n?.id ?? `${n?.time}|${n?.deathblow?.id}|${n?.instance?.id}`); if(!seenDeathIds.has(did)){ seenDeathIds.add(did); deathsRecent.push(n);} } }
    afterK = p.killsRecent.pageInfo.endCursor; afterD = p.deathsRecent.pageInfo.endCursor; hasNextK = !!p.killsRecent.pageInfo.hasNextPage; hasNextD = !!p.deathsRecent.pageInfo.hasNextPage;
    // Progressive emission
    try {
      if (opts.onProgress) {
        const partial = buildAggregates(killsRecent, deathsRecent);
        opts.onProgress({ ...partial, scanned: { killsNodes: killsRecent.length, killsTotal: periodKillsTotal, deathsNodes: deathsRecent.length, deathsTotal: periodDeathsTotal, hitCap: !(hasNextK||hasNextD) } });
      }
    } catch {}
  }

  function buildAggregates(killsArr: any[], deathsArr: any[]) {
    const killsAgainst = new Map<string | number, number>();
    for (const k of killsArr) { const vc = k?.victim?.character; if (!vc) continue; const key = vc.id; killsAgainst.set(key, (killsAgainst.get(key) || 0) + 1); }
    const deathsFrom = new Map<string | number, number>();
    for (const d of deathsArr) { const kb = d?.deathblow; if (!kb) continue; const key = kb.id; deathsFrom.set(key, (deathsFrom.get(key) || 0) + 1); }
    // Member tallies (by deathblow for kills, by victim for deaths)
    const memberKillCounts = new Map<string | number, { id: string|number; name: string; career?: string; count: number }>();
    const guildIdStr = String(id);
    for (const k of killsArr) {
      const db = k?.deathblow; if (!db) continue;
      const attackers: any[] = k?.attackers || [];
      const a = attackers.find((at: any) => String(at?.character?.id) === String(db.id));
      const gid = a?.guild?.id;
      if (String(gid) !== guildIdStr) continue; // ensure only this guild's members
      const key = db.id;
      const prev = memberKillCounts.get(key) || { id: key, name: db.name || 'Unknown', career: db.career, count: 0 };
      prev.name = db.name || prev.name; prev.career = db.career || prev.career; prev.count++;
      memberKillCounts.set(key, prev);
    }
    const memberDeathCounts = new Map<string | number, { id: string|number; name: string; career?: string; count: number }>();
    for (const d of deathsArr) { const vc = d?.victim?.character; if (!vc) continue; const key = vc.id; const prev = memberDeathCounts.get(key) || { id: key, name: vc.name || 'Unknown', career: vc.career, count: 0 }; prev.name = vc.name || prev.name; prev.career = vc.career || prev.career; prev.count++; memberDeathCounts.set(key, prev); }
    const victimGuildCounts = new Map<string | number, { id: string|number; name: string; count: number; realm?: string }>();
    for (const k of killsArr) { const g = k?.victim?.guild; if (!g) continue; const key = g.id; const prev = victimGuildCounts.get(key) || { id: key, name: g.name || 'Unknown Guild', realm: g.realm, count: 0 }; prev.name=g.name||prev.name; prev.realm=g.realm||prev.realm; prev.count++; victimGuildCounts.set(key, prev); }
    const killerGuildCounts = new Map<string | number, { id: string|number; name: string; count: number; realm?: string }>();
    for (const d of deathsArr) { const kb = d?.deathblow; if (!kb) continue; const attackers: any[] = d?.attackers || []; const a = attackers.find(at => String(at?.character?.id) === String(kb.id)); const g = a?.guild; if (!g) continue; const key = g.id; const prev = killerGuildCounts.get(key) || { id: key, name: g.name || 'Unknown Guild', realm: g.realm, count: 0 }; prev.name=g.name||prev.name; prev.realm=g.realm||prev.realm; prev.count++; killerGuildCounts.set(key, prev); }
    const victimCareerCounts = new Map<string, { career: string; count: number }>();
    for (const k of killsArr) { const c = k?.victim?.character?.career as string|undefined; if (!c) continue; const prev = victimCareerCounts.get(c) || { career: c, count: 0 }; prev.count++; victimCareerCounts.set(c, prev); }
    const killerCareerCounts = new Map<string, { career: string; count: number }>();
    for (const d of deathsArr) { const c = d?.deathblow?.career as string|undefined; if (!c) continue; const prev = killerCareerCounts.get(c) || { career: c, count: 0 }; prev.count++; killerCareerCounts.set(c, prev); }
    const victims: Opponent[] = Array.from(killsAgainst.entries()).map(([key,cnt]) => {
      const anyKill = killsArr.find(x => String(x?.victim?.character?.id) === String(key));
      const name = anyKill?.victim?.character?.name || 'Unknown';
      const career = anyKill?.victim?.character?.career;
      const diff = cnt - (deathsFrom.get(key) || 0);
      return { id: key, name, career, count: cnt, diff } as Opponent;
    }).sort((a,b)=> b.count - a.count).slice(0, maxList);
    const killers: Opponent[] = Array.from(deathsFrom.entries()).map(([key,cnt]) => {
      const anyDeath = deathsArr.find(x => String(x?.deathblow?.id) === String(key));
      const name = anyDeath?.deathblow?.name || 'Unknown';
      const career = anyDeath?.deathblow?.career;
      const diff = (killsAgainst.get(key) || 0) - cnt;
      return { id: key, name, career, count: cnt, diff } as Opponent;
    }).sort((a,b)=> b.count - a.count).slice(0, maxList);
    const guildsKilled: TopGuild[] = Array.from(victimGuildCounts.values()).map(v => {
      const other = killerGuildCounts.get(v.id)?.count || 0;
      return { id: v.id, name: v.name, count: v.count, diff: v.count - other, realm: v.realm };
    }).sort((a,b)=>b.count-a.count).slice(0,maxList);
    const killersGuilds: TopGuild[] = Array.from(killerGuildCounts.values()).map(v => {
      const other = victimGuildCounts.get(v.id)?.count || 0;
      return { id: v.id, name: v.name, count: v.count, diff: other - v.count, realm: v.realm };
    }).sort((a,b)=>b.count-a.count).slice(0,maxList);
    const careersKilled: TopCareer[] = Array.from(victimCareerCounts.values()).map(v => {
      const other = killerCareerCounts.get(v.career)?.count || 0;
      return { career: v.career, count: v.count, diff: v.count - other };
    }).sort((a,b)=>b.count-a.count).slice(0,maxList);
    const killersCareers: TopCareer[] = Array.from(killerCareerCounts.values()).map(v => {
      const other = victimCareerCounts.get(v.career)?.count || 0;
      return { career: v.career, count: v.count, diff: other - v.count };
    }).sort((a,b)=>b.count-a.count).slice(0,maxList);
    const memberKillers: Opponent[] = Array.from(memberKillCounts.values()).map(v => ({ id: v.id, name: v.name, career: v.career, count: v.count } as Opponent)).sort((a,b)=>b.count-a.count).slice(0, maxList);
    const memberDeaths: Opponent[] = Array.from(memberDeathCounts.values()).map(v => ({ id: v.id, name: v.name, career: v.career, count: v.count } as Opponent)).sort((a,b)=>b.count-a.count).slice(0, maxList);
    return { victims, killers, guildsKilled, careersKilled, killersGuilds, killersCareers, memberKillers, memberDeaths, periodStats: { kills: periodKillsTotal, deaths: periodDeathsTotal, kd: periodDeathsTotal>0 ? periodKillsTotal/periodDeathsTotal : periodKillsTotal } };
  }
  const finalAgg = buildAggregates(killsRecent, deathsRecent);
  return { ...finalAgg, scanned: { killsNodes: killsRecent.length, killsTotal: periodKillsTotal, deathsNodes: deathsRecent.length, deathsTotal: periodDeathsTotal } };
}

// Lightweight totals-only fetch for a character within a [from,to] seconds window.
export async function fetchKdTotalsForRange(id: number | string, fromSec: number, toSec: number, options?: { signal?: AbortSignal }): Promise<{ kills: number; deaths: number }> {
  const query = `
    query KdTotals($id: UnsignedInt!, $from: Int!, $to: Int!) {
      k: kills(first: 1, where: { time: { gte: $from, lte: $to }, killerCharacterId: { eq: $id } }) { totalCount }
      d: kills(first: 1, where: { time: { gte: $from, lte: $to }, victimCharacterId: { eq: $id } }) { totalCount }
    }
  `;
  const data = await gql<any>(query, { id: Number(id), from: Math.floor(fromSec), to: Math.floor(toSec) }, { signal: options?.signal });
  return { kills: data?.k?.totalCount ?? 0, deaths: data?.d?.totalCount ?? 0 };
}

// Fetch lifetime solo kills for a character (across all time)
export async function fetchLifetimeSoloKills(id: number | string, options?: { signal?: AbortSignal }): Promise<number> {
  const query = `
    query LifetimeSolo($id: UnsignedInt!) {
      s: kills(first: 1, soloOnly: true, where: { killerCharacterId: { eq: $id } }) { totalCount }
    }
  `;
  const data = await gql<any>(query, { id: Number(id) }, { signal: options?.signal });
  return data?.s?.totalCount ?? 0;
}
