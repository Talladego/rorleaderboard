import { gql, WEEKLY_QUERY, MONTHLY_QUERY, WEEKLY_GUILD_QUERY, MONTHLY_GUILD_QUERY, fetchCharacterInfo, resolveCharacterByName, resolveGuildByName, WEEKLY_QUERY_NO_GUILD, MONTHLY_QUERY_NO_GUILD } from './api/graphql';
import { renderRows, updateSortHeaderState } from './ui/table';
import { Row, SortDir, SortField, sortRows, getPeriodBounds, careerLabel, LifetimeStats } from './logic';
import { initModal, openModal, setModalBody, setModalLoading, onModalClose } from './ui/modal';
import { fetchLifetimeTotalsFor, fetchTopOpponents, fetchLifetimeSoloKills, fetchTopOpponentsForGuild } from './api/graphql';
import { probeDefault_2495885, probeCharacterScenarios } from './api/scenarioProbe';

// DOM refs
const periodTitle = document.getElementById('periodTitle') as HTMLElement | null;
const status = document.getElementById('status') as HTMLElement | null;
const errorBox = document.getElementById('errorBox') as HTMLElement | null;
const currentBtn = document.getElementById('periodCurrentBtn') as HTMLButtonElement | null;
const modeSelect = document.getElementById('modeSelect') as HTMLSelectElement | null;
const periodPrevBtn = document.getElementById('periodPrevBtn') as HTMLButtonElement | null;
const periodNextBtn = document.getElementById('periodNextBtn') as HTMLButtonElement | null;
const tbody = document.getElementById('tbody') as HTMLElement | null;
const nameInput = document.getElementById('nameInput') as HTMLInputElement | null;
const showByNameBtn = document.getElementById('showByNameBtn') as HTMLButtonElement | null;
const boardSelect = document.getElementById('boardSelect') as HTMLSelectElement | null;

if (!tbody) throw new Error('tbody not found');
initModal();

// Modal: session management for aborting in-flight requests
let currentModalSessionId = 0;
let currentModalAbort: AbortController | null = null;
let openCharId: number | null = null;
let openCharName: string | null = null;
let openGuildId: number | null = null;
let openGuildName: string | null = null;

