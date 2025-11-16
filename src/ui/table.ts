import { careerLabel, kdOf, Row, LifetimeStats, SortDir, SortField } from '../logic';

function careerIconKey(career?: string) {
  if (!career) return '';
  const raw = String(career).toLowerCase();
  const exceptions: Record<string, string> = {
    'iron_breaker': 'ironbreaker'
  };
  return exceptions[raw] ?? raw.replace(/_/g, '-');
}

export function renderRows(rows: Row[], tbody: HTMLElement) {
  tbody.innerHTML = '';
  rows.forEach((r) => {
    const tr = document.createElement('tr');
    if (r.character?.id) tr.setAttribute('data-id', String(r.character.id));
    const kd = kdOf(r);
    tr.innerHTML = `
      <td class="rank">${r.rank}</td>
      <td>
        <span class="char-cell">
          ${r.character?.career ? `<img class="career-icon" loading="lazy" src="https://killboard.returnofreckoning.com/images/icons/${careerIconKey(r.character.career)}.png" alt="${careerLabel(r.character.career)}" onerror="this.onerror=null;this.src='/icons/careers/${careerIconKey(r.character.career)}.png';" />` : ''}
          <span class="char-name">${r.character?.name || 'Unknown'}</span>
          ${r.character?.level != null || r.character?.renownRank != null ? `<span class="char-meta">${r.character?.level != null ? 'Lvl <span class="num-val">'+r.character.level+'</span>' : ''}${(r.character?.level != null && r.character?.renownRank != null) ? ', ' : ''}${r.character?.renownRank != null ? 'RR <span class="num-val">'+r.character.renownRank+'</span>' : ''}</span>` : ''}
        </span>
      </td>
      <td class="num pos">${r.kills}</td>
      <td class="num neg">${r.deaths}</td>
      <td class="num ${kd >= 1 ? 'pos' : 'neg'}">${kd.toFixed(2)}</td>
      <td class="num lifetime all-kills">…</td>
      <td class="num lifetime all-deaths">…</td>
      <td class="num lifetime all-kd">…</td>
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
  if (ths.length !== 8) return;
  const widths = Array.from(ths).map((th) => Math.ceil((th as HTMLElement).getBoundingClientRect().width));
  [headerTable, bodyTable, footerTable].forEach((tbl) => {
    if (!tbl) return;
    const cols = tbl.querySelectorAll('colgroup col');
    cols.forEach((col, i) => { if (widths[i]) (col as HTMLElement).style.width = widths[i] + 'px'; });
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
