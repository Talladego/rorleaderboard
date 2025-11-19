import { careerLabel, kdOf, Row, LifetimeStats, SortDir, SortField } from '../logic';

function careerIconKey(career?: string) {
  if (!career) return '';
  const raw = String(career).toLowerCase();
  const exceptions: Record<string, string> = {
    'iron_breaker': 'ironbreaker'
  };
  return exceptions[raw] ?? raw.replace(/_/g, '-');
}

function realmIcon(realm?: string) {
  const r = String(realm || '').toUpperCase();
  if (r === 'ORDER') return '<img class="career-icon" loading="lazy" src="https://killboard.returnofreckoning.com/images/icons/scenario/order.png" alt="Order" />';
  if (r === 'DESTRUCTION') return '<img class="career-icon" loading="lazy" src="https://killboard.returnofreckoning.com/images/icons/scenario/destruction.png" alt="Destruction" />';
  return '';
}

export function renderRows(rows: Row[], tbody: HTMLElement, opts?: { clickableNames?: boolean; mode?: 'players'|'guilds' }) {
  tbody.innerHTML = '';
  const isPlayersBoard = opts?.mode !== 'guilds';

  // Top-3 by kills grouped by identical (kills|deaths)
  const byKills = rows.slice().sort((a, b) => {
    if (b.kills !== a.kills) return b.kills - a.kills;
    if (a.deaths !== b.deaths) return a.deaths - b.deaths;
    const an = (a.character?.name || '').toLowerCase();
    const bn = (b.character?.name || '').toLowerCase();
    if (an < bn) return -1; if (an > bn) return 1; return 0;
  });
  const groupPlacement = new Map<string, number>();
  for (let i = 0; i < byKills.length && groupPlacement.size < 3; i++) {
    const key = `${byKills[i].kills}|${byKills[i].deaths}`;
    if (!groupPlacement.has(key)) groupPlacement.set(key, groupPlacement.size + 1);
  }

  // KDR leaders: treat 0 deaths + kills > 0 as Infinity. Ties share by normalized fraction; break by more kills.
  const gcd = (a: number, b: number) => { a = Math.abs(a|0); b = Math.abs(b|0); while (b !== 0) { const t = a % b; a = b; b = t; } return a || 1; };
  const kdNormKey = (r: Row): string => {
    const k = r.kills|0; const d = r.deaths|0;
    if (d <= 0) return `z:${k}`;
    const g = gcd(k, d);
    return `f:${(k/g)|0}/${(d/g)|0}`;
  };
  const byKd = rows.slice().sort((a, b) => {
    const ak = a.deaths > 0 ? a.kills / a.deaths : (a.kills > 0 ? Number.POSITIVE_INFINITY : 0);
    const bk = b.deaths > 0 ? b.kills / b.deaths : (b.kills > 0 ? Number.POSITIVE_INFINITY : 0);
    if (bk !== ak) return bk - ak;
    if (b.kills !== a.kills) return b.kills - a.kills;
    const an = (a.character?.name || '').toLowerCase();
    const bn = (b.character?.name || '').toLowerCase();
    if (an < bn) return -1; if (an > bn) return 1; return 0;
  });
  const topKdNormKey = byKd.length ? kdNormKey(byKd[0]) : undefined;
  const topKdKills = byKd.length ? byKd[0].kills : undefined;

  // Deaths leaders: most deaths; among those, lowest kills
  const byDeaths = rows.slice().sort((a, b) => {
    if (b.deaths !== a.deaths) return b.deaths - a.deaths;
    if (a.kills !== b.kills) return a.kills - b.kills; // ascending kills for tie-break among top deaths
    const an = (a.character?.name || '').toLowerCase();
    const bn = (b.character?.name || '').toLowerCase();
    if (an < bn) return -1; if (an > bn) return 1; return 0;
  });
  const topDeathsVal = byDeaths.length ? byDeaths[0].deaths : undefined;
  const minKillsAtTopDeaths = (() => {
    if (topDeathsVal == null) return undefined as number | undefined;
    let mk: number | undefined;
    for (const r of byDeaths) {
      if (r.deaths !== topDeathsVal) break;
      if (mk == null || r.kills < mk) mk = r.kills;
    }
    return mk;
  })();

  rows.forEach((r) => {
    const tr = document.createElement('tr');
    if (r.character?.id) tr.setAttribute('data-id', String(r.character.id));

    const kd = kdOf(r);
    const kdText = (kd === Number.POSITIVE_INFINITY) ? '∞' : kd.toFixed(2);
    const clickable = opts?.clickableNames !== false;
    const placement = groupPlacement.get(`${r.kills}|${r.deaths}`);
    const isKdLeader = !!(topKdNormKey && topKdKills != null && kdNormKey(r) === topKdNormKey && r.kills === topKdKills);
    const isDeathsLeader = !!(topDeathsVal != null && minKillsAtTopDeaths != null && r.deaths === topDeathsVal && r.kills === minKillsAtTopDeaths);

    const iconHtml = (opts?.mode === 'guilds')
      ? realmIcon(r.character?.realm)
      : (r.character?.career ? `<img class="career-icon" loading="lazy" src="https://killboard.returnofreckoning.com/images/icons/${careerIconKey(r.character.career)}.png" alt="${careerLabel(r.character.career)}" onerror="this.onerror=null;this.src='/icons/careers/${careerIconKey(r.character.career)}.png';" />` : '');
    const origName = r.character?.name || 'Unknown';
    const dispName = origName;
    const guild = (r.character as any)?.guildMembership?.guild ?? (r.character as any)?.guild;
    const guildCell = (opts?.mode !== 'guilds' && guild && (guild.name || guild.id))
      ? `<span class="char-cell">${realmIcon(guild.realm)}<a href="#" class="open-guild-from-row guild-name" data-guild-id="${guild.id ?? ''}" data-guild-name="${guild.name ?? 'Guild'}"${guild.realm ? ` data-guild-realm="${guild.realm}"` : ''}>${guild.name ?? 'Guild'}</a></span>`
      : '';
    const levelPart = r.character?.level != null ? `Lvl <span class="num-val">${r.character.level}</span>` : '';
    const rrPart = r.character?.renownRank != null ? `RR <span class="num-val">${r.character.renownRank}</span>` : '';
    const comma = (r.character?.level != null && r.character?.renownRank != null) ? ', ' : '';
    const hasMeta = (r.character?.level != null) || (r.character?.renownRank != null);

    tr.innerHTML = `
      <td class="rank">${r.rank}</td>
      <td>
        <span class="char-cell">
          ${iconHtml}
          <span class="${clickable ? 'char-name' : ''}" ${opts?.mode === 'guilds' && r.character?.realm ? `data-guild-realm="${String(r.character.realm)}"` : ''}>${dispName}</span>
          ${hasMeta ? `<span class="char-meta">${levelPart}${comma}${rrPart}</span>` : ''}
        </span>
      </td>
      <td>${opts?.mode === 'guilds' ? '' : guildCell}</td>
      <td class="num pos">
        <span class="cell-wrap">
          <span class="icon-slot medal-slot">${isPlayersBoard && (placement === 1 || placement === 2 || placement === 3)
            ? (placement === 1
                ? '<span class="star kill gold" title="Top 1 by kills" aria-label="Top 1 by kills">★</span>'
                : placement === 2
                  ? '<span class="star kill silver" title="Top 2 by kills" aria-label="Top 2 by kills">★</span>'
                  : '<span class="star kill bronze" title="Top 3 by kills" aria-label="Top 3 by kills">★</span>')
            : ''}</span>
          <span class="cell-val">${r.kills}</span>
        </span>
      </td>
      <td class="num neg">
        <span class="cell-wrap">
          <span class="icon-slot deaths-slot">${isPlayersBoard && isDeathsLeader ? '<span class="badge deaths" title="Most Deaths" aria-label="Most Deaths">✚</span>' : ''}</span>
          <span class="cell-val">${r.deaths}</span>
        </span>
      </td>
      <td class="num ${kd >= 1 ? 'pos' : 'neg'}">
        <span class="cell-wrap">
          <span class="icon-slot kd-slot">${isPlayersBoard && isKdLeader ? '<span class="badge kd" title="Highest KDR" aria-label="Highest KDR">⚡︎</span>' : ''}</span>
          <span class="cell-val">${kdText}</span>
        </span>
      </td>
      <td class="num lifetime all-kills"><span class="spinner" title="Loading…"></span></td>
      <td class="num lifetime all-deaths"><span class="spinner" title="Loading…"></span></td>
      <td class="num lifetime all-kd"><span class="spinner" title="Loading…"></span></td>
    `;
    tbody.appendChild(tr);
  });

  adjustScrolling(tbody);
  syncColumnWidths();
}

