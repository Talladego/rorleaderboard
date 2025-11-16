import { gql, WEEKLY_QUERY, MONTHLY_QUERY } from './api/graphql';
import { renderRows, populateLifetimeCells, syncColumnWidths, updateSortHeaderState } from './ui/table';
import { Row, SortDir, SortField, sortRows, getPeriodBounds, careerLabel } from './logic';
import { initModal, openModal, setModalBody, setModalLoading, onModalClose } from './ui/modal';
import { fetchLifetimeTotalsFor, fetchTopOpponents } from './api/graphql';
import { probeDefault_2495885, probeCharacterScenarios } from './api/scenarioProbe';

// DOM refs
const periodTitle = document.getElementById('periodTitle') as HTMLElement | null;
const status = document.getElementById('status') as HTMLElement | null;
const errorBox = document.getElementById('errorBox') as HTMLElement | null;
const currentBtn = document.getElementById('currentBtn') as HTMLButtonElement | null;
const periodPrevBtn = document.getElementById('periodPrevBtn') as HTMLButtonElement | null;
const periodNextBtn = document.getElementById('periodNextBtn') as HTMLButtonElement | null;
const tbody = document.getElementById('tbody') as HTMLElement | null;

if (!tbody) throw new Error('tbody not found');
initModal();

function setBusy(b: boolean) {
  if (periodPrevBtn) periodPrevBtn.disabled = b;
  if (periodNextBtn) periodNextBtn.disabled = b;
  if (status) status.textContent = b ? 'Loading…' : '';
  document.querySelectorAll<HTMLButtonElement>('.mode-btn').forEach((btn) => (btn.disabled = b));
}
function showError(msg: string) { if (errorBox) { errorBox.style.display = 'block'; errorBox.textContent = msg; } }
function clearError() { if (errorBox) { errorBox.style.display = 'none'; errorBox.textContent = ''; } }

// ISO week helpers
function getISOWeek(d: Date) {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const diff = (date as any) - (firstThursday as any);
  return 1 + Math.floor(diff / 86400000 / 7);
}
function getISOWeekYear(d: Date) {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayNum + 3);
  return date.getUTCFullYear();
}
function getISOWeekLocal(d: Date) {
  const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dayNum = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - dayNum + 3);
  const firstThursday = new Date(date.getFullYear(), 0, 4);
  const firstDayNum = (firstThursday.getDay() + 6) % 7;
  firstThursday.setDate(firstThursday.getDate() - firstDayNum + 3);
  const diff = (date as any) - (firstThursday as any);
  return 1 + Math.floor(diff / 86400000 / 7);
}

function isoWeeksInYear(y: number) {
  const dec28 = new Date(Date.UTC(y, 11, 28));
  return getISOWeek(dec28 as any);
}

// State
const qs = new URLSearchParams(location.search);
// Only support 'weekly' and 'monthly'; coerce any other (including 'yearly') to 'weekly'
const qsPeriodRaw = (qs.get('period') || '').toLowerCase();
let currentPeriod: 'weekly' | 'monthly' | 'yearly' = (qsPeriodRaw === 'monthly' || qsPeriodRaw === 'weekly') ? (qsPeriodRaw as any) : 'weekly';
(document.documentElement as HTMLElement).setAttribute('data-current-period', currentPeriod);
let sortField: SortField = 'kills';
let sortDir: SortDir = 'desc';
const qsSort = qs.get('sort') as SortField | null;
const qsDir = qs.get('dir') as SortDir | null;
const allowedSortFields: SortField[] = ['name', 'kills', 'deaths', 'kd', 'allKills', 'allDeaths', 'allKd'];
if (qsSort && allowedSortFields.includes(qsSort)) sortField = qsSort;
if (qsDir && (qsDir === 'asc' || qsDir === 'desc')) sortDir = qsDir;
requestAnimationFrame(() => {
  const th = document.querySelector(`th.sortable[data-field="${sortField}"]`);
  if (th) th.classList.add('active', sortDir);
});

const now = new Date();
let weeklyYear = Number(qs.get('year')) || getISOWeekYear(now);
let weeklyWeek = Number(qs.get('week')) || getISOWeekLocal(now);
let monthlyYear = Number(qs.get('year')) || now.getUTCFullYear();
let monthlyMonth = Number(qs.get('month')) || now.getUTCMonth() + 1;
let yearlyYear = Number(qs.get('year')) || now.getUTCFullYear();
let yearlyAggregation: 'months' | 'weeks' = qs.get('yagg') === 'weeks' ? 'weeks' : 'months';
const aggSelect = document.getElementById('aggSelect') as HTMLSelectElement | null;
const aggControl = document.getElementById('aggControl') as HTMLElement | null;
if (aggSelect) aggSelect.value = yearlyAggregation;

function updateAggControlVisibility() {
  if (!aggControl) return;
  aggControl.style.display = currentPeriod === 'yearly' ? 'flex' : 'none';
}

aggSelect?.addEventListener('change', () => {
  const val = aggSelect.value === 'weeks' ? 'weeks' : 'months';
  if (val !== yearlyAggregation) {
    yearlyAggregation = val;
    updateUrl();
    fetchAndRender();
  }
});

