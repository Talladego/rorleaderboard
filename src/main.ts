import { gql, WEEKLY_QUERY, MONTHLY_QUERY, fetchCharacterInfo, resolveCharacterByName } from './api/graphql';
import { renderRows, populateLifetimeCells, updateSortHeaderState } from './ui/table';
import { Row, SortDir, SortField, sortRows, getPeriodBounds, careerLabel, LifetimeStats } from './logic';
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
const nameInput = document.getElementById('nameInput') as HTMLInputElement | null;
const showByNameBtn = document.getElementById('showByNameBtn') as HTMLButtonElement | null;

if (!tbody) throw new Error('tbody not found');
initModal();

// Modal: session management for aborting in-flight requests
let currentModalSessionId = 0;
let currentModalAbort: AbortController | null = null;
let openCharId: number | null = null;
let openCharName: string | null = null;

// Reusable: open the score sheet modal for a given character id and name (same period)
// Optional careerHint helps when opening from modal lists where the char may not be on the leaderboard rows.
async function openScoreSheet(charId: number, name: string, careerHint?: string) {
  try { currentModalAbort?.abort(); } catch {}
  currentModalAbort = new AbortController();
  const modalSessionId = ++currentModalSessionId;

  // Track open character and reflect in URL so it is linkable
  openCharId = Number(charId);
  openCharName = String(name || 'Character');
  updateUrl();

  openModal('', '');
  setModalLoading();

  function careerKey(career?: string) {
    if (!career) return '';
    const raw = String(career).toLowerCase();
    const exceptions: Record<string, string> = { 'iron_breaker': 'ironbreaker' };
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

  let __modalRenderGen = 0;
  async function renderModal(fullScan = false) {
    const myGen = ++__modalRenderGen;
    let { fromIso, toIso } = getPeriodBounds(currentPeriod, { weeklyYear, weeklyWeek, monthlyYear, monthlyMonth });
    const startedAt = (typeof performance !== 'undefined' ? performance.now() : Date.now());

    let victims: Array<{ id: number|string; name: string; career?: string; count: number }> = [];
    let killers: Array<{ id: number|string; name: string; career?: string; count: number }> = [];
    let guildsKilled: Array<{ id: number|string; name: string; count: number }> = [];
    let careersKilled: Array<{ career: string; count: number }> = [];
    let killersGuilds: Array<{ id: number|string; name: string; count: number }> = [];
    let killersCareers: Array<{ career: string; count: number }> = [];

    const periodText = (() => {
      if (currentPeriod === 'monthly') { const date = new Date(Date.UTC(monthlyYear, monthlyMonth - 1, 1)); const monthName = date.toLocaleString(undefined, { month: 'long' }); return `${monthName} ${monthlyYear}`; }
      return `Week ${weeklyWeek}, ${weeklyYear}`;
    })();

  const row = currentRows.find(r => Number(r.character?.id) === charId);
  const baseCareer = row?.character?.career || careerHint;
  const level = row?.character?.level;
  const rr = row?.character?.renownRank;
  const careerName = baseCareer ? careerLabel(baseCareer) : '';
  const charIcon = careerIconEl(baseCareer);

    const header = `
      <div style="margin-bottom:.35rem;">
        <div class="char-summary">${charIcon} <strong>${name}</strong>${careerName ? ` — ${careerName}` : ''} &nbsp; <span class="muted">Lvl ${level ?? '—'}, RR ${rr ?? '—'}</span></div>
  <div id="qualifyNote" class="muted" style="text-align:center; margin:.2rem 0 .35rem; display:none; color:#ef4444;">Not on leaderboard for this period</div>
        <table class="vlined summary-table">
          <colgroup>
            <col style="width:16.66%" />
            <col style="width:16.66%" />
            <col style="width:16.66%" />
            <col style="width:16.66%" />
            <col style="width:16.66%" />
            <col style="width:16.66%" />
          </colgroup>
          <tbody>
            <tr>
              <th>Kills</th><th>Deaths</th><th>K/D</th><th class="lifetime">Lifetime Kills</th><th class="lifetime">Lifetime Deaths</th><th class="lifetime">Lifetime K/D</th>
            </tr>
            <tr>
              <td class="num"><span id="periodKillsCell">…</span></td>
              <td class="num"><span id="periodDeathsCell">…</span></td>
              <td class="num"><span id="periodKdCell">…</span></td>
              <td class="num lifetime"><span id="totalKillsCell">…</span></td>
              <td class="num lifetime"><span id="totalDeathsCell">…</span></td>
              <td class="num lifetime"><span id="totalKdCell">…</span></td>
            </tr>
          </tbody>
        </table>
      </div>
    `;

    const tableList = (
      title: string,
      arr: Array<{ id?: number|string; name?: string; career?: string; count: number; diff?: number }>,
      opts?: { kind?: 'character'|'guild'|'career'; countLabel?: string; showDiff?: boolean; metric?: 'kills'|'deaths' }
    ) => {
  if (!arr || arr.length === 0) return `<div class="muted">${title}: No data for this period.</div>`;
      const kind = opts?.kind || 'character';
      const countLabel = opts?.countLabel || 'Count';
      const showDiff = !!opts?.showDiff;
      const metric = opts?.metric || (countLabel.toLowerCase() === 'deaths' ? 'deaths' : 'kills');
      const countClass = metric === 'deaths' ? 'neg' : 'pos';
      const signed = (n: number|undefined) => { const v = typeof n === 'number' ? n : 0; if (v > 0) return `+${v}`; if (v < 0) return `${v}`; return '0'; };
      const rowsHtml = arr.slice(0, 10).map((x) => {
        if (kind === 'career') {
          const label = careerLabel(String(x.career || ''));
          const diffVal = typeof x.diff === 'number' ? x.diff : 0; const diffClass = diffVal > 0 ? 'pos' : (diffVal < 0 ? 'neg' : '');
          return `<tr><td><span class="char-cell">${careerIconEl(x.career)} <span>${label}</span></span></td><td class="num ${countClass}">${x.count}</td>${showDiff ? `<td class="num ${diffClass}">${signed(x.diff)}</td>` : ''}</tr>`;
        } else if (kind === 'guild') {
          const label = String(x.name || 'Unknown Guild');
          const diffVal = typeof x.diff === 'number' ? x.diff : 0; const diffClass = diffVal > 0 ? 'pos' : (diffVal < 0 ? 'neg' : '');
          return `<tr><td><span class="char-cell"><span>${label}</span></span></td><td class="num ${countClass}">${x.count}</td>${showDiff ? `<td class="num ${diffClass}">${signed(x.diff)}</td>` : ''}</tr>`;
        } else {
          const label = String(x.name || 'Unknown');
          const diffVal = typeof x.diff === 'number' ? x.diff : 0; const diffClass = diffVal > 0 ? 'pos' : (diffVal < 0 ? 'neg' : '');
          const clickable = x.id != null ? `<a href="#" class="open-score-sheet char-name" data-char-id="${x.id}" data-char-name="${label}"${x.career ? ` data-career="${String(x.career)}"` : ''}>${label}</a>` : `<span class="char-name">${label}</span>`;
          return `<tr><td><span class="char-cell">${careerIconEl(x.career)} ${clickable}</span></td><td class="num ${countClass}">${x.count}</td>${showDiff ? `<td class="num ${diffClass}">${signed(x.diff)}</td>` : ''}</tr>`;
        }
      }).join('');
      const colgroup = showDiff
        ? `<colgroup><col /><col style="width:90px" /><col style="width:70px" /></colgroup>`
        : `<colgroup><col /><col style="width:90px" /></colgroup>`;
      return `
        <div style="margin-top:.5rem;">
          <table class="list-table">
            ${colgroup}
            <thead><tr><th>${title}</th><th class="num">${countLabel}</th>${showDiff ? '<th class="num">+/−</th>' : ''}</tr></thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
        </div>
      `;
    };

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

    const modalTitleEl = document.getElementById('charModalTitle');
    if (modalTitleEl) {
  const sheetKindLabel = (currentPeriod === 'weekly') ? 'Weekly Score Sheet' : 'Monthly Score Sheet';
      modalTitleEl.innerHTML = `
        <div id="sheetLabel_m" class="sheet-label" style="position:absolute;left:0;top:50%;transform:translateY(-50%);font-size:.9rem;opacity:.9;">${sheetKindLabel}</div>
        <div class="period-selector" id="modalPeriodSelector" style="margin-left:0;">
          <button id="periodPrevBtn_m" class="nav-arrow" title="Previous">◀</button>
          <div id="modalPeriodTitle_m" class="period-title">${periodText}</div>
          <button id="periodNextBtn_m" class="nav-arrow" title="Next">▶</button>
        </div>
      `;
      const titleWrap = (modalTitleEl as HTMLElement);
      titleWrap.style.flex = '1'; titleWrap.style.display = 'flex'; titleWrap.style.position = 'relative';
      titleWrap.style.alignItems = 'center'; titleWrap.style.justifyContent = 'center';
      const prevM = document.getElementById('periodPrevBtn_m');
      const nextM = document.getElementById('periodNextBtn_m');
  prevM?.addEventListener('click', async () => { if (currentPeriod === 'weekly') adjustWeek(-1); else adjustMonth(-1); try { await renderModal(true); } catch {} });
  nextM?.addEventListener('click', async () => { if (currentPeriod === 'weekly') adjustWeek(1); else adjustMonth(1); try { await renderModal(true); } catch {} });
    }

    setModalBody(header + grid);
    // Initialize summary using baseCareer to keep icon visible even if not on leaderboard
    updateCharSummary(baseCareer, level, rr);

    // Independently fetch character info by ID to populate career/level/RR even if not on leaderboard
    (async () => {
      const info = await fetchCharacterInfo(charId, { signal: currentModalAbort?.signal } as any);
      if (modalSessionId !== currentModalSessionId) return;
      if (myGen !== __modalRenderGen) return;
      if (info) {
        updateCharSummary(info.career, info.level, info.renownRank);
      }
    })();

    (async () => {
      let lifeKills = 0, lifeDeaths = 0, lifeKd = 0;
      let lifetime = lifetimeCache.get(charId) || null;
      if (!lifetime) {
        try { const lt = await fetchLifetimeTotalsFor(charId, { signal: currentModalAbort?.signal }); lifetime = lt; lifetimeCache.set(charId, lt); }
        catch { lifetime = { kills: 0, deaths: 0, kd: 0, scenarioWins: 0, scenarioLosses: 0 } as any; }
      }
      if (modalSessionId !== currentModalSessionId) return; if (myGen !== __modalRenderGen) return;
      lifeKills = lifetime?.kills ?? 0; lifeDeaths = lifetime?.deaths ?? 0; lifeKd = lifetime?.kd ?? 0;
      const setTextClass = (id: string, text: string, isPos?: boolean|null) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.textContent = text;
        el.classList.remove('pos','neg');
        if (isPos != null) el.classList.add(isPos ? 'pos' : 'neg');
        const td = el.closest('td');
        if (td && td.classList.contains('lifetime')) {
          td.classList.remove('pos','neg');
          if (isPos != null) td.classList.add(isPos ? 'pos' : 'neg');
        }
      };
      setTextClass('totalKillsCell', String(lifeKills), true);
      setTextClass('totalDeathsCell', String(lifeDeaths), false);
      setTextClass('totalKdCell', (lifeKd as number).toFixed(2), (lifeKd as number) >= 1);
    })();

    const setTextClass = (id: string, text: string, isPos?: boolean|null) => { const el = document.getElementById(id); if (!el) return; el.textContent = text; el.classList.remove('pos','neg'); if (isPos != null) el.classList.add(isPos ? 'pos' : 'neg'); };
  const formatPeriodShort = (): string => { if (currentPeriod === 'weekly') return `Week ${weeklyWeek}`; const date = new Date(Date.UTC(monthlyYear, monthlyMonth - 1, 1)); const monthName = date.toLocaleString(undefined, { month: 'long' }); return `${monthName} ${monthlyYear}`; };
  const setQualifyNote = (visible: boolean) => { const el = document.getElementById('qualifyNote') as HTMLElement | null; if (!el) return; if (visible) { el.textContent = `Not on leaderboard for ${formatPeriodShort()}`; el.style.display = ''; } else { el.style.display = 'none'; } };
    let periodSource: 'leaderboard' | 'events' | null = null;

    (async () => {
      try {
        let list: any[] = [];
        if (currentPeriod === 'weekly') { const data = await gql<any>(WEEKLY_QUERY, { year: weeklyYear, week: weeklyWeek }); list = (data?.weeklyKillLeaderboard || []) as any[]; }
        else if (currentPeriod === 'monthly') { const data = await gql<any>(MONTHLY_QUERY, { year: monthlyYear, month: monthlyMonth }); list = (data?.monthlyKillLeaderboard || []) as any[]; }
        if (modalSessionId !== currentModalSessionId) return; if (myGen !== __modalRenderGen) return;
        const found = list.find((r) => String(r?.character?.id) === String(charId));
        const killsVal = typeof found?.kills === 'number' ? found.kills : null;
        const deathsVal = typeof found?.deaths === 'number' ? found.deaths : null;
        const kdVal = (typeof killsVal === 'number' && typeof deathsVal === 'number') ? (deathsVal > 0 ? (killsVal / deathsVal) : killsVal) : null;
        if (killsVal != null && deathsVal != null && kdVal != null) {
          setTextClass('periodKillsCell', String(killsVal), true);
          setTextClass('periodDeathsCell', String(deathsVal), false);
          setTextClass('periodKdCell', kdVal.toFixed(2), kdVal >= 1);
          periodSource = 'leaderboard'; setQualifyNote(false);
          if (found?.character) { updateCharSummary(found.character.career, found.character.level, found.character.renownRank); }
        } else { setQualifyNote(false); }
      } catch { /* ignore */ }
    })();

    try {
      await fetchTopOpponents(charId, {
        fromIso, toIso, fullScan,
        realm: (() => { const c = (row?.character?.career || careerHint) ? String(row?.character?.career || careerHint).toLowerCase() : ''; const orderCareers = new Set([
          'iron_breaker','rune_priest','slayer','engineer','knight_of_the_blazing_sun','bright_wizard',
          'warrior_priest','shadow_warrior','witch_hunter','archmage','sword_master','white_lion'
        ]); if (!c) return undefined as any; return orderCareers.has(c) ? 0 : 1; })() as any,
        includeScenarios: false,
        signal: currentModalAbort?.signal,
        onProgress: (p) => {
          if (modalSessionId !== currentModalSessionId) return; if (myGen !== __modalRenderGen) return;
          victims = p.victims; killers = p.killers; guildsKilled = p.guildsKilled; careersKilled = p.careersKilled; killersGuilds = p.killersGuilds; killersCareers = p.killersCareers;
          if (periodSource !== 'leaderboard') { const k = p.periodStats.kills || 0; const d = p.periodStats.deaths || 0; const kdNow = d > 0 ? (k / d) : k; setTextClass('periodKillsCell', String(k), true); setTextClass('periodDeathsCell', String(d), false); setTextClass('periodKdCell', kdNow.toFixed(2), kdNow >= 1); periodSource = 'events'; setQualifyNote(true); }
          const mount = (id: string, html: string) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };
          mount('victimsTable', tableList('Top Victims', victims, { kind: 'character', countLabel: 'Kills', showDiff: true, metric: 'kills' }));
          mount('guildsKilledTable', tableList('Top Guilds Killed', guildsKilled, { kind: 'guild', countLabel: 'Kills', metric: 'kills', showDiff: true }));
          mount('careersKilledTable', tableList('Top Careers Killed', careersKilled as any, { kind: 'career', countLabel: 'Kills', metric: 'kills', showDiff: true }));
          mount('killersTable', tableList('Top Killers', killers, { kind: 'character', countLabel: 'Deaths', showDiff: true, metric: 'deaths' }));
          mount('killersGuildsTable', tableList('Top Guilds Killed by', killersGuilds, { kind: 'guild', countLabel: 'Deaths', metric: 'deaths', showDiff: true }));
          mount('killersCareersTable', tableList('Top Careers Killed by', killersCareers as any, { kind: 'career', countLabel: 'Deaths', metric: 'deaths', showDiff: true }));
          const s = p.scanned; const scannedEl = document.getElementById('scannedInfo');
          if (scannedEl && s) { const extra = s.hitCap ? ' (capped)' : ''; const label = fullScan ? ' (deep scan)' : ''; const nowTs = (typeof performance !== 'undefined' ? performance.now() : Date.now()); const elapsedSec = Math.max(0, (nowTs - startedAt) / 1000); const text = `Scanned kill events: ${s.killsNodes}/${s.killsTotal} kills, ${s.deathsNodes}/${s.deathsTotal} deaths${label}${extra} — ${elapsedSec.toFixed(1)}s elapsed.`; scannedEl.innerHTML = `<div class="muted" style="margin-top:.25rem;">${text}</div>`; }
        }
      }).then(() => {});
  } catch { const scannedEl = document.getElementById('scannedInfo'); if (scannedEl) scannedEl.innerHTML = `<div class="muted">Failed to load details for this period.</div>`; }
  }

  try { await renderModal(true); } catch { setModalBody('<div class="muted">Failed to load details. Please try again.</div>'); }
}