export function populateLifetimeCells(tbody: HTMLElement, lifetimeCache: Map<string | number, LifetimeStats>) {
  Array.from(tbody.querySelectorAll('tr')).forEach((tr) => {
    const id = tr.getAttribute('data-id');
    if (!id) return;
    const stats = lifetimeCache.get(id);
    if (!stats) return;
    const allKillsCell = tr.querySelector('.all-kills') as HTMLElement | null;
    const allDeathsCell = tr.querySelector('.all-deaths') as HTMLElement | null;
    const allKDCell = tr.querySelector('.all-kd') as HTMLElement | null;
    if (allKillsCell) {
      allKillsCell.textContent = String(stats.kills);
      allKillsCell.classList.remove('pos','neg');
      allKillsCell.classList.add('pos');
    }
    if (allDeathsCell) {
      allDeathsCell.textContent = String(stats.deaths);
      allDeathsCell.classList.remove('pos','neg');
      allDeathsCell.classList.add('neg');
    }
    if (allKDCell) {
      allKDCell.textContent = stats.kd.toFixed(2);
      allKDCell.classList.remove('pos','neg');
      allKDCell.classList.add(stats.kd >= 1 ? 'pos' : 'neg');
    }
  });
}

export function syncColumnWidths() {
  const headerTable = document.querySelector('.tbl.header') as HTMLElement | null;
  const bodyTable = document.querySelector('.tbl.body') as HTMLElement | null;
  const footerTable = document.querySelector('.tbl.footer') as HTMLElement | null;
  if (!headerTable) return;
  const ths = headerTable.querySelectorAll('thead tr:nth-child(2) th');
  const widths = Array.from(ths).map((th) => Math.ceil((th as HTMLElement).getBoundingClientRect().width));
  [headerTable, bodyTable, footerTable].forEach((tbl) => {
    if (!tbl) return;
    const cols = tbl.querySelectorAll('colgroup col');
    const n = Math.min(cols.length, widths.length);
    for (let i = 0; i < n; i++) {
      const w = widths[i];
      if (w && w > 0) (cols[i] as HTMLElement).style.width = w + 'px';
    }
  });
}

export function adjustScrolling(_tbody: HTMLElement) {
  const bodyWrap = document.getElementById('tableBodyWrap') as HTMLElement | null;
  if (!bodyWrap) return;
  // Yearly mode removed — always auto-size height
  bodyWrap.style.maxHeight = '';
}

export function updateSortHeaderState(sortField: SortField, sortDir: SortDir) {
  document.querySelectorAll('th.sortable').forEach((th) => {
    const f = th.getAttribute('data-field');
    th.classList.toggle('active', f === sortField);
    th.classList.toggle('asc', f === sortField && sortDir === 'asc');
    th.classList.toggle('desc', f === sortField && sortDir === 'desc');
  });
}