function updatePeriodTitle() {
  if (!periodTitle) return;
  if (currentPeriod === 'yearly') periodTitle.textContent = `Year ${yearlyYear}`;
  else if (currentPeriod === 'monthly') {
    const date = new Date(Date.UTC(monthlyYear, monthlyMonth - 1, 1));
    const monthName = date.toLocaleString(undefined, { month: 'long' });
    periodTitle.textContent = `${monthName} ${monthlyYear}`;
  } else {
    periodTitle.textContent = `Week ${weeklyWeek}, ${weeklyYear}`;
  }
  updateCurrentButtonState();
  updateAggControlVisibility();
}

function updateCurrentButtonState() {
  const btn = document.getElementById('currentBtn');
  if (!btn) return;
  const n = new Date();
  let isCurrent = false;
  if (currentPeriod === 'weekly') {
    const curW = getISOWeekLocal(n);
    const curY = getISOWeekYear(n);
    isCurrent = weeklyWeek === curW && weeklyYear === curY;
  } else if (currentPeriod === 'monthly') {
    isCurrent = monthlyYear === n.getUTCFullYear() && monthlyMonth === n.getUTCMonth() + 1;
  } else if (currentPeriod === 'yearly') {
    isCurrent = yearlyYear === n.getUTCFullYear();
  }
  btn.classList.toggle('active', !!isCurrent);
}

function setMode(mode: 'weekly' | 'monthly' | 'yearly') {
  // Yearly mode disabled: ignore requests to switch to yearly
  if (mode === 'yearly') return;
  if (mode === currentPeriod) return;
  currentPeriod = mode;
  document.documentElement.setAttribute('data-current-period', currentPeriod);
  document.querySelectorAll('.mode-btn').forEach((b) => b.classList.toggle('active', (b as HTMLElement).dataset.mode === mode));
  updatePeriodTitle();
  fetchAndRender();
}

function goToCurrent() {
  const n = new Date();
  if (currentPeriod === 'weekly') {
    weeklyWeek = getISOWeekLocal(n);
    weeklyYear = getISOWeekYear(n);
  } else if (currentPeriod === 'monthly') {
    monthlyYear = n.getUTCFullYear();
    monthlyMonth = n.getUTCMonth() + 1;
  } else if (currentPeriod === 'yearly') {
    yearlyYear = n.getUTCFullYear();
  }
  updatePeriodTitle();
  fetchAndRender();
}

currentBtn?.addEventListener('click', goToCurrent);

document.querySelectorAll('.mode-btn').forEach((btn) => btn.addEventListener('click', () => setMode((btn as HTMLElement).dataset.mode as any)));
document.querySelectorAll('.mode-btn').forEach((b) => b.classList.toggle('active', (b as HTMLElement).dataset.mode === currentPeriod));

periodPrevBtn?.addEventListener('click', () => {
  if (currentPeriod === 'weekly') adjustWeek(-1);
  else if (currentPeriod === 'monthly') adjustMonth(-1);
  else adjustYear(-1);
});
periodNextBtn?.addEventListener('click', () => {
  if (currentPeriod === 'weekly') adjustWeek(1);
  else if (currentPeriod === 'monthly') adjustMonth(1);
  else adjustYear(1);
});

function adjustWeek(delta: number) {
  let maxWeeksCurrentYear = isoWeeksInYear(weeklyYear);
  weeklyWeek += delta;
  if (weeklyWeek < 1) {
    weeklyYear -= 1;
    if (weeklyYear < 2008) weeklyYear = 2008;
    weeklyWeek = isoWeeksInYear(weeklyYear);
  } else if (weeklyWeek > maxWeeksCurrentYear) {
    weeklyYear += 1;
    if (weeklyYear > 2100) weeklyYear = 2100;
    weeklyWeek = 1;
  }
  updatePeriodTitle();
  fetchAndRender();
}
function adjustMonth(delta: number) {
  monthlyMonth += delta;
  if (monthlyMonth < 1) { monthlyMonth = 12; monthlyYear -= 1; }
  else if (monthlyMonth > 12) { monthlyMonth = 1; monthlyYear += 1; }
  updatePeriodTitle();
  fetchAndRender();
}
function adjustYear(delta: number) {
  yearlyYear += delta;
  if (yearlyYear < 2008) yearlyYear = 2008; if (yearlyYear > 2100) yearlyYear = 2100;
  updatePeriodTitle();
  fetchAndRender();
}

function updateUrl() {
  const u = new URL(location.href);
  u.searchParams.set('period', currentPeriod);
  if (currentPeriod === 'weekly') {
    u.searchParams.set('year', String(weeklyYear));
    u.searchParams.set('week', String(weeklyWeek));
    u.searchParams.delete('month');
    u.searchParams.delete('yagg');
  } else if (currentPeriod === 'monthly') {
    u.searchParams.set('year', String(monthlyYear));
    u.searchParams.set('month', String(monthlyMonth));
    u.searchParams.delete('week');
    u.searchParams.delete('yagg');
  }
  if (sortField) u.searchParams.set('sort', sortField); else u.searchParams.delete('sort');
  if (sortDir) u.searchParams.set('dir', sortDir); else u.searchParams.delete('dir');
  history.replaceState(null, '', u);
}

