export type Character = { id?: string | number; name?: string; career?: string; level?: number; renownRank?: number };
export type Row = { rank: number; kills: number; deaths: number; character?: Character };
export type LifetimeStats = { kills: number; deaths: number; kd: number };

export function careerLabel(s?: string) {
  return (s || '').replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

export function kdOf(row: { kills: number; deaths: number }) {
  return row.deaths > 0 ? row.kills / row.deaths : row.kills;
}

export type SortField = 'name' | 'kills' | 'deaths' | 'kd' | 'allKills' | 'allDeaths' | 'allKd';
export type SortDir = 'asc' | 'desc';

export function sortRows(baseRows: Row[], sortField: SortField, sortDir: SortDir, lifetimeGetter: (r: Row) => LifetimeStats) {
  const rows = baseRows.slice();
  const dir = sortDir === 'asc' ? 1 : -1;
  rows.sort((a, b) => {
    if (sortField === 'name') {
      const an = (a.character?.name || '').toLowerCase();
      const bn = (b.character?.name || '').toLowerCase();
      const ndir = sortDir === 'desc' ? 1 : -1;
      if (an !== bn) return (an < bn ? -1 : 1) * ndir;
      const killDiff = b.kills - a.kills;
      if (killDiff !== 0) return killDiff;
      return a.deaths - b.deaths;
    }
    if (sortField === 'kills') {
      if (sortDir === 'desc') {
        if (b.kills !== a.kills) return b.kills - a.kills;
        return a.deaths - b.deaths;
      } else {
        if (a.kills !== b.kills) return a.kills - b.kills;
        return a.deaths - b.deaths;
      }
    }
    let av: number, bv: number;
    if (sortField === 'deaths') { av = a.deaths; bv = b.deaths; }
    else if (sortField === 'kd') { av = kdOf(a); bv = kdOf(b); }
    else if (sortField === 'allKills') { av = lifetimeGetter(a).kills; bv = lifetimeGetter(b).kills; }
    else if (sortField === 'allDeaths') { av = lifetimeGetter(a).deaths; bv = lifetimeGetter(b).deaths; }
    else if (sortField === 'allKd') { av = lifetimeGetter(a).kd; bv = lifetimeGetter(b).kd; }
    else { av = 0; bv = 0; }

    if (av === bv) {
      const killDiff = b.kills - a.kills;
      if (killDiff !== 0) return killDiff;
      return a.deaths - b.deaths;
    }
    return (av > bv ? 1 : -1) * dir;
  });
  return rows;
}

// Period bounds helpers
export function isoWeekStartUTC(year: number, week: number): Date {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dayOfWeek = (jan4.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  const mondayWeek1 = new Date(jan4);
  mondayWeek1.setUTCDate(jan4.getUTCDate() - dayOfWeek);
  const d = new Date(mondayWeek1);
  d.setUTCDate(mondayWeek1.getUTCDate() + (week - 1) * 7);
  return d;
}

export function monthStartUTC(year: number, month1: number): Date {
  return new Date(Date.UTC(year, month1 - 1, 1, 0, 0, 0));
}

export function getPeriodBounds(period: 'weekly'|'monthly', ctx: { weeklyYear: number; weeklyWeek: number; monthlyYear: number; monthlyMonth: number }): { fromIso: string; toIso: string } {
  if (period === 'weekly') {
    const from = isoWeekStartUTC(ctx.weeklyYear, ctx.weeklyWeek);
    const to = new Date(from); to.setUTCDate(from.getUTCDate() + 7);
    return { fromIso: from.toISOString(), toIso: to.toISOString() };
  }
  if (period === 'monthly') {
    const from = monthStartUTC(ctx.monthlyYear, ctx.monthlyMonth);
    const to = monthStartUTC(ctx.monthlyYear + Math.floor(ctx.monthlyMonth / 12), ((ctx.monthlyMonth % 12) + 1));
    return { fromIso: from.toISOString(), toIso: to.toISOString() };
  }
  // Default fallback (should not happen): return monthly bounds for safety
  const from = monthStartUTC(ctx.monthlyYear, ctx.monthlyMonth);
  const to = monthStartUTC(ctx.monthlyYear + Math.floor(ctx.monthlyMonth / 12), ((ctx.monthlyMonth % 12) + 1));
  return { fromIso: from.toISOString(), toIso: to.toISOString() };
}