function setBusy(b: boolean) {
  if (periodPrevBtn) periodPrevBtn.disabled = b;
  if (periodNextBtn) periodNextBtn.disabled = b;
  if (status) status.textContent = b ? 'Loading…' : '';
  document.querySelectorAll<HTMLButtonElement>('.mode-btn').forEach((btn) => (btn.disabled = b));
  if (showByNameBtn) showByNameBtn.disabled = b;
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
// Only support 'weekly' and 'monthly'; coerce any other to 'weekly'
const qsPeriodRaw = (qs.get('period') || '').toLowerCase();
let currentPeriod: 'weekly' | 'monthly' = (qsPeriodRaw === 'monthly' || qsPeriodRaw === 'weekly') ? (qsPeriodRaw as any) : 'weekly';
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
// Yearly mode is removed; no aggregation controls

// Expose probe helpers in the browser console for ad-hoc analysis
(window as any).probeDefault_2495885 = probeDefault_2495885;
(window as any).probeCharacterScenarios = probeCharacterScenarios;

// Abort active modal fetches when the modal closes
onModalClose(() => { try { currentModalAbort?.abort(); } catch {} });
// Also clear modal URL parameters on close
onModalClose(() => { openCharId = null; openCharName = null; updateUrl(); });

// Delegate clicks on the leaderboard table to open the score sheet
tbody.addEventListener('click', async (e: Event) => {
  const t = e.target as HTMLElement;
  const nameEl = t.closest?.('.char-name');
  if (!nameEl) return;
  const tr = t.closest('tr');
  const idAttr = tr?.getAttribute('data-id');
  const charId = idAttr ? Number(idAttr) : NaN;
  const name = (nameEl.textContent || 'Character').trim();
  if (!Number.isFinite(charId)) return;
  await openScoreSheet(charId, name);
});

// Delegate clicks on opponent names inside the modal to open their score sheet
document.addEventListener('click', async (ev) => {
  const target = ev.target as HTMLElement;
  const a = target?.closest?.('a.open-score-sheet') as HTMLAnchorElement | null;
  if (!a) return;
  const modal = a.closest('#charModal');
  if (!modal) return;
  ev.preventDefault();
  const idStr = a.getAttribute('data-char-id');
  const nm = (a.getAttribute('data-char-name') || a.textContent || 'Character').trim();
  const careerHint = a.getAttribute('data-career') || undefined;
  if (!idStr) return;
  const cid = Number(idStr);
  if (!Number.isFinite(cid)) return;
  await openScoreSheet(cid, nm, careerHint);
});

// ---------------------------
// Leaderboard render/control logic (restored)
// ---------------------------

// Live rows for the current view and cache of lifetime totals
let currentRows: Row[] = [];
const lifetimeCache: Map<string | number, LifetimeStats> = new Map();
let lifetimeGeneration = 0;

function updateCurrentButtonState() {
  if (!currentBtn) return;
  const nowD = new Date();
  let isCurrent = false;
  if (currentPeriod === 'weekly') {
    const curW = getISOWeekLocal(nowD);
    const curY = getISOWeekYear(nowD);
    isCurrent = (weeklyWeek === curW) && (weeklyYear === curY);
  } else if (currentPeriod === 'monthly') {
    isCurrent = (monthlyYear === nowD.getUTCFullYear()) && (monthlyMonth === (nowD.getUTCMonth() + 1));
  }
  currentBtn.classList.toggle('active', !!isCurrent);
}

function updatePeriodTitle() {
  if (!periodTitle) return;
  if (currentPeriod === 'monthly') {
    const date = new Date(Date.UTC(monthlyYear, monthlyMonth - 1, 1));
    const monthName = date.toLocaleString(undefined, { month: 'long' });
    periodTitle.textContent = `${monthName} ${monthlyYear}`;
  } else {
    periodTitle.textContent = `Week ${weeklyWeek}, ${weeklyYear}`;
  }
  updateCurrentButtonState();
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
  // Reflect open score sheet in URL for deep-linking
  if (openCharId != null) {
    u.searchParams.set('char', String(openCharId));
    if (openCharName) u.searchParams.set('name', openCharName);
  } else {
    u.searchParams.delete('char');
    u.searchParams.delete('name');
  }
  history.replaceState(null, '', u);
}

function setMode(mode: 'weekly'|'monthly') {
  if (mode === currentPeriod) return;
  currentPeriod = mode;
  (document.documentElement as HTMLElement).setAttribute('data-current-period', currentPeriod);
  document.querySelectorAll<HTMLElement>('.mode-btn').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
  updatePeriodTitle();
  fetchAndRender();
}

function goToCurrent() {
  const nowD = new Date();
  if (currentPeriod === 'weekly') {
    weeklyWeek = getISOWeekLocal(nowD);
    weeklyYear = getISOWeekYear(nowD);
  } else if (currentPeriod === 'monthly') {
    monthlyYear = nowD.getUTCFullYear();
    monthlyMonth = nowD.getUTCMonth() + 1;
  }
  updatePeriodTitle();
  fetchAndRender();
}

function adjustWeek(delta: number) {
  const maxWeeksCurrentYear = isoWeeksInYear(weeklyYear);
  weeklyWeek += delta;
  if (weeklyWeek < 1) {
    weeklyYear -= 1; if (weeklyYear < 2008) weeklyYear = 2008;
    weeklyWeek = isoWeeksInYear(weeklyYear);
  } else if (weeklyWeek > maxWeeksCurrentYear) {
    weeklyYear += 1; if (weeklyYear > 2100) weeklyYear = 2100;
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

async function fetchAndRender(ev?: Event) {
  ev?.preventDefault();
  clearError(); setBusy(true);
  const period = currentPeriod;
  const year = period === 'weekly' ? weeklyYear : monthlyYear;
  try {
    let rows: Row[] = [];
    if (period === 'weekly') {
      const week = weeklyWeek;
      if (!(week >= 1 && week <= 53)) { showError('Invalid ISO week (1-53).'); return; }
      const data = await gql<any>(WEEKLY_QUERY, { year, week });
      rows = (data?.weeklyKillLeaderboard || []) as Row[];
    } else if (period === 'monthly') {
      const month = monthlyMonth;
      if (!(month >= 1 && month <= 12)) { showError('Invalid month (1-12).'); return; }
      const data = await gql<any>(MONTHLY_QUERY, { year, month });
      rows = (data?.monthlyKillLeaderboard || []) as Row[];
    }

    // Sort and rank
    const lifetimeGetter = (r: Row) => lifetimeCache.get(r.character?.id ?? '') || { kills: 0, deaths: 0, kd: 0 } as LifetimeStats;
    const sorted = sortRows(rows, sortField, sortDir, lifetimeGetter);
    sorted.forEach((r, i) => r.rank = i + 1);
    const displayRows: Row[] = sorted;
    currentRows = displayRows.slice();
    if (tbody) renderRows(displayRows, tbody);

    await augmentWithLifetimeTotals(displayRows);

    updateUrl();
    updatePeriodTitle();
  } catch (e: any) {
    showError(String(e?.message || e));
  } finally {
    setBusy(false);
    if (status) status.textContent = '';
  }
}

async function augmentWithLifetimeTotals(rows: Row[]) {
  const gen = ++lifetimeGeneration;
  const ids = rows.map((r) => r.character?.id).filter(Boolean) as (string|number)[];
  const pending = ids.filter((id) => !lifetimeCache.has(id));
  if (pending.length === 0) { if (tbody) populateLifetimeCells(tbody, lifetimeCache); return; }
  if (status) status.textContent = 'Fetching lifetime totals…';
  const chunkSize = 15;
  for (let i = 0; i < pending.length; i += chunkSize) {
    if (gen !== lifetimeGeneration) return;
    const chunk = pending.slice(i, i + chunkSize);
    const varDefs = chunk.map((_, j) => `$v${i + j}: UnsignedInt!`).join(' ');
    const bodyParts = chunk.map((_, j) => `a${i + j}Kills: kills(first:1, where:{ killerCharacterId:{ eq:$v${i + j} } }){ totalCount } a${i + j}Deaths: kills(first:1, where:{ victimCharacterId:{ eq:$v${i + j} } }){ totalCount }`).join(' ');
    const query = `query Lifetime(${varDefs}){ ${bodyParts} }`;
    const vars: Record<string, number> = {}; chunk.forEach((id, j) => { vars[`v${i + j}`] = Number(id); });
    let data: any;
    try { data = await gql<any>(query, vars); } catch { continue; }
    if (gen !== lifetimeGeneration) return;
    chunk.forEach((id, j) => {
      const killsField = `a${i + j}Kills`;
      const deathsField = `a${i + j}Deaths`;
      const kills = data?.[killsField]?.totalCount ?? 0;
      const deaths = data?.[deathsField]?.totalCount ?? 0;
      lifetimeCache.set(id, { kills, deaths, kd: deaths > 0 ? kills / deaths : kills });
    });
    if (status) status.textContent = `Fetching lifetime totals… (${Math.min(i + chunkSize, pending.length)}/${pending.length})`;
  }
  if (gen === lifetimeGeneration) {
    if (tbody) populateLifetimeCells(tbody, lifetimeCache);
  }
}

function applySort(field: SortField) {
  if (sortField === field) { sortDir = sortDir === 'desc' ? 'asc' : 'desc'; }
  else { sortField = field; sortDir = 'desc'; }
  updateSortHeaderState(sortField, sortDir);
  updateUrl();
  const lifetimeGetter = (r: Row) => lifetimeCache.get(r.character?.id ?? '') || { kills: 0, deaths: 0, kd: 0 } as LifetimeStats;
  const base = currentRows.map((r) => r);
  const resorted = sortRows(base, sortField, sortDir, lifetimeGetter);
  resorted.forEach((r, i) => r.rank = i + 1);
  currentRows = resorted.slice();
  if (tbody) renderRows(resorted, tbody);
  if (tbody) populateLifetimeCells(tbody, lifetimeCache);
}

// Wire up header sorters, mode buttons, current button, and period arrows
document.querySelectorAll('th.sortable').forEach((th) => th.addEventListener('click', () => applySort((th as HTMLElement).getAttribute('data-field') as SortField)));
document.querySelectorAll<HTMLElement>('.mode-btn').forEach((btn) => btn.addEventListener('click', () => {
  const mode = (btn.dataset.mode as 'weekly'|'monthly'|undefined);
  if (!mode || (mode !== 'weekly' && mode !== 'monthly')) return;
  setMode(mode);
}));
document.querySelectorAll<HTMLElement>('.mode-btn').forEach((b) => b.classList.toggle('active', (b.dataset.mode as any) === currentPeriod));
currentBtn?.addEventListener('click', goToCurrent);
periodPrevBtn?.addEventListener('click', () => { if (currentPeriod === 'weekly') adjustWeek(-1); else adjustMonth(-1); });
periodNextBtn?.addEventListener('click', () => { if (currentPeriod === 'weekly') adjustWeek(1); else adjustMonth(1); });

// Footer: open score sheet by typed name
async function openByName() {
  const nm = (nameInput?.value || '').trim();
  if (!nm) return;
  setBusy(true);
  try {
    const resolved = await resolveCharacterByName(nm);
    if (!resolved) {
      if (status) status.textContent = `No character found named "${nm}"`;
      return;
    }
    await openScoreSheet(Number(resolved.id), resolved.name || nm);
  } catch (e:any) {
    if (status) status.textContent = String(e?.message || 'Failed to resolve character');
  } finally {
    setBusy(false);
  }
}
showByNameBtn?.addEventListener('click', () => { openByName(); });
nameInput?.addEventListener('keydown', (ev: KeyboardEvent) => {
  if (ev.key === 'Enter') { ev.preventDefault(); openByName(); }
});

// Initial render
updatePeriodTitle();
const initialCharIdParam = (() => { const s = qs.get('char'); const n = s ? Number(s) : NaN; return Number.isFinite(n) ? n : null; })();
const initialCharNameParam = qs.get('name') || null;
fetchAndRender().then(async () => {
  if (initialCharIdParam != null) {
    try { await openScoreSheet(initialCharIdParam, initialCharNameParam || 'Character'); } catch {}
  }
});