document.querySelectorAll('th.sortable').forEach((th) => th.addEventListener('click', () => applySort((th as HTMLElement).getAttribute('data-field') as SortField)));

function applySort(field: SortField) {
  if (sortField === field) sortDir = sortDir === 'desc' ? 'asc' : 'desc';
  else { sortField = field; sortDir = 'desc'; }
  updateSortHeaderState(sortField, sortDir);
  updateUrl();
  if (currentPeriod === 'yearly') {
    const fullySorted = sortRows(yearlyAllRows, sortField, sortDir, (r)=> lifetimeCache.get(r.character?.id || '') || { kills:0, deaths:0, kd:0 });
    fullySorted.forEach((r, i) => r.rank = i + 1);
    currentRows = fullySorted.slice();
    renderRows(fullySorted, tbody!);
    augmentWithLifetimeTotals(fullySorted);
  } else {
    const base = currentRows.map((r) => r);
    const resorted = sortRows(base, sortField, sortDir, (r)=> lifetimeCache.get(r.character?.id || '') || { kills:0, deaths:0, kd:0 });
    resorted.forEach((r, i) => r.rank = i + 1);
    currentRows = resorted.slice();
    renderRows(resorted, tbody!);
    augmentWithLifetimeTotals(resorted);
  }
}

// Data fetch & render
let yearlyAllRows: Row[] = [];
let currentRows: Row[] = [];
const lifetimeCache = new Map<string | number, { kills: number; deaths: number; kd: number; scenarioWins?: number; scenarioLosses?: number }>();
let lifetimeGeneration = 0;

async function fetchAndRender(ev?: Event) {
  ev?.preventDefault();
  clearError(); setBusy(true);
  (document.documentElement as HTMLElement).setAttribute('data-current-period', currentPeriod);
  const year = currentPeriod === 'weekly' ? weeklyYear : currentPeriod === 'monthly' ? monthlyYear : yearlyYear;
  try {
    let data: any, rows: Row[];
    if (currentPeriod === 'weekly') {
      const week = weeklyWeek;
      if (!(week >= 1 && week <= 53)) { showError('Invalid ISO week (1-53).'); return; }
      data = await gql(WEEKLY_QUERY, { year, week });
      rows = (data?.weeklyKillLeaderboard || []) as Row[];
    } else if (currentPeriod === 'monthly') {
      const month = monthlyMonth;
      if (!(month >= 1 && month <= 12)) { showError('Invalid month (1-12).'); return; }
      data = await gql(MONTHLY_QUERY, { year, month });
      rows = (data?.monthlyKillLeaderboard || []) as Row[];
    } else {
      const now = new Date();
      const currentISOYear = getISOWeekYear(now);
      const aggregate = new Map<string | number, { character: Row['character']; kills: number; deaths: number }>();
      if (yearlyAggregation === 'weeks') {
        const lastWeek = (year === currentISOYear) ? getISOWeek(now) : isoWeeksInYear(year);
        for (let w = 1; w <= lastWeek; w++) {
          if (status) status.textContent = `Loading… (week ${w}/${lastWeek})`;
          try {
            const d = await gql(WEEKLY_QUERY, { year, week: w });
            const list = (d as any)?.weeklyKillLeaderboard || [];
            for (const entry of list) {
              const id = entry.character?.id; if (!id) continue;
              const prev = aggregate.get(id) || { character: entry.character, kills: 0, deaths: 0 };
              prev.kills += entry.kills;
              prev.deaths += entry.deaths;
              aggregate.set(id, prev);
            }
          } catch (e) { console.warn('Failed week', w, e); }
        }
      } else {
        const currentYearUTC = now.getUTCFullYear();
        const lastMonth = (year === currentYearUTC) ? (now.getUTCMonth() + 1) : 12;
        for (let m = 1; m <= lastMonth; m++) {
          if (status) status.textContent = `Loading… (month ${m}/${lastMonth})`;
          try {
            const d = await gql(MONTHLY_QUERY, { year, month: m });
            const list = (d as any)?.monthlyKillLeaderboard || [];
            for (const entry of list) {
              const id = entry.character?.id; if (!id) continue;
              const prev = aggregate.get(id) || { character: entry.character, kills: 0, deaths: 0 };
              prev.kills += entry.kills;
              prev.deaths += entry.deaths;
              aggregate.set(id, prev);
            }
          } catch (e) { console.warn('Failed month', m, e); }
        }
      }
      yearlyAllRows = Array.from(aggregate.values()).map(v => ({ rank: 0, kills: v.kills, deaths: v.deaths, character: v.character })) as Row[];
      rows = yearlyAllRows.slice();
    }

    let displayRows: Row[];
    if (currentPeriod === 'yearly') {
      const fullySorted = sortRows(yearlyAllRows, sortField, sortDir, (r)=> lifetimeCache.get(r.character?.id || '') || { kills:0, deaths:0, kd:0 });
      fullySorted.forEach((r, i) => r.rank = i + 1);
      displayRows = fullySorted;
    } else {
      const sorted = sortRows(rows, sortField, sortDir, (r)=> lifetimeCache.get(r.character?.id || '') || { kills:0, deaths:0, kd:0 });
      sorted.forEach((r, i) => r.rank = i + 1);
      displayRows = sorted;
    }
    currentRows = displayRows.slice();
    renderRows(displayRows, tbody!);

    await augmentWithLifetimeTotals(displayRows);

    updateUrl();
    updatePeriodTitle();
  } catch (e: any) {
    showError(String(e.message || e));
  } finally { setBusy(false); }
}