// Reusable: open the score sheet modal for a given character id and name (same period)
// Optional careerHint helps when opening from modal lists where the char may not be on the leaderboard rows.
async function openScoreSheet(charId: number, name: string, careerHint?: string) {
  try { currentModalAbort?.abort(); } catch {}
  currentModalAbort = new AbortController();
  const modalSessionId = ++currentModalSessionId;

  // Track open character and reflect in URL so it is linkable
  openGuildId = null; openGuildName = null;
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
  function realmIconEl(realm?: string) {
    const r = String(realm||'').toUpperCase();
    if (r === 'ORDER') return `<img class="career-icon" src="https://killboard.returnofreckoning.com/images/icons/scenario/order.png" alt="Order" title="Order" />`;
    if (r === 'DESTRUCTION') return `<img class="career-icon" src="https://killboard.returnofreckoning.com/images/icons/scenario/destruction.png" alt="Destruction" title="Destruction" />`;
    return '';
  }
  // Persist guild once known to avoid being overwritten by later updates
  let guildIdForHeader: number | undefined;
  let guildNameForHeader: string | undefined;
  let guildRealmForHeader: string | undefined;
  function updateCharSummary(career?: string, level?: number, rr?: number, guildName?: string, guildRealm?: string, guildId?: number) {
    const el = document.querySelector('#charModal .char-summary') as HTMLElement | null;
    if (!el) return;
    // Preserve any badges already rendered
    const existingBadges = (el.querySelector('#charBadgesSlot') as HTMLElement | null)?.innerHTML || '';
    if (typeof guildName === 'string' && guildName) guildNameForHeader = guildName;
    if (typeof guildRealm === 'string' && guildRealm) guildRealmForHeader = guildRealm;
    if (typeof guildId === 'number' && Number.isFinite(guildId)) guildIdForHeader = guildId;
    const icon = careerIconEl(career);
    const gname = guildNameForHeader;
    const realmIcon = gname ? realmIconEl(guildRealmForHeader) : '';
    const clickableGuild = (gname && guildIdForHeader != null)
      ? `<a href="#" class="open-guild-sheet guild-name char-name" data-guild-id="${guildIdForHeader}" data-guild-name="${gname}"${guildRealmForHeader ? ` data-guild-realm="${guildRealmForHeader}"` : ''}>${gname}</a>`
      : (gname ? `<span class="guild-name char-name">${gname}</span>` : '');
    const nameWithGuild = gname ? `<strong>${name}</strong> (${realmIcon}${clickableGuild})` : `<strong>${name}</strong>`;
    el.innerHTML = `
      <div class="char-line1">${icon} ${nameWithGuild} <span id="charBadgesSlot" style="display:inline-flex;gap:8px;vertical-align:middle;margin-left:.4rem;">${existingBadges}</span></div>
      <div class="char-line2 muted">Level ${level ?? '—'}, RR ${rr ?? '—'}</div>
    `;
  }

  let __modalRenderGen = 0;
  async function renderModal(fullScan = false) {
    const myGen = ++__modalRenderGen;
    let { fromIso, toIso } = getPeriodBounds(currentPeriod, { weeklyYear, weeklyWeek, monthlyYear, monthlyMonth });
    const startedAt = (typeof performance !== 'undefined' ? performance.now() : Date.now());

    let victims: Array<{ id: number|string; name: string; career?: string; count: number }> = [];
    let killers: Array<{ id: number|string; name: string; career?: string; count: number }> = [];
    let guildsKilled: Array<{ id: number|string; name: string; count: number; realm?: string }> = [];
    let careersKilled: Array<{ career: string; count: number }> = [];
    let killersGuilds: Array<{ id: number|string; name: string; count: number; realm?: string }> = [];
    let killersCareers: Array<{ career: string; count: number }> = [];

    const periodText = (() => {
      if (currentPeriod === 'monthly') { const date = new Date(Date.UTC(monthlyYear, monthlyMonth - 1, 1)); const monthName = date.toLocaleString(undefined, { month: 'long' }); return `${monthName} ${monthlyYear}`; }
      return `Week ${weeklyWeek}, ${weeklyYear}`;
    })();

  const row = currentRows.find(r => Number(r.character?.id) === charId);
  const baseCareer = row?.character?.career || careerHint;
  const level = row?.character?.level;
  const rr = row?.character?.renownRank;
  // career label no longer shown in header
  const charIcon = careerIconEl(baseCareer);

    const header = `
      <div style="margin-bottom:.35rem;">
        <div class="char-summary">
          <div class="char-line1">${charIcon} <strong>${name}</strong></div>
          <div class="char-line2 muted">Level ${level ?? '—'}, RR ${rr ?? '—'}</div>
        </div>
  <div id="qualifyNote" class="muted" style="text-align:center; margin:.2rem 0 .35rem; display:none; color:#ef4444;">Not on leaderboard for this period</div>
        <table class="vlined summary-table">
          <colgroup>
            <col style="width:10%" />
            <col style="width:10%" />
            <col style="width:10%" />
            <col style="width:10%" />
            <col style="width:10%" />
            <col style="width:10%" />
            <col style="width:10%" />
            <col style="width:10%" />
            <col style="width:10%" />
            <col style="width:10%" />
          </colgroup>
          <tbody>
            <tr>
              <th>Kills</th><th>Deaths</th><th>KDR</th><th>Solo Kills</th><th>Solo Kills %</th><th class="lifetime">Lifetime Kills</th><th class="lifetime">Lifetime Deaths</th><th class="lifetime">Lifetime KDR</th><th class="lifetime">Lifetime Solo Kills</th><th class="lifetime">Lifetime Solo Kills %</th>
            </tr>
            <tr>
              <td class="num"><span class="cell-wrap"><span id="periodKillsIcon" class="icon-slot medal-slot"></span><span id="periodKillsCell">…</span></span></td>
              <td class="num"><span class="cell-wrap"><span id="periodDeathsIcon" class="icon-slot deaths-slot"></span><span id="periodDeathsCell">…</span></span></td>
              <td class="num"><span class="cell-wrap"><span id="periodKdIcon" class="icon-slot kd-slot"></span><span id="periodKdCell">…</span></span></td>
              <td class="num"><span id="periodSoloKillsCell">…</span></td>
              <td class="num"><span id="periodSoloPctCell">…</span></td>
              <td class="num lifetime"><span id="totalKillsCell">…</span></td>
              <td class="num lifetime"><span id="totalDeathsCell">…</span></td>
              <td class="num lifetime"><span id="totalKdCell">…</span></td>
              <td class="num lifetime"><span id="totalSoloKillsCell">…</span></td>
              <td class="num lifetime"><span id="totalSoloPctCell">…</span></td>
            </tr>
          </tbody>
        </table>
      </div>
    `;

    const tableList = (
      title: string,
      arr: Array<{ id?: number|string; name?: string; career?: string; realm?: string; count: number; diff?: number }>,
      opts?: { kind?: 'character'|'guild'|'career'; countLabel?: string; showDiff?: boolean; metric?: 'kills'|'deaths'; loading?: boolean }
    ) => {
  if (!arr || arr.length === 0) return `<div class="muted">${title}: No data for this period.</div>`;
      const kind = opts?.kind || 'character';
      const countLabel = opts?.countLabel || 'Count';
      const showDiff = !!opts?.showDiff;
      const metric = opts?.metric || (countLabel.toLowerCase() === 'deaths' ? 'deaths' : 'kills');
      const countClass = metric === 'deaths' ? 'neg' : 'pos';
      const signed = (n: number|undefined) => { const v = typeof n === 'number' ? n : 0; if (v > 0) return `+${v}`; if (v < 0) return `${v}`; return '0'; };
      const realmIconEl = (realm?: string) => {
        const r = String(realm||'').toUpperCase();
        if (r === 'ORDER') return `<img class="career-icon" src="https://killboard.returnofreckoning.com/images/icons/scenario/order.png" alt="Order" title="Order" />`;
        if (r === 'DESTRUCTION') return `<img class="career-icon" src="https://killboard.returnofreckoning.com/images/icons/scenario/destruction.png" alt="Destruction" title="Destruction" />`;
        return '';
      };
      const rowsHtml = arr.slice(0, 10).map((x) => {
        if (kind === 'career') {
          const label = careerLabel(String(x.career || ''));
          const diffVal = typeof x.diff === 'number' ? x.diff : 0; const diffClass = diffVal > 0 ? 'pos' : (diffVal < 0 ? 'neg' : '');
          return `<tr><td><span class="char-cell">${careerIconEl(x.career)} <span>${label}</span></span></td><td class="num ${countClass}">${x.count}</td>${showDiff ? `<td class="num ${diffClass}">${signed(x.diff)}</td>` : ''}</tr>`;
        } else if (kind === 'guild') {
          const label = String(x.name || 'Unknown Guild');
          const diffVal = typeof x.diff === 'number' ? x.diff : 0; const diffClass = diffVal > 0 ? 'pos' : (diffVal < 0 ? 'neg' : '');
          const clickableGuild = x.id != null
            ? `<a href="#" class="open-guild-sheet guild-name char-name" data-guild-id="${x.id}" data-guild-name="${label}"${x.realm ? ` data-guild-realm="${x.realm}"` : ''}>${label}</a>`
            : `<span class="guild-name char-name"${x.realm ? ` data-guild-realm="${x.realm}"` : ''}>${label}</span>`;
          return `<tr><td><span class="char-cell">${realmIconEl(x.realm)} ${clickableGuild}</span></td><td class="num ${countClass}">${x.count}</td>${showDiff ? `<td class="num ${diffClass}">${signed(x.diff)}</td>` : ''}</tr>`;
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
            <thead><tr><th>${title}${opts?.loading ? ' <span class="spinner" title="Loading…"></span>' : ''}</th><th class="num">${countLabel}</th>${showDiff ? '<th class="num">+/−</th>' : ''}</tr></thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
        </div>
      `;
    };

    const grid = `
      <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.5rem;align-items:start;">
        <div id="victimsTable"><div class="muted">Loading Top Players Killed…</div></div>
        <div id="guildsKilledTable"><div class="muted">Loading Top Guilds Killed…</div></div>
        <div id="careersKilledTable"><div class="muted">Loading Top Careers Killed…</div></div>
        <div id="killersTable"><div class="muted">Loading Top Players Killed by…</div></div>
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
        <div id="sheetLabel_m" class="sheet-label" style="position:absolute;left:12px;top:50%;transform:translateY(-50%);font-size:.9rem;opacity:.9;">${sheetKindLabel}</div>
        <div class="period-selector" id="modalPeriodSelector" style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);">
          <button id="periodPrevBtn_m" class="nav-arrow" title="Previous">◀</button>
          <div id="modalPeriodTitle_m" class="period-title">${periodText}</div>
          <button id="periodNextBtn_m" class="nav-arrow" title="Next">▶</button>
        </div>
      `;
  const titleWrap = (modalTitleEl as HTMLElement);
  titleWrap.style.flex = '1'; titleWrap.style.display = 'flex'; titleWrap.style.position = 'static';
  titleWrap.style.alignItems = 'center'; titleWrap.style.justifyContent = 'center';
  const headerWrap = titleWrap.parentElement as HTMLElement | null;
  if (headerWrap) headerWrap.style.position = 'relative';
      const prevM = document.getElementById('periodPrevBtn_m');
      const nextM = document.getElementById('periodNextBtn_m');
  prevM?.addEventListener('click', async () => { if (currentPeriod === 'weekly') adjustWeek(-1); else adjustMonth(-1); try { await renderModal(true); } catch {} });
  nextM?.addEventListener('click', async () => { if (currentPeriod === 'weekly') adjustWeek(1); else adjustMonth(1); try { await renderModal(true); } catch {} });
    }

    setModalBody(header + grid);
    // Initialize summary, include guild from leaderboard row if available
    const rowGuild: any = (row as any)?.character?.guildMembership?.guild || (row as any)?.character?.guild;
    const rowGuildId = rowGuild?.id != null ? Number(rowGuild.id) : undefined;
    const rowGuildName = rowGuild?.name as string | undefined;
    const rowGuildRealm = rowGuild?.realm as string | undefined;
    updateCharSummary(baseCareer, level, rr, rowGuildName, rowGuildRealm, rowGuildId);

    // Independently fetch character info by ID to populate career/level/RR and Guild even if not on leaderboard
    (async () => {
      const info = await fetchCharacterInfo(charId, { signal: currentModalAbort?.signal } as any);
      if (modalSessionId !== currentModalSessionId) return;
      if (myGen !== __modalRenderGen) return;
      if (info) {
        const gid = info.guild?.id != null ? Number(info.guild.id) : undefined;
        updateCharSummary(info.career, info.level, info.renownRank, info.guild?.name, info.guild?.realm, gid);
      }
    })();

    (async () => {
      let lifeKills = 0, lifeDeaths = 0, lifeSolo = 0;
      let lifetime = lifetimeCache.get(charId) || null;
      if (!lifetime) {
        try { const lt = await fetchLifetimeTotalsFor(charId, { signal: currentModalAbort?.signal }); lifetime = lt; lifetimeCache.set(charId, lt); }
        catch { lifetime = { kills: 0, deaths: 0, kd: 0, scenarioWins: 0, scenarioLosses: 0 } as any; }
      }
      if (modalSessionId !== currentModalSessionId) return; if (myGen !== __modalRenderGen) return;
      lifeKills = lifetime?.kills ?? 0; lifeDeaths = lifetime?.deaths ?? 0;
      try { lifeSolo = await fetchLifetimeSoloKills(charId, { signal: currentModalAbort?.signal }); } catch { lifeSolo = 0; }
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
      const lifeKdDisplay = lifeDeaths > 0 ? (lifeKills / lifeDeaths) : (lifeKills > 0 ? Number.POSITIVE_INFINITY : 0);
      setTextClass('totalKdCell', lifeKdDisplay === Number.POSITIVE_INFINITY ? '∞' : (lifeKdDisplay as number).toFixed(2), (lifeKdDisplay as number) >= 1);
      setTextClass('totalSoloKillsCell', String(lifeSolo), true);
      const lifePct = lifeKills > 0 ? Math.round((lifeSolo / lifeKills) * 100) : 0;
      setTextClass('totalSoloPctCell', `${lifePct}%`, lifePct >= 50);
    })();

    const setTextClass = (id: string, text: string, isPos?: boolean|null) => { const el = document.getElementById(id); if (!el) return; el.textContent = text; el.classList.remove('pos','neg'); if (isPos != null) el.classList.add(isPos ? 'pos' : 'neg'); };
    let periodKillsCount: number | null = null;
    let periodSoloCount: number | null = null;
    const updateSoloPct = () => {
      if (periodKillsCount == null || periodSoloCount == null) return;
      const pct = periodKillsCount > 0 ? (periodSoloCount / periodKillsCount) * 100 : 0;
      setTextClass('periodSoloPctCell', `${Math.round(pct)}%`, pct >= 50);
    };
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
        const kdVal = (typeof killsVal === 'number' && typeof deathsVal === 'number')
          ? (deathsVal > 0 ? (killsVal / deathsVal) : (killsVal > 0 ? Number.POSITIVE_INFINITY : 0))
          : null;
        if (killsVal != null && deathsVal != null && kdVal != null) {
          periodKillsCount = killsVal;
          setTextClass('periodKillsCell', String(killsVal), true);
          // Solo kills not on leaderboard; will be filled by a separate query below
          setTextClass('periodDeathsCell', String(deathsVal), false);
          setTextClass('periodKdCell', kdVal === Number.POSITIVE_INFINITY ? '∞' : kdVal.toFixed(2), kdVal >= 1);
          updateSoloPct();
          periodSource = 'leaderboard'; setQualifyNote(false);
          if (found?.character) { updateCharSummary(found.character.career, found.character.level, found.character.renownRank); }

          // Compute period badges from the full leaderboard list (players only)
          try {
            const listRows = (list || []).map((e: any) => ({ id: e?.character?.id, name: e?.character?.name || '', kills: e?.kills || 0, deaths: e?.deaths || 0 }));
            const cmpName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' });
            // Top-3 by kills (grouped by identical kills+deaths; tie-order by name for display)
            const byKills = listRows.slice().sort((a, b) => {
              if (b.kills !== a.kills) return b.kills - a.kills;
              if (a.deaths !== b.deaths) return a.deaths - b.deaths;
              return cmpName(a.name, b.name);
            });
            // Build group placements based on unique (kills|deaths)
            const groupPlacement = new Map<string, number>();
            for (let i = 0; i < byKills.length && groupPlacement.size < 3; i++) {
              const key = `${byKills[i].kills}|${byKills[i].deaths}`;
              if (!groupPlacement.has(key)) groupPlacement.set(key, groupPlacement.size + 1);
            }
            const myKey = (() => {
              const me = byKills.find((x) => String(x.id) === String(charId));
              return me ? `${me.kills}|${me.deaths}` : '';
            })();
            const placement = myKey ? (groupPlacement.get(myKey) || 0) : 0;

            // Highest K/D (group winners allowed)
            const byKd = listRows.slice().sort((a, b) => {
              const ak = a.deaths > 0 ? a.kills / a.deaths : (a.kills > 0 ? Number.POSITIVE_INFINITY : 0);
              const bk = b.deaths > 0 ? b.kills / b.deaths : (b.kills > 0 ? Number.POSITIVE_INFINITY : 0);
              if (bk !== ak) return bk - ak;
              if (b.kills !== a.kills) return b.kills - a.kills;
              if (a.deaths !== b.deaths) return a.deaths - b.deaths;
              return cmpName(a.name, b.name);
            });
            const gcd = (a: number, b: number) => { a = Math.abs(a|0); b = Math.abs(b|0); while (b !== 0) { const t = a % b; a = b; b = t; } return a || 1; };
            const kdKey = (x: {kills:number;deaths:number}): string => {
              const k = x.kills|0; const d = x.deaths|0;
              if (d <= 0) return `z:${k}`;
              const g = gcd(k, d);
              return `f:${(k/g)|0}/${(d/g)|0}`;
            };
            const topKdKey = byKd.length ? kdKey(byKd[0]) : '';
            const topKdKills = byKd.length ? byKd[0].kills : undefined;

            // Most deaths
            const byDeaths = listRows.slice().sort((a, b) => {
              if (b.deaths !== a.deaths) return b.deaths - a.deaths;
              if (b.kills !== a.kills) return b.kills - a.kills;
              return cmpName(a.name, b.name);
            });
            const topDeathsVal = byDeaths.length ? byDeaths[0].deaths : undefined;
            const minKillsAtTopDeaths = (() => {
              if (topDeathsVal == null) return undefined as number | undefined;
              let mk: number | undefined;
              for (const x of byDeaths) {
                if (x.deaths !== topDeathsVal) break;
                if (mk == null || x.kills < mk) mk = x.kills;
              }
              return mk;
            })();

            const killsIcon = document.getElementById('periodKillsIcon');
            const kdIcon = document.getElementById('periodKdIcon');
            const deathsIcon = document.getElementById('periodDeathsIcon');
            if (killsIcon) killsIcon.innerHTML = (placement === 1)
              ? '<span class="star kill gold" title="Top 1 by kills" aria-label="Top 1 by kills">★</span>'
              : (placement === 2)
                ? '<span class="star kill silver" title="Top 2 by kills" aria-label="Top 2 by kills">★</span>'
                : (placement === 3)
                  ? '<span class="star kill bronze" title="Top 3 by kills" aria-label="Top 3 by kills">★</span>'
                  : '';
            if (kdIcon) kdIcon.innerHTML = (topKdKey && topKdKills != null && kdKey({ kills: killsVal, deaths: deathsVal }) === topKdKey && killsVal === topKdKills)
              ? '<span class="badge kd" title="Highest KDR" aria-label="Highest KDR">⚡︎</span>'
              : '';
            if (deathsIcon) deathsIcon.innerHTML = (topDeathsVal != null && minKillsAtTopDeaths != null && deathsVal === topDeathsVal && killsVal === minKillsAtTopDeaths)
              ? '<span class="badge deaths" title="Most Deaths" aria-label="Most Deaths">✚</span>'
              : '';
          } catch {}
        } else { setQualifyNote(false); }
      } catch { /* ignore */ }
    })();

    // Fetch solo kills for the period using GraphQL kills(soloOnly: true) totalCount
    (async () => {
      try {
        const fromTs = Math.floor(new Date(fromIso).getTime() / 1000);
        const toTs = Math.floor(new Date(toIso).getTime() / 1000);
        const SOLO_QUERY = `
          query SoloKills($cid: UnsignedInt!, $from: Int!, $to: Int!) {
            kills(soloOnly: true, where: { killerCharacterId: { eq: $cid }, time: { gte: $from, lt: $to } }) {
              totalCount
            }
          }
        `;
        const data = await gql<any>(SOLO_QUERY, { cid: Number(charId), from: fromTs, to: toTs }, { signal: currentModalAbort?.signal });
        if (modalSessionId !== currentModalSessionId) return; if (myGen !== __modalRenderGen) return;
        const solo = Number(data?.kills?.totalCount ?? 0);
        periodSoloCount = solo;
        setTextClass('periodSoloKillsCell', String(solo), true);
        updateSoloPct();
      } catch {
        // leave as ellipsis if failed
      }
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
          if (periodSource !== 'leaderboard') { const k = p.periodStats.kills || 0; const d = p.periodStats.deaths || 0; const kdNow = d > 0 ? (k / d) : (k > 0 ? Number.POSITIVE_INFINITY : 0); periodKillsCount = k; setTextClass('periodKillsCell', String(k), true); setTextClass('periodDeathsCell', String(d), false); setTextClass('periodKdCell', kdNow === Number.POSITIVE_INFINITY ? '∞' : kdNow.toFixed(2), kdNow >= 1); const ki=document.getElementById('periodKillsIcon'); if(ki) ki.innerHTML=''; const di=document.getElementById('periodDeathsIcon'); if(di) di.innerHTML=''; const kdi=document.getElementById('periodKdIcon'); if(kdi) kdi.innerHTML=''; updateSoloPct(); periodSource = 'events'; setQualifyNote(true); }
          const mount = (id: string, html: string) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };
          const s = p.scanned; const done = !!(s && s.killsNodes >= s.killsTotal && s.deathsNodes >= s.deathsTotal);
          mount('victimsTable', tableList('Top Players Killed', victims, { kind: 'character', countLabel: 'Kills', showDiff: true, metric: 'kills', loading: !done }));
          mount('guildsKilledTable', tableList('Top Guilds Killed', guildsKilled, { kind: 'guild', countLabel: 'Kills', metric: 'kills', showDiff: true, loading: !done }));
          mount('careersKilledTable', tableList('Top Careers Killed', careersKilled as any, { kind: 'career', countLabel: 'Kills', metric: 'kills', showDiff: true, loading: !done }));
          mount('killersTable', tableList('Top Players Killed by', killers, { kind: 'character', countLabel: 'Deaths', showDiff: true, metric: 'deaths', loading: !done }));
          mount('killersGuildsTable', tableList('Top Guilds Killed by', killersGuilds, { kind: 'guild', countLabel: 'Deaths', metric: 'deaths', showDiff: true, loading: !done }));
          mount('killersCareersTable', tableList('Top Careers Killed by', killersCareers as any, { kind: 'career', countLabel: 'Deaths', metric: 'deaths', showDiff: true, loading: !done }));
          const scannedEl = document.getElementById('scannedInfo');
          if (scannedEl && s) { const extra = s.hitCap ? ' (capped)' : ''; const label = fullScan ? ' (deep scan)' : ''; const nowTs = (typeof performance !== 'undefined' ? performance.now() : Date.now()); const elapsedSec = Math.max(0, (nowTs - startedAt) / 1000); const text = `Scanned kill events: ${s.killsNodes}/${s.killsTotal} kills, ${s.deathsNodes}/${s.deathsTotal} deaths${label}${extra} — ${elapsedSec.toFixed(1)}s elapsed.`; scannedEl.innerHTML = `<div class="muted" style="margin-top:.25rem;">${text}</div>`; }
        }
      }).then(() => {});
  } catch { const scannedEl = document.getElementById('scannedInfo'); if (scannedEl) scannedEl.innerHTML = `<div class="muted">Failed to load details for this period.</div>`; }
  }

  try { await renderModal(true); } catch { setModalBody('<div class="muted">Failed to load details. Please try again.</div>'); }
}

// Guild score sheet for the current period (no lifetime)
async function openGuildScoreSheet(guildId: number, name: string, realmHint?: string) {
  try { currentModalAbort?.abort(); } catch {}
  currentModalAbort = new AbortController();
  const modalSessionId = ++currentModalSessionId;

  // Track open guild and reflect in URL so it is linkable
  openCharId = null; openCharName = null;
  openGuildId = Number(guildId);
  openGuildName = String(name || 'Guild');
  updateUrl();

  openModal('', '');
  setModalLoading();

  const realmIconEl = (realm?: string) => {
    const r = String(realm||'').toUpperCase();
    if (r === 'ORDER') return `<img class="career-icon" src="https://killboard.returnofreckoning.com/images/icons/scenario/order.png" alt="Order" title="Order" />`;
    if (r === 'DESTRUCTION') return `<img class="career-icon" src="https://killboard.returnofreckoning.com/images/icons/scenario/destruction.png" alt="Destruction" title="Destruction" />`;
    return '';
  };
  const careerKey = (career?: string) => {
    if (!career) return '';
    const raw = String(career).toLowerCase();
    const exceptions: Record<string, string> = { 'iron_breaker': 'ironbreaker' };
    return exceptions[raw] ?? raw.replace(/_/g, '-');
  };
  const careerIconEl = (career?: string) => {
    if (!career) return '';
    const key = careerKey(career);
    const label = careerLabel(career);
    const remote = `https://killboard.returnofreckoning.com/images/icons/${key}.png`;
    const local = `/icons/careers/${key}.png`;
    return `<img class="career-icon" src="${remote}" alt="${label}" title="${label}" onerror="this.onerror=null;this.src='${local}';" />`;
  };

  let __modalRenderGen = 0;
  async function renderModal() {
    const myGen = ++__modalRenderGen;
    const { fromIso, toIso } = getPeriodBounds(currentPeriod, { weeklyYear, weeklyWeek, monthlyYear, monthlyMonth });
    const periodText = (() => {
      if (currentPeriod === 'monthly') { const date = new Date(Date.UTC(monthlyYear, monthlyMonth - 1, 1)); const monthName = date.toLocaleString(undefined, { month: 'long' }); return `${monthName} ${monthlyYear}`; }
      return `Week ${weeklyWeek}, ${weeklyYear}`;
    })();
    const effectiveRealm = realmHint || (currentRows.find(r => String(r.character?.id) === String(guildId))?.character?.realm);

    const header = `
      <div style="margin-bottom:.35rem;">
        <div class="char-summary">
          <div class="char-line1">${realmIconEl(effectiveRealm)} <strong>${name}</strong></div>
        </div>
        <table class="vlined summary-table">
          <colgroup>
            <col style="width:10%" />
            <col style="width:10%" />
            <col style="width:10%" />
          </colgroup>
          <tbody>
            <tr>
              <th>Kills</th><th>Deaths</th><th>KDR</th>
            </tr>
            <tr>
              <td class="num"><span id="g_periodKillsCell">…</span></td>
              <td class="num"><span id="g_periodDeathsCell">…</span></td>
              <td class="num"><span id="g_periodKdCell">…</span></td>
            </tr>
          </tbody>
        </table>
      </div>
    `;

    const modalTitleEl = document.getElementById('charModalTitle');
    if (modalTitleEl) {
      const sheetKindLabel = (currentPeriod === 'weekly') ? 'Weekly Guild Score Sheet' : 'Monthly Guild Score Sheet';
      modalTitleEl.innerHTML = `
        <div id="sheetLabel_m" class="sheet-label" style="position:absolute;left:12px;top:50%;transform:translateY(-50%);font-size:.9rem;opacity:.9;">${sheetKindLabel}</div>
        <div class="period-selector" id="modalPeriodSelector" style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);">
          <button id="periodPrevBtn_m" class="nav-arrow" title="Previous">◀</button>
          <div id="modalPeriodTitle_m" class="period-title">${periodText}</div>
          <button id="periodNextBtn_m" class="nav-arrow" title="Next">▶</button>
        </div>
      `;
      const titleWrap = (modalTitleEl as HTMLElement);
      titleWrap.style.flex = '1'; titleWrap.style.display = 'flex'; titleWrap.style.position = 'static';
      titleWrap.style.alignItems = 'center'; titleWrap.style.justifyContent = 'center';
      const headerWrap = titleWrap.parentElement as HTMLElement | null;
      if (headerWrap) headerWrap.style.position = 'relative';
      const prevM = document.getElementById('periodPrevBtn_m');
      const nextM = document.getElementById('periodNextBtn_m');
      prevM?.addEventListener('click', async () => { if (currentPeriod === 'weekly') adjustWeek(-1); else adjustMonth(-1); try { await renderModal(); } catch {} });
      nextM?.addEventListener('click', async () => { if (currentPeriod === 'weekly') adjustWeek(1); else adjustMonth(1); try { await renderModal(); } catch {} });
    }

    // Local helpers for guild lists and layout
    const tableList = (
      title: string,
      arr: Array<{ id?: number|string; name?: string; career?: string; realm?: string; count: number; diff?: number }>,
      opts?: { kind?: 'character'|'guild'|'career'; countLabel?: string; showDiff?: boolean; metric?: 'kills'|'deaths'; loading?: boolean }
    ) => {
      if (!arr || arr.length === 0) return `<div class="muted">${title}: No data for this period.</div>`;
      const kind = opts?.kind || 'character';
      const countLabel = opts?.countLabel || 'Count';
      const showDiff = !!opts?.showDiff;
      const metric = opts?.metric || (countLabel.toLowerCase() === 'deaths' ? 'deaths' : 'kills');
      const countClass = metric === 'deaths' ? 'neg' : 'pos';
      const signed = (n: number|undefined) => { const v = typeof n === 'number' ? n : 0; if (v > 0) return `+${v}`; if (v < 0) return `${v}`; return '0'; };
      const realmIconEl = (realm?: string) => {
        const r = String(realm||'').toUpperCase();
        if (r === 'ORDER') return `<img class="career-icon" src="https://killboard.returnofreckoning.com/images/icons/scenario/order.png" alt="Order" title="Order" />`;
        if (r === 'DESTRUCTION') return `<img class="career-icon" src="https://killboard.returnofreckoning.com/images/icons/scenario/destruction.png" alt="Destruction" title="Destruction" />`;
        return '';
      };
      const rowsHtml = arr.slice(0, 10).map((x) => {
        if (kind === 'career') {
          const label = careerLabel(String(x.career || ''));
          const diffVal = typeof x.diff === 'number' ? x.diff : 0; const diffClass = diffVal > 0 ? 'pos' : (diffVal < 0 ? 'neg' : '');
          return `<tr><td><span class="char-cell">${careerIconEl(x.career)} <span>${label}</span></span></td><td class="num ${countClass}">${x.count}</td>${showDiff ? `<td class="num ${diffClass}">${signed(x.diff)}</td>` : ''}</tr>`;
        } else if (kind === 'guild') {
          const label = String(x.name || 'Unknown Guild');
          const diffVal = typeof x.diff === 'number' ? x.diff : 0; const diffClass = diffVal > 0 ? 'pos' : (diffVal < 0 ? 'neg' : '');
          const clickableGuild = x.id != null
            ? `<a href="#" class="open-guild-sheet guild-name char-name" data-guild-id="${x.id}" data-guild-name="${label}"${x.realm ? ` data-guild-realm="${x.realm}"` : ''}>${label}</a>`
            : `<span class="guild-name char-name"${x.realm ? ` data-guild-realm="${x.realm}"` : ''}>${label}</span>`;
          return `<tr><td><span class="char-cell">${realmIconEl(x.realm)} ${clickableGuild}</span></td><td class="num ${countClass}">${x.count}</td>${showDiff ? `<td class="num ${diffClass}">${signed(x.diff)}</td>` : ''}</tr>`;
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
            <thead><tr><th>${title}${opts?.loading ? ' <span class="spinner" title="Loading…"></span>' : ''}</th><th class="num">${countLabel}</th>${showDiff ? '<th class="num">+/−</th>' : ''}</tr></thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
        </div>
      `;
    };

    const grid = `
      <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.5rem;align-items:start;">
        <div id="g_memberKillersTable"><div class="muted">Loading Top Killers…</div></div>
        <div id="g_guildsKilledTable"><div class="muted">Loading Top Guilds Killed…</div></div>
        <div id="g_careersKilledTable"><div class="muted">Loading Top Careers Killed…</div></div>
        <div id="g_memberDeathsTable"><div class="muted">Loading Top Deaths…</div></div>
        <div id="g_killersGuildsTable"><div class="muted">Loading Top Guilds Killed by…</div></div>
        <div id="g_killersCareersTable"><div class="muted">Loading Top Careers Killed by…</div></div>
      </div>
      <div style="margin-top:.5rem;">
        <span id="g_scannedInfo" class="muted">Loading full period details…</span>
      </div>
    `;

    setModalBody(header + grid);

    // Fetch guild period K/D totals
    try {
      const fromTs = Math.floor(new Date(fromIso).getTime() / 1000);
      const toTs = Math.floor(new Date(toIso).getTime() / 1000);
      const GKD_QUERY = `
        query GuildKd($gid: UnsignedInt!, $from: Int!, $to: Int!) {
          k: kills(first: 1, where: { killerGuildId: { eq: $gid }, time: { gte: $from, lt: $to } }) { totalCount }
          d: kills(first: 1, where: { victimGuildId: { eq: $gid }, time: { gte: $from, lt: $to } }) { totalCount }
        }
      `;
      const data = await gql<any>(GKD_QUERY, { gid: Number(guildId), from: fromTs, to: toTs }, { signal: currentModalAbort?.signal });
      if (modalSessionId !== currentModalSessionId) return; if (myGen !== __modalRenderGen) return;
      const k = Number(data?.k?.totalCount ?? 0);
      const d = Number(data?.d?.totalCount ?? 0);
      const kd = d > 0 ? (k / d) : (k > 0 ? Number.POSITIVE_INFINITY : 0);
      const setTextClass = (id: string, text: string, isPos?: boolean|null) => { const el = document.getElementById(id); if (!el) return; el.textContent = text; el.classList.remove('pos','neg'); if (isPos != null) el.classList.add(isPos ? 'pos' : 'neg'); };
      setTextClass('g_periodKillsCell', String(k), true);
      setTextClass('g_periodDeathsCell', String(d), false);
      setTextClass('g_periodKdCell', kd === Number.POSITIVE_INFINITY ? '∞' : kd.toFixed(2), kd >= 1);
    } catch {}

    // Fetch guild top lists with progressive updates
    try {
      await fetchTopOpponentsForGuild(guildId, {
        fromIso, toIso, signal: currentModalAbort?.signal,
        onProgress: (res) => {
          if (modalSessionId !== currentModalSessionId) return; if (myGen !== __modalRenderGen) return;
          const mount = (id: string, html: string) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };
          const s = res.scanned; const done = !!(s && s.killsNodes >= s.killsTotal && s.deathsNodes >= s.deathsTotal);
          mount('g_memberKillersTable', tableList('Top Killers', res.memberKillers as any, { kind: 'character', countLabel: 'Kills', showDiff: false, metric: 'kills', loading: !done }));
          mount('g_guildsKilledTable', tableList('Top Guilds Killed', res.guildsKilled as any, { kind: 'guild', countLabel: 'Kills', showDiff: true, metric: 'kills', loading: !done }));
          mount('g_careersKilledTable', tableList('Top Careers Killed', res.careersKilled as any, { kind: 'career', countLabel: 'Kills', showDiff: true, metric: 'kills', loading: !done }));
          mount('g_memberDeathsTable', tableList('Top Deaths', res.memberDeaths as any, { kind: 'character', countLabel: 'Deaths', showDiff: false, metric: 'deaths', loading: !done }));
          mount('g_killersGuildsTable', tableList('Top Guilds Killed by', res.killersGuilds as any, { kind: 'guild', countLabel: 'Deaths', showDiff: true, metric: 'deaths', loading: !done }));
          mount('g_killersCareersTable', tableList('Top Careers Killed by', res.killersCareers as any, { kind: 'career', countLabel: 'Deaths', showDiff: true, metric: 'deaths', loading: !done }));
          // Update summary from events if needed
          const k2 = res.periodStats.kills || 0; const d2 = res.periodStats.deaths || 0; const kd2 = d2 > 0 ? (k2/d2) : (k2 > 0 ? Number.POSITIVE_INFINITY : 0);
          const setTextClass2 = (id: string, text: string, isPos?: boolean|null) => { const el = document.getElementById(id); if (!el) return; el.textContent = text; el.classList.remove('pos','neg'); if (isPos != null) el.classList.add(isPos ? 'pos' : 'neg'); };
          setTextClass2('g_periodKillsCell', String(k2), true);
          setTextClass2('g_periodDeathsCell', String(d2), false);
          setTextClass2('g_periodKdCell', kd2 === Number.POSITIVE_INFINITY ? '∞' : kd2.toFixed(2), kd2 >= 1);
          const scannedEl = document.getElementById('g_scannedInfo');
          if (scannedEl && res.scanned) {
            const s = res.scanned; const extra = s.hitCap ? ' (capped)' : '';
            scannedEl.innerHTML = `<span class="muted">Scanned guild kill events: ${s.killsNodes}/${s.killsTotal} kills, ${s.deathsNodes}/${s.deathsTotal} deaths${extra}</span>`;
          }
        }
      });
    } catch { const scannedEl = document.getElementById('g_scannedInfo'); if (scannedEl) scannedEl.innerHTML = '<span class="muted">Failed to scan guild kill events.</span>'; }
  }

  try { await renderModal(); } catch { setModalBody('<div class="muted">Failed to load details. Please try again.</div>'); }
}

function setBusy(b: boolean) {
  if (periodPrevBtn) periodPrevBtn.disabled = b;
  if (periodNextBtn) periodNextBtn.disabled = b;
  if (status) status.textContent = b ? 'Loading…' : '';
  if (modeSelect) modeSelect.disabled = b;
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
const allowedSortFields: SortField[] = ['name', 'guild', 'kills', 'deaths', 'kd', 'allKills', 'allDeaths', 'allKd'];
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
onModalClose(() => { openCharId = null; openCharName = null; openGuildId = null; openGuildName = null; updateUrl(); });

// Delegate clicks on the leaderboard table to open the score sheet
tbody.addEventListener('click', async (e: Event) => {
  const t = e.target as HTMLElement;
  // Guild link in player rows
  const guildLink = t.closest?.('a.open-guild-from-row') as HTMLAnchorElement | null;
  if (guildLink) {
    e.preventDefault();
    const idStr = guildLink.getAttribute('data-guild-id');
    const nm = (guildLink.getAttribute('data-guild-name') || guildLink.textContent || 'Guild').trim();
    if (idStr) {
      const gid = Number(idStr);
      const realm = guildLink.getAttribute('data-guild-realm') || undefined;
      if (Number.isFinite(gid)) { await openGuildScoreSheet(gid, nm, realm); return; }
    }
  }
  const nameEl = t.closest?.('.char-name');
  if (!nameEl) return;
  const tr = t.closest('tr');
  const idAttr = tr?.getAttribute('data-id');
  const rowIdNum = idAttr ? Number(idAttr) : NaN;
  const name = (nameEl.getAttribute('data-char-name') || nameEl.textContent || 'Character').trim();
  const realm = nameEl.getAttribute('data-guild-realm') || undefined;
  if (!Number.isFinite(rowIdNum)) return;
  if (currentBoard === 'guilds') {
    await openGuildScoreSheet(rowIdNum, name, realm);
  } else {
    await openScoreSheet(rowIdNum, name);
  }
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

// Delegate clicks on guild names inside any modal list to open guild score sheet
document.addEventListener('click', async (ev) => {
  const target = ev.target as HTMLElement;
  const a = target?.closest?.('a.open-guild-sheet') as HTMLAnchorElement | null;
  if (!a) return;
  const modal = a.closest('#charModal');
  if (!modal) return;
  ev.preventDefault();
  const idStr = a.getAttribute('data-guild-id');
  const nm = (a.getAttribute('data-guild-name') || a.textContent || 'Guild').trim();
  const realm = a.getAttribute('data-guild-realm') || undefined;
  if (!idStr) return;
  const gid = Number(idStr);
  if (!Number.isFinite(gid)) return;
  await openGuildScoreSheet(gid, nm, realm);
});

// ---------------------------
// Leaderboard render/control logic (restored)
// ---------------------------

// Live rows for the current view and cache of lifetime totals
let currentRows: Row[] = [];
const lifetimeCache: Map<string | number, LifetimeStats> = new Map();
// lifetimeGeneration removed with lifetime augmentation logic (lifetime columns hidden)
let currentBoard: 'players' | 'guilds' = ((qs.get('board') || '').toLowerCase() === 'guilds') ? 'guilds' : 'players';
(document.documentElement as HTMLElement).setAttribute('data-board', currentBoard);

function updateNameHeaderLabel() {
  const th = document.querySelector('thead tr:nth-child(2) th.sortable[data-field="name"]') as HTMLElement | null;
  if (!th) return;
  const label = currentBoard === 'guilds' ? 'Guild' : 'Character';
  th.innerHTML = `${label} <svg class="sort-arrow" viewBox="0 0 10 10" aria-hidden="true"><path d="M5 2 L2 7 H8 Z"/></svg>`;
}

function updateFooterPlaceholder() {
  const input = nameInput as HTMLInputElement | null;
  const btn = showByNameBtn as HTMLButtonElement | null;
  if (input) input.placeholder = currentBoard === 'guilds' ? 'Guild name' : 'Character name';
  if (btn) btn.title = currentBoard === 'guilds' ? 'Open guild score sheet for this name' : 'Open score sheet for this name';
}

function isAtCurrentPeriod(): boolean {
  const nowD = new Date();
  if (currentPeriod === 'weekly') {
    const curW = getISOWeekLocal(nowD);
    const curY = getISOWeekYear(nowD);
    return (weeklyWeek === curW) && (weeklyYear === curY);
  }
  if (currentPeriod === 'monthly') {
    return (monthlyYear === nowD.getUTCFullYear()) && (monthlyMonth === (nowD.getUTCMonth() + 1));
  }
  return false;
}

function updateCurrentButtonState() {
  const isCurrent = isAtCurrentPeriod();
  const setBtnState = (btn: HTMLButtonElement | null, disabled: boolean) => {
    if (!btn) return;
    btn.disabled = disabled;
    btn.setAttribute('aria-disabled', disabled ? 'true' : 'false');
    (btn as HTMLButtonElement).style.opacity = disabled ? '0.5' : '';
    // Manage tooltip: remove when disabled, restore when enabled
    const el = btn as HTMLButtonElement & { dataset: any };
    if (disabled) {
      if (el.title && !el.dataset.titleBackup) el.dataset.titleBackup = el.title;
      el.title = '';
      el.setAttribute('tabindex', '-1');
    } else {
      if (el.dataset && el.dataset.titleBackup) { el.title = el.dataset.titleBackup; delete el.dataset.titleBackup; }
      el.setAttribute('tabindex', '0');
    }
  };
  setBtnState(currentBtn, isCurrent);
  setBtnState(periodNextBtn, isCurrent);
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
  if (currentBoard && currentBoard !== 'players') u.searchParams.set('board', currentBoard); else u.searchParams.delete('board');
  // Reflect open score sheet in URL for deep-linking
  // Unified modal params: use 'name' for both character and guild
  if (openCharId != null) {
    u.searchParams.set('char', String(openCharId));
    u.searchParams.delete('guild');
    if (openCharName) u.searchParams.set('name', openCharName); else u.searchParams.delete('name');
  } else if (openGuildId != null) {
    u.searchParams.set('guild', String(openGuildId));
    u.searchParams.delete('char');
    if (openGuildName) u.searchParams.set('name', openGuildName); else u.searchParams.delete('name');
  } else {
    u.searchParams.delete('char');
    u.searchParams.delete('guild');
    u.searchParams.delete('name');
  }
  // Remove legacy gname if present
  u.searchParams.delete('gname');
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
      if (currentBoard === 'players') {
        try {
          const data = await gql<any>(WEEKLY_QUERY, { year, week });
          rows = (data?.weeklyKillLeaderboard || []) as Row[];
        } catch {
          const data = await gql<any>(WEEKLY_QUERY_NO_GUILD, { year, week });
          rows = (data?.weeklyKillLeaderboard || []) as Row[];
        }
      } else {
        const data = await gql<any>(WEEKLY_GUILD_QUERY, { year, week });
        const list = (data?.weeklyGuildKillLeaderboard || []) as Array<{ rank:number;kills:number;deaths:number; guild?: { id?: string|number; name?: string; realm?: string } }>;
        rows = list.map((e, i) => ({ rank: e.rank ?? (i+1), kills: e.kills, deaths: e.deaths, character: { id: e.guild?.id ?? '', name: e.guild?.name ?? 'Unknown', realm: e.guild?.realm } }));
      }
    } else if (period === 'monthly') {
      const month = monthlyMonth;
      if (!(month >= 1 && month <= 12)) { showError('Invalid month (1-12).'); return; }
      if (currentBoard === 'players') {
        try {
          const data = await gql<any>(MONTHLY_QUERY, { year, month });
          rows = (data?.monthlyKillLeaderboard || []) as Row[];
        } catch {
          const data = await gql<any>(MONTHLY_QUERY_NO_GUILD, { year, month });
          rows = (data?.monthlyKillLeaderboard || []) as Row[];
        }
      } else {
        const data = await gql<any>(MONTHLY_GUILD_QUERY, { year, month });
        const list = (data?.monthlyGuildKillLeaderboard || []) as Array<{ rank:number;kills:number;deaths:number; guild?: { id?: string|number; name?: string; realm?: string } }>;
        rows = list.map((e, i) => ({ rank: e.rank ?? (i+1), kills: e.kills, deaths: e.deaths, character: { id: e.guild?.id ?? '', name: e.guild?.name ?? 'Unknown', realm: e.guild?.realm } }));
      }
    }

    // Sort and rank
    const lifetimeGetter = (r: Row) => lifetimeCache.get(r.character?.id ?? '') || { kills: 0, deaths: 0, kd: 0 } as LifetimeStats;
    const sorted = sortRows(rows, sortField, sortDir, lifetimeGetter);
    sorted.forEach((r, i) => r.rank = i + 1);
    const displayRows: Row[] = sorted;
    currentRows = displayRows.slice();
    if (tbody) renderRows(displayRows, tbody, { clickableNames: true, mode: currentBoard });

    // Lifetime columns are hidden for both boards; skip lifetime augmentation

    updateUrl();
    updatePeriodTitle();
    updateNameHeaderLabel();
  } catch (e: any) {
    showError(String(e?.message || e));
  } finally {
    setBusy(false);
    if (status) status.textContent = '';
  }
}

// removed unused augmentWithLifetimeTotals (lifetime columns hidden)

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
  if (tbody) renderRows(resorted, tbody, { clickableNames: true, mode: currentBoard });
  // Lifetime columns hidden; no need to populate lifetime cells
}

// Wire up header sorters, mode buttons, current button, and period arrows
document.querySelectorAll('th.sortable').forEach((th) => th.addEventListener('click', () => applySort((th as HTMLElement).getAttribute('data-field') as SortField)));
if (modeSelect) {
  modeSelect.value = currentPeriod;
  modeSelect.addEventListener('change', () => {
    const v = modeSelect.value === 'weekly' ? 'weekly' : 'monthly';
    setMode(v as 'weekly'|'monthly');
    if (modeSelect) modeSelect.value = currentPeriod;
  });
}
currentBtn?.addEventListener('click', goToCurrent);
periodPrevBtn?.addEventListener('click', () => { if (currentPeriod === 'weekly') adjustWeek(-1); else adjustMonth(-1); });
periodNextBtn?.addEventListener('click', () => { if (isAtCurrentPeriod()) return; if (currentPeriod === 'weekly') adjustWeek(1); else adjustMonth(1); });
currentBtn?.addEventListener('click', () => { if (isAtCurrentPeriod()) return; goToCurrent(); });

// Board selector (players vs guilds)
if (boardSelect) {
  boardSelect.value = currentBoard;
  boardSelect.addEventListener('change', () => {
    const v = (boardSelect.value === 'guilds') ? 'guilds' : 'players';
    if (v !== currentBoard) {
      currentBoard = v;
      (document.documentElement as HTMLElement).setAttribute('data-board', currentBoard);
      // Clear lifetime cache effect for guilds view (not used)
      updateNameHeaderLabel();
      updateFooterPlaceholder();
      fetchAndRender();
    }
  });
}

// Footer: open score sheet by typed name
async function openByName() {
  const nm = (nameInput?.value || '').trim();
  if (!nm) return;
  setBusy(true);
  try {
    if (currentBoard === 'guilds') {
      const resolvedG = await resolveGuildByName(nm);
      if (!resolvedG) { if (status) status.textContent = `No guild found named "${nm}"`; return; }
      await openGuildScoreSheet(Number(resolvedG.id), resolvedG.name || nm, resolvedG.realm);
    } else {
      const resolved = await resolveCharacterByName(nm);
      if (!resolved) { if (status) status.textContent = `No character found named "${nm}"`; return; }
      await openScoreSheet(Number(resolved.id), resolved.name || nm);
    }
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
updateNameHeaderLabel();
updateFooterPlaceholder();
const initialCharIdParam = (() => { const s = qs.get('char'); const n = s ? Number(s) : NaN; return Number.isFinite(n) ? n : null; })();
const initialCharNameParam = qs.get('name') || null;
const initialGuildIdParam = (() => { const s = qs.get('guild'); const n = s ? Number(s) : NaN; return Number.isFinite(n) ? n : null; })();
const initialGuildNameParam = qs.get('name') || qs.get('gname') || null;
fetchAndRender().then(async () => {
  if (initialCharIdParam != null) {
    try { await openScoreSheet(initialCharIdParam, initialCharNameParam || 'Character'); } catch {}
  } else if (initialGuildIdParam != null) {
    try { await openGuildScoreSheet(initialGuildIdParam, initialGuildNameParam || 'Guild'); } catch {}
  }
});