async function augmentWithLifetimeTotals(rows: Row[]) {
  const gen = ++lifetimeGeneration;
  const ids = rows.map((r) => r.character?.id).filter(Boolean) as Array<string | number>;
  const pending = ids.filter((id) => !lifetimeCache.has(id));
  if (pending.length === 0) { populateLifetimeCells(tbody!, lifetimeCache); return; }
  if (status) status.textContent = 'Fetching lifetime totals…';
  const chunkSize = 15;
  for (let i = 0; i < pending.length; i += chunkSize) {
    if (gen !== lifetimeGeneration) return;
    const chunk = pending.slice(i, i + chunkSize);
    const varDefs = chunk.map((_, j) => `$v${i + j}: UnsignedInt!`).join(' ');
    const bodyParts = chunk.map((_, j) => `a${i + j}Kills: kills(first:1, where:{ killerCharacterId:{ eq:$v${i + j} } }){ totalCount } a${i + j}Deaths: kills(first:1, where:{ victimCharacterId:{ eq:$v${i + j} } }){ totalCount }`).join(' ');
    const query = `query Lifetime(${varDefs}){ ${bodyParts} }`;
    const vars: Record<string, any> = {}; chunk.forEach((id, j) => { (vars as any)[`v${i + j}`] = Number(id); });
    let data: any;
    try { data = await gql(query, vars); }
    catch (e) { console.warn('Lifetime batch failed', e); continue; }
    if (gen !== lifetimeGeneration) return;
    chunk.forEach((id, j) => {
      const killsField = `a${i + j}Kills`;
      const deathsField = `a${i + j}Deaths`;
      const kills = data?.[killsField]?.totalCount ?? 0;
      const deaths = data?.[deathsField]?.totalCount ?? 0;
      // Batch population doesn't include scenario totals; set zeros so fields exist
      lifetimeCache.set(id, { kills, deaths, kd: deaths > 0 ? kills / deaths : kills, scenarioWins: 0, scenarioLosses: 0 });
    });
    if (status) status.textContent = `Fetching lifetime totals… (${Math.min(i + chunkSize, pending.length)}/${pending.length})`;
  }
  if (gen === lifetimeGeneration) {
    populateLifetimeCells(tbody!, lifetimeCache);
    if (status) status.textContent = '';
    if (sortField === 'allKills' || sortField === 'allDeaths' || sortField === 'allKd') {
      // Re-apply sorting with lifetime stats now populated
      const re = sortRows(currentRows, sortField, sortDir, (r)=> lifetimeCache.get(r.character?.id || '') || { kills:0, deaths:0, kd:0 });
      re.forEach((r, i) => r.rank = i + 1);
      currentRows = re.slice();
      renderRows(re, tbody!);
      populateLifetimeCells(tbody!, lifetimeCache);
    }
  }
}

// Initial setup
updatePeriodTitle();
updateCurrentButtonState();
fetchAndRender();

// Dev: auto-run scenario probe if URL params are provided
;(async () => {
  try {
    const u = new URL(location.href);
    const probeParam = u.searchParams.get('probe');
    if (!probeParam) return;
    const charIdRaw = u.searchParams.get('char') || probeParam;
    const charId = Number(charIdRaw);
    if (!Number.isFinite(charId)) return;
    const ranges: Array<{ label?: string; fromIso: string; toIso: string }> = [];
    const rangeParams = u.searchParams.getAll('range');
    if (rangeParams.length) {
      for (const r of rangeParams) {
        const parts = r.split(',').map(s=>s.trim());
        if (parts.length >= 2) {
          const fromIso = parts[0].endsWith('Z') ? parts[0] : parts[0] + 'T00:00:00Z';
          const toIso = parts[1].endsWith('Z') ? parts[1] : parts[1] + 'T23:59:59Z';
          ranges.push({ fromIso, toIso });
        }
      }
    }
    if (!ranges.length) {
      ranges.push(
        { label: 'April 2025', fromIso: '2025-04-01T00:00:00Z', toIso: '2025-04-30T23:59:59Z' },
        { label: 'September 2025', fromIso: '2025-09-01T00:00:00Z', toIso: '2025-09-30T23:59:59Z' }
      );
    }
    const limitPages = Number(u.searchParams.get('limitPages') || '20');
    if (status) status.textContent = 'Running scenario probe… (see console)';
    const out = await probeCharacterScenarios(charId, ranges, { limitPages, log: console.log });
    console.log('[Scenario Probe]', { characterId: charId, ranges, limitPages, out });
    if (status) status.textContent = 'Scenario probe finished. See console output.';
  } catch (e) {
    console.warn('Probe failed', e);
    if (status) status.textContent = 'Scenario probe failed (see console).';
  }
})();

// Keep alignment on viewport size changes
let __resizeSyncTimer: any;
window.addEventListener('resize', () => {
  if (__resizeSyncTimer) clearTimeout(__resizeSyncTimer);
  __resizeSyncTimer = setTimeout(() => { syncColumnWidths(); }, 100);
});

// Character modal: click handler to fetch and render details
let currentModalSessionId = 0;
let currentModalAbort: AbortController | null = null;

// Abort active modal fetches when the modal closes
onModalClose(() => { try { currentModalAbort?.abort(); } catch {} });

tbody.addEventListener('click', async (e: Event) => {
  const t = e.target as HTMLElement;
  const nameEl = t.closest?.('.char-name');
  if (!nameEl) return;
  const tr = t.closest('tr');
  const idAttr = tr?.getAttribute('data-id');
  const charId = idAttr ? Number(idAttr) : NaN;
  const name = (nameEl.textContent || 'Character').trim();
  // Open modal without name in the header; we'll inject period controls into the header row
  // Abort any previous modal session
  try { currentModalAbort?.abort(); } catch {}
  currentModalAbort = new AbortController();
  const modalSessionId = ++currentModalSessionId;

  openModal('', '');
  setModalLoading();
  // Period bounds are computed within renderModal so they stay in sync on re-render

  // Helper: career key/icon/table rendering used by renderModal
  function careerKey(career?: string) {
    if (!career) return '';
    const raw = String(career).toLowerCase();
    // Exceptions where the CDN filename doesn't match underscore->dash rule
    const exceptions: Record<string, string> = {
      'iron_breaker': 'ironbreaker'
    };
    return exceptions[raw] ?? raw.replace(/_/g, '-');
  }
  function careerIconEl(career?: string) {
    if (!career) return '';
    const key = careerKey(career);
    const label = careerLabel(career);
    const remote = `https://killboard.returnofreckoning.com/images/icons/${key}.png`;
    const local = `/icons/careers/${key}.png`;
    return `<img class="career-icon" src="${remote}" alt="${label}" title="${label}" onerror="this.onerror=null;this.src='${local}';" />`;
  }
  function updateCharSummary(career?: string, level?: number, rr?: number) {
    const el = document.querySelector('#charModal .char-summary') as HTMLElement | null;
    if (!el) return;
    const icon = careerIconEl(career);
    const cname = career ? ` — ${careerLabel(career)}` : '';
    el.innerHTML = `${icon} <strong>${name}</strong>${cname} &nbsp; <span class="muted">Lvl ${level ?? '—'}, RR ${rr ?? '—'}</span>`;
  }
  function tableList(
    title: string,
    arr: Array<{ id?: number|string; name?: string; career?: string; count: number; diff?: number }>,
    opts?: { kind?: 'character'|'guild'|'career'; countLabel?: string; showDiff?: boolean; metric?: 'kills'|'deaths' }
  ) {
    if (!arr || arr.length === 0) return `<div class="muted">${title}: No data for this period.</div>`;
    const kind = opts?.kind || 'character';
    const countLabel = opts?.countLabel || 'Count';
    const showDiff = !!opts?.showDiff; // enable for all kinds
    const metric = opts?.metric || (countLabel.toLowerCase() === 'deaths' ? 'deaths' : 'kills');
    const countClass = metric === 'deaths' ? 'neg' : 'pos';
    const signed = (n: number|undefined) => {
      const v = typeof n === 'number' ? n : 0;
      if (v > 0) return `+${v}`; if (v < 0) return `${v}`; return '0';
    };
    const rowsHtml = arr.slice(0, 10).map((x) => {
      if (kind === 'career') {
        const label = careerLabel(String(x.career || ''));
        const diffVal = typeof x.diff === 'number' ? x.diff : 0;
        const diffClass = diffVal > 0 ? 'pos' : (diffVal < 0 ? 'neg' : '');
        return `<tr><td>${careerIconEl(x.career)} <span>${label}</span></td><td class="num ${countClass}">${x.count}</td>${showDiff ? `<td class="num ${diffClass}">${signed(x.diff)}</td>` : ''}</tr>`;
      } else if (kind === 'guild') {
        const label = String(x.name || 'Unknown Guild');
        const diffVal = typeof x.diff === 'number' ? x.diff : 0;
        const diffClass = diffVal > 0 ? 'pos' : (diffVal < 0 ? 'neg' : '');
        return `<tr><td>${label}</td><td class="num ${countClass}">${x.count}</td>${showDiff ? `<td class="num ${diffClass}">${signed(x.diff)}</td>` : ''}</tr>`;
      } else {
        const label = String(x.name || 'Unknown');
        const diffVal = typeof x.diff === 'number' ? x.diff : 0;
        const diffClass = diffVal > 0 ? 'pos' : (diffVal < 0 ? 'neg' : '');
        return `<tr><td>${careerIconEl(x.career)} <span>${label}</span></td><td class="num ${countClass}">${x.count}</td>${showDiff ? `<td class="num ${diffClass}">${signed(x.diff)}</td>` : ''}</tr>`;
      }
    }).join('');
    return `
      <div style="margin-top:.5rem;">
        <table class="list-table">
          <thead><tr><th>${title}</th><th class="num">${countLabel}</th>${showDiff ? '<th class="num">+/−</th>' : ''}</tr></thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </div>
    `;
  }

  let __modalRenderGen = 0; // per-session rerender counter
  async function renderModal(fullScan = false) {
  const myGen = ++__modalRenderGen;
  // Compute period bounds (recomputed each render to reflect current selection)
  let { fromIso, toIso } = getPeriodBounds(currentPeriod, { weeklyYear, weeklyWeek, monthlyYear, monthlyMonth, yearlyYear });
    // Track start time for progress timing
    const startedAt = (typeof performance !== 'undefined' ? performance.now() : Date.now());

    // Initial empty state values
    let victims: Array<{ id: number|string; name: string; career?: string; count: number }> = [];
    let killers: Array<{ id: number|string; name: string; career?: string; count: number }> = [];
    let guildsKilled: Array<{ id: number|string; name: string; count: number }> = [];
    let careersKilled: Array<{ career: string; count: number }> = [];
    let killersGuilds: Array<{ id: number|string; name: string; count: number }> = [];
    let killersCareers: Array<{ career: string; count: number }> = [];
  // Period totals are driven by leaderboard fetch; scanned data does not override them

    // Period label
    const periodText = (() => {
      if (currentPeriod === 'yearly') return `Year ${yearlyYear}`;
      if (currentPeriod === 'monthly') {
        const date = new Date(Date.UTC(monthlyYear, monthlyMonth - 1, 1));
        const monthName = date.toLocaleString(undefined, { month: 'long' });
        return `${monthName} ${monthlyYear}`;
      }
      return `Week ${weeklyWeek}, ${weeklyYear}`;
    })();

    // Find the selected row for extra character context
    const row = currentRows.find(r => Number(r.character?.id) === charId);
    const level = row?.character?.level;
    const rr = row?.character?.renownRank;

  const careerName = row?.character?.career ? careerLabel(row.character.career) : '';
  const charIcon = careerIconEl(row?.character?.career);

    const header = `
      <div style="margin-bottom:.35rem;">
        <div class="char-summary">${charIcon} <strong>${name}</strong>${careerName ? ` — ${careerName}` : ''} &nbsp; <span class="muted">Lvl ${level ?? '—'}, RR ${rr ?? '—'}</span></div>
        <div id="qualifyNote" class="muted" style="text-align:center; margin:.2rem 0 .35rem; display:none; color:#ef4444;">Not on leaderboard for this period — showing event totals.</div>
        <table class="vlined summary-table">
          <tbody>
            <tr>
              <th>Kills</th><th>Deaths</th><th>K/D</th><th>Lifetime Kills</th><th>Lifetime Deaths</th><th>Lifetime K/D</th>
            </tr>
            <tr>
              <td class="num"><span id="periodKillsCell">…</span></td>
              <td class="num"><span id="periodDeathsCell">…</span></td>
              <td class="num"><span id="periodKdCell">…</span></td>
              <td class="num"><span id="totalKillsCell">…</span></td>
              <td class="num"><span id="totalDeathsCell">…</span></td>
              <td class="num"><span id="totalKdCell">…</span></td>
            </tr>
          </tbody>
        </table>
      </div>
    `;

  

    const grid = `
      <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.5rem;align-items:start;">
        <div id="victimsTable"><div class="muted">Loading Top Victims…</div></div>
        <div id="guildsKilledTable"><div class="muted">Loading Top Guilds Killed…</div></div>
        <div id="careersKilledTable"><div class="muted">Loading Top Careers Killed…</div></div>
        <div id="killersTable"><div class="muted">Loading Top Killers…</div></div>
        <div id="killersGuildsTable"><div class="muted">Loading Top Guilds Killed by…</div></div>
        <div id="killersCareersTable"><div class="muted">Loading Top Careers Killed by…</div></div>
      </div>
      <div style="margin-top:.5rem;">
        <span id="scannedInfo" class="muted">Loading full period details…</span>
      </div>
    `;

    // Inject a period selector identical to the page header into the modal header row (left), keeping Close on the right
    const modalTitleEl = document.getElementById('charModalTitle');
    if (modalTitleEl) {
      const showAgg = (document.documentElement.getAttribute('data-current-period') || currentPeriod) === 'yearly';
      const sheetKindLabel = (currentPeriod === 'weekly') ? 'Weekly Score Sheet' : (currentPeriod === 'monthly') ? 'Monthly Score Sheet' : 'Score Sheet';
      modalTitleEl.innerHTML = `
        <div id="sheetLabel_m" class="sheet-label" style="position:absolute;left:0;top:50%;transform:translateY(-50%);font-size:.9rem;opacity:.9;">${sheetKindLabel}</div>
        <div class="period-selector" id="modalPeriodSelector" style="margin-left:0;">
          <button id="periodPrevBtn_m" class="nav-arrow" title="Previous">◀</button>
          <div id="modalPeriodTitle_m" class="period-title">${periodText}</div>
          <button id="periodNextBtn_m" class="nav-arrow" title="Next">▶</button>
          <div class="agg-control" id="aggControl_m" style="${showAgg ? '' : 'display:none;'}">
            <label for="aggSelect_m">Aggregate by</label>
            <select id="aggSelect_m">
              <option value="months">Months</option>
              <option value="weeks">Weeks</option>
            </select>
          </div>
        </div>
      `;
      // Layout header: left label, centered period selector, close button on right
      const titleWrap = (modalTitleEl as HTMLElement);
      titleWrap.style.flex = '1';
      titleWrap.style.display = 'flex';
      titleWrap.style.position = 'relative';
      titleWrap.style.alignItems = 'center';
      titleWrap.style.justifyContent = 'center';
      const aggSel = document.getElementById('aggSelect_m') as HTMLSelectElement | null;
      if (aggSel) {
        aggSel.value = yearlyAggregation;
        aggSel.onchange = () => {
          const val = aggSel.value === 'weeks' ? 'weeks' : 'months';
          if (val !== yearlyAggregation) {
            yearlyAggregation = val as any;
            // Re-render modal for new aggregation with deep scan
            renderModal(true);
          }
        };
      }
      const prevM = document.getElementById('periodPrevBtn_m');
      const nextM = document.getElementById('periodNextBtn_m');
      prevM?.addEventListener('click', async () => {
        if (currentPeriod === 'weekly') adjustWeek(-1);
        else if (currentPeriod === 'monthly') adjustMonth(-1);
        else adjustYear(-1);
        try { await renderModal(true); } catch { /* ignore; body will show error if needed */ }
      });
      nextM?.addEventListener('click', async () => {
        if (currentPeriod === 'weekly') adjustWeek(1);
        else if (currentPeriod === 'monthly') adjustMonth(1);
        else adjustYear(1);
        try { await renderModal(true); } catch { /* ignore */ }
      });
    }

    setModalBody(header + grid);
  // Initialize char summary from current table row (may be refined after leaderboard fetch)
  updateCharSummary(row?.character?.career, level, rr);

  // Update lifetime totals asynchronously
  (async () => {
  let lifeKills = 0, lifeDeaths = 0, lifeKd = 0;
      let lifetime = lifetimeCache.get(charId) || null;
      if (!lifetime) {
        try {
          const lt = await fetchLifetimeTotalsFor(charId, { signal: currentModalAbort?.signal });
          lifetime = lt; lifetimeCache.set(charId, lt);
        } catch { lifetime = { kills: 0, deaths: 0, kd: 0, scenarioWins: 0, scenarioLosses: 0 } as any; }
      }
      if (modalSessionId !== currentModalSessionId) return;
      if (myGen !== __modalRenderGen) return;
      // NOTE: API-level scenario totals via wins:true/false have proven unreliable historically.
      // Scenario totals are not displayed in the modal. We still show lifetime kills/deaths, which are consistent.
      lifeKills = lifetime?.kills ?? 0;
      lifeDeaths = lifetime?.deaths ?? 0;
      lifeKd = lifetime?.kd ?? 0;
      const setTextClass = (id: string, text: string, isPos?: boolean|null) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.textContent = text;
        el.classList.remove('pos','neg');
        if (isPos != null) el.classList.add(isPos ? 'pos' : 'neg');
      };
      setTextClass('totalKillsCell', String(lifeKills), true);
      setTextClass('totalDeathsCell', String(lifeDeaths), false);
      setTextClass('totalKdCell', (lifeKd as number).toFixed(2), (lifeKd as number) >= 1);
    })();

    // Helper to set text and coloring on summary cells and toggle qualifier note
    const setTextClass = (id: string, text: string, isPos?: boolean|null) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.textContent = text;
      el.classList.remove('pos','neg');
      if (isPos != null) el.classList.add(isPos ? 'pos' : 'neg');
    };
    const formatPeriodShort = (): string => {
      if (currentPeriod === 'weekly') return `Week ${weeklyWeek}`;
      if (currentPeriod === 'monthly') {
        const date = new Date(Date.UTC(monthlyYear, monthlyMonth - 1, 1));
        const monthName = date.toLocaleString(undefined, { month: 'long' });
        return `${monthName} ${monthlyYear}`;
      }
      return `${yearlyYear}`;
    };
    const setQualifyNote = (visible: boolean) => {
      const el = document.getElementById('qualifyNote') as HTMLElement | null;
      if (!el) return;
      if (visible) {
        el.textContent = `Not on leaderboard for ${formatPeriodShort()} — showing event totals.`;
        el.style.display = '';
      } else {
        el.style.display = 'none';
      }
    };
    let periodSource: 'leaderboard' | 'events' | null = null;

    // Fetch leaderboard period totals for the selected character and update summary cells (source of truth)
    (async () => {
      try {
        let list: any[] = [];
        if (currentPeriod === 'weekly') {
          const data = await gql<any>(WEEKLY_QUERY, { year: weeklyYear, week: weeklyWeek });
          list = (data?.weeklyKillLeaderboard || []) as any[];
        } else if (currentPeriod === 'monthly') {
          const data = await gql<any>(MONTHLY_QUERY, { year: monthlyYear, month: monthlyMonth });
          list = (data?.monthlyKillLeaderboard || []) as any[];
        }
        if (modalSessionId !== currentModalSessionId) return;
        if (myGen !== __modalRenderGen) return;
        const found = list.find((r) => String(r?.character?.id) === String(charId));
        const killsVal = typeof found?.kills === 'number' ? found.kills : null;
        const deathsVal = typeof found?.deaths === 'number' ? found.deaths : null;
        const kdVal = (typeof killsVal === 'number' && typeof deathsVal === 'number')
          ? (deathsVal > 0 ? (killsVal / deathsVal) : killsVal)
          : null;
        if (killsVal != null && deathsVal != null && kdVal != null) {
          setTextClass('periodKillsCell', String(killsVal), true);
          setTextClass('periodDeathsCell', String(deathsVal), false);
          setTextClass('periodKdCell', kdVal.toFixed(2), kdVal >= 1);
          periodSource = 'leaderboard';
          setQualifyNote(false);
          // Refresh character summary (career/level/RR) from the leaderboard row for this period
          if (found?.character) {
            updateCharSummary(found.character.career, found.character.level, found.character.renownRank);
          }
        } else {
          // Not on leaderboard; leave cells for events fallback to fill
          setQualifyNote(false);
        }
      } catch {
        // Leave placeholders on failure
      }
    })();

    // Fetch period data with progressive updates for top lists and scanned info only
    try {
      await fetchTopOpponents(charId, {
        fromIso, toIso, fullScan,
        realm: (() => {
          const c = row?.character?.career ? String(row.character.career).toLowerCase() : '';
          const orderCareers = new Set([
            'iron_breaker','rune_priest','slayer','engineer','knight_of_the_blazing_sun','bright_wizard',
            'warrior_priest','shadow_warrior','witch_hunter','archmage','sword_master','white_lion'
          ]);
          if (!c) return undefined as any;
          return orderCareers.has(c) ? 0 : 1;
        })() as any,
        includeScenarios: false,
        signal: currentModalAbort?.signal,
        onProgress: (p) => {
          if (modalSessionId !== currentModalSessionId) return;
          if (myGen !== __modalRenderGen) return;
          victims = p.victims; killers = p.killers; guildsKilled = p.guildsKilled; careersKilled = p.careersKilled;
          killersGuilds = p.killersGuilds; killersCareers = p.killersCareers;
          // If no leaderboard row was found yet, fallback to event totals for this period
          if (periodSource !== 'leaderboard') {
            const k = p.periodStats.kills || 0;
            const d = p.periodStats.deaths || 0;
            const kdNow = d > 0 ? (k / d) : k;
            setTextClass('periodKillsCell', String(k), true);
            setTextClass('periodDeathsCell', String(d), false);
            setTextClass('periodKdCell', kdNow.toFixed(2), kdNow >= 1);
            periodSource = 'events';
            setQualifyNote(true);
          }
          // Update tables
          const mount = (id: string, html: string) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };
          mount('victimsTable', tableList('Top Victims', victims, { kind: 'character', countLabel: 'Kills', showDiff: true, metric: 'kills' }));
          mount('guildsKilledTable', tableList('Top Guilds Killed', guildsKilled, { kind: 'guild', countLabel: 'Kills', metric: 'kills', showDiff: true }));
          mount('careersKilledTable', tableList('Top Careers Killed', careersKilled as any, { kind: 'career', countLabel: 'Kills', metric: 'kills', showDiff: true }));
          mount('killersTable', tableList('Top Killers', killers, { kind: 'character', countLabel: 'Deaths', showDiff: true, metric: 'deaths' }));
          mount('killersGuildsTable', tableList('Top Guilds Killed by', killersGuilds, { kind: 'guild', countLabel: 'Deaths', metric: 'deaths', showDiff: true }));
          mount('killersCareersTable', tableList('Top Careers Killed by', killersCareers as any, { kind: 'career', countLabel: 'Deaths', metric: 'deaths', showDiff: true }));
          // Scanned info
          const s = p.scanned;
          const scannedEl = document.getElementById('scannedInfo');
          if (scannedEl && s) {
            const extra = s.hitCap ? ' (capped)' : '';
            const label = fullScan ? ' (deep scan)' : '';
            const nowTs = (typeof performance !== 'undefined' ? performance.now() : Date.now());
            const elapsedSec = Math.max(0, (nowTs - startedAt) / 1000);
            const text = `Scanned kill events: ${s.killsNodes}/${s.killsTotal} kills, ${s.deathsNodes}/${s.deathsTotal} deaths${label}${extra} — ${elapsedSec.toFixed(1)}s elapsed.`;
            scannedEl.innerHTML = `<div class="muted" style="margin-top:.25rem;">${text}</div>`;
          }
        }
      }).then(() => {
        // no-op: onProgress handled updates; final result ignored here
      });
    } catch {
      // If progress fetch fails, leave placeholders or show error in scanned info
      const scannedEl = document.getElementById('scannedInfo');
      if (scannedEl) scannedEl.innerHTML = `<div class="muted">Failed to load details for this period.</div>`;
    }

    
  }

  // Initial render (start with full period deep scan)
  try { await renderModal(true); } catch { setModalBody('<div class="muted">Failed to load details. Please try again.</div>'); }

  // end modal handler
});

// Expose probe helpers in the browser console for ad-hoc analysis
(window as any).probeDefault_2495885 = probeDefault_2495885;
(window as any).probeCharacterScenarios = probeCharacterScenarios;
