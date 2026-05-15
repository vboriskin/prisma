'use strict';
/* ============================================================
   PORTFOLIO PULSE — ORCHESTRATOR
   Wires the modular pieces together and manages tab/sub-tab UI.

   Public surface:
     PortfolioPulse.render(container)
     PortfolioPulse.refresh()
   ============================================================ */

import { state } from '../state.js';
import { EmployeeFactory } from '../rowFactory.js';
import { Storage } from '../dataStore.js';
import { loadSettingsRaw } from './integrationsStore.js';
import { fetchPulseData } from './portfolioPulseApi.js';
import { analysePulse, filterModelByPk } from './portfolioPulseModel.js';
import { buildInsights, filterInsightsByPk } from './portfolioPulseInsights.js';
import { buildMetrics } from './portfolioPulseMetrics.js';
import { buildBacklogModel, buildBacklogInsights } from './portfolioPulseBacklog.js';
import {
  renderTopHeader, renderMainTabs, renderErrorBanner,
  renderTeamsTab, renderSummaryTab, renderSprintsTab,
  renderInsightsTab, renderMetricsTab, renderBacklogTab,
  renderSkeleton, renderEmpty, renderError, renderHowModal,
  setRenderContext,
} from './portfolioPulseRenderer.js';
import { TechInfo } from './techInfo.js';
import { parseProjectKeys } from './portfolioPulseUtils.js';
import { makePhraseFeeder } from './loaderPhrases.js';
import { trackIntegrationFailure as _telIntFail } from './telemetry.js';
import { Services } from '../app/services.js';

export const PortfolioPulse = {
  // F11 fix (chat-04 audit) — публичный getter, чтобы внешние модули
  // (chat) не лезли в приватное `_model`. Refactor приватного поля
  // не сломает потребителей, использующих .getModel().
  getModel() { return this._model; },
  _model: null,
  _insights: [],
  _metrics: null,
  _backlog: null,
  _backlogInsights: [],
  _activePk: '',
  _activeTab: 'teams',         // 'teams' | 'summary' | 'sprints' | 'insights' | 'metrics' | 'backlog'
  _activeBacklogSubtab: 'summary',
  _container: null,
  _abort: null,
  _reqId: 0,
  _loading: false,            // true while a fetch is in flight (survives tab switches)
  _loadingMsg: '',            // last skeleton phase text — used to re-show loader on tab return
  // Sticky terminal-state markers — survive section re-renders from the
  // reactive auto-flush. Without these, every refreshAll() reaching
  // IntegrationsView.render() would re-trigger a cold fetch (because
  // `_model` is null after cancel/error) and the user sees the loader
  // come back automatically every ~100 ms.
  _cancelled: false,          // user explicitly cancelled the fetch
  _errorMsg:  '',             // last error message — when set, render error UI instead of re-fetching

  /** Public: is a fetch currently running? */
  isLoading() { return this._loading; },

  /* ── Configuration ────────────────────────────────── */
  _readConfig() {
    let cfg = {};
    try { cfg = loadSettingsRaw(); } catch(_) {}
    return {
      projectKeys: parseProjectKeys(cfg.jiraProjectKeys),
      staleDays:   Number(cfg.pulseStaleDays || 7),
      wipMax:      Number(cfg.pulseWipMax || 3),
    };
  },

  /* ── Public entrypoint ────────────────────────────── */
  async render(container) {
    this._container = container;
    const { projectKeys } = this._readConfig();

    if (!projectKeys.length) {
      container.innerHTML = renderEmpty();
      return;
    }
    // Sticky terminal states — repaint the same UI on each re-mount.
    // These branches MUST come before _fetchAndRender so an
    // IntegrationsView.render() triggered by reactive auto-flush
    // (e.g. user filtered registry rows) doesn't kick off a fresh fetch.
    if (this._cancelled) { this._paintCancelled(); return; }
    if (this._errorMsg)  { this._paintError(this._errorMsg); return; }
    await this._fetchAndRender();
  },

  async refresh() {
    // V21 J #62 — abort предыдущего fetch ДО старта нового, чтобы
    // double-click не приводил к race condition (поздний ответ
    // перезаписывает свежий). Pattern из teamScanner2.refresh()/V20 S6.1.
    try { this._abort?.abort(); }
    catch (_) { /* defensive */ }
    this._cancelled = false;
    this._errorMsg  = '';
    if (this._container) await this._fetchAndRender();
  },

  /* ── Sticky-state painters (no fetch side-effect) ── */
  _paintCancelled() {
    if (!this._container) return;
    this._container.innerHTML = renderError('Запрос отменён', true);
    this._container.querySelector('#pp-retry-btn')?.addEventListener('click', () => this.refresh());
  },
  _paintError(msg) {
    if (!this._container) return;
    this._container.innerHTML = renderError(msg, true);
    this._container.querySelector('#pp-retry-btn')?.addEventListener('click', () => this.refresh());
  },

  /** Render the in-flight loading state. Used both at fetch start AND when
   *  the user navigates AWAY and BACK while a fetch is running — the new
   *  container needs the loader re-painted (the previous one was destroyed
   *  by the section switch). Idempotent. */
  _showLoader() {
    const container = this._container;
    if (!container) return;
    const initialMsg = this._loadingMsg
      || `Запрашиваю ${this._readConfig().projectKeys.length} проектов из Jira…`;
    container.innerHTML = renderSkeleton(initialMsg);
    container.querySelector('#pp-skel-cancel')?.addEventListener('click', () => {
      try { this._abort?.abort(); } catch(_) {}
      this._loading  = false;
      this._cancelled = true;        // sticky → next render() will repaint, NOT refetch
      this._stopPhraseRotator();
      this._paintCancelled();
    });

    // V13 (11th pass): rotating fun-phrase line. Independent from the
    // existing functional `phases` rotator (which updates #pp-skel-text
    // every 4s with phase info) — this one updates #pp-skel-phrase every
    // ~2.6s with humorous strings, so the user always sees motion.
    this._stopPhraseRotator();
    const feed = makePhraseFeeder();
    const tick = () => {
      const el = this._container?.querySelector('#pp-skel-phrase');
      if (!el) return;
      el.style.animation = 'none';
      void el.offsetWidth;
      el.style.animation = '';
      el.textContent = feed();
    };
    tick();
    this._phraseTimer = setInterval(tick, 2600);
  },

  _stopPhraseRotator() {
    if (this._phraseTimer) {
      clearInterval(this._phraseTimer);
      this._phraseTimer = null;
    }
  },

  /* ── Fetch + analyse + render ─────────────────────── */
  async _fetchAndRender() {
    const container = this._container;
    if (!container) return;
    const { projectKeys, staleDays, wipMax } = this._readConfig();
    const reqId = (this._reqId = (this._reqId || 0) + 1);

    this._loading = true;
    this._loadingMsg = `Запрашиваю ${projectKeys.length} проект${projectKeys.length===1?'':projectKeys.length<5?'а':'ов'} из Jira…`;
    this._showLoader();

    // Live progress hint — also kept on `this._loadingMsg` so a tab-return
    // shows the right phase via _showLoader().
    let phaseIdx = 0;
    const phases = [
      this._loadingMsg,
      'Идут JQL-запросы (sprint / updated / in-progress / backlog)…',
      'Тяну changelog, worklog и комментарии…',
      'Свожу участников за 48ч…',
      'Считаю инсайты и метрики…',
    ];
    // F9 fix (codebase-01 audit) — phaseTimer был локальным; при двойном
    // refresh _abort прерывал первый fetch, его finally чистило только свой
    // local timer. Теперь храним на this — второй вызов сначала clears
    // предыдущий, race по _loadingMsg исключён.
    if (this._phaseTimer) clearInterval(this._phaseTimer);
    this._phaseTimer = setInterval(() => {
      phaseIdx = Math.min(phaseIdx + 1, phases.length - 1);
      this._loadingMsg = phases[phaseIdx];
      const t = this._container && this._container.querySelector('#pp-skel-text');
      if (t) t.textContent = phases[phaseIdx];
    }, 4000);

    try {
      if (this._abort) this._abort.abort();
      this._abort = new AbortController();
      // V17 P5 — client timeout bumped from 180 s → 600 s. Per user
      // request: «таймауты сыпятся постоянно, пускай дольше крутит но
      // должно загружать». 10 min covers the slowest corp Jira tier
      // (legacy SMECM-class teams with ~3000 issues/project × 4 sub-
      // queries with `expand:changelog`). Audit 2026-05-V17 pt 5.
      const raw = await fetchPulseData({
        projectKeys,
        signal: this._abort.signal,
        timeoutMs: 600000,
        // V17.2 I2c — pass identity-slim сотрудников для per-employee CQL
        //   на сервере (contributor in (...) + creator in (...) + mention in (...)).
        employees: state.employees || [],
      });
      if (reqId !== this._reqId) return;
      // V17.2 I1c — pass state.employees so analysePulse can map BB/CF
      //   authors to employees deterministically (by email/login/accountId)
      //   instead of fuzzy-matching FIO tokens.
      this._model = analysePulse(raw, { staleDays, employees: state.employees || [] });
      // V17.2 I5 — auto-fill emails / jiraAccountId в state.employees из тех
      //   данных что Jira вернул в Pulse'е. Это снимает ручную работу:
      //   пользователь только заводит сотрудника с ФИО, идентификация для
      //   интеграций подхватывается сама. Срабатывает после каждого pulse,
      //   но (а) не перезаписывает уже заполненные поля, (б) не трогает
      //   сотрудников с amibguous FIO-collision (двое «Иван Иванов»).
      try {
        const r = _autofillEmployeeIdentities(this._model, state.employees || []);
        if (r.updated > 0) {
          try { Storage.save(); } catch(_) {}
          window.showToast?.(`Подтянули данные из Jira: заполнено email/accountId у ${r.updated} ${_pl(r.updated, ['сотрудника','сотрудников','сотрудников'])}${r.ambiguous ? ` (пропущено ${r.ambiguous} из-за совпадения ФИО)` : ''}`, 'success', 3500);
          try { window.HistoryLog?.integrations?.('pulse_autofill', `Автозаполнено email/accountId: +${r.updated}, ambiguous: ${r.ambiguous}`); } catch(_) {}
        }
      } catch (e) { console.warn('[PortfolioPulse] employee autofill failed:', e); }
      this._insights = buildInsights(this._model, { staleDays, wipMax });
      this._metrics = buildMetrics(this._model);
      this._backlog = buildBacklogModel(this._model);
      this._backlogInsights = buildBacklogInsights(this._backlog, this._model);
      this._cancelled = false;
      this._errorMsg  = '';
      this._renderFull();
    } catch (e) {
      if (reqId !== this._reqId) return;
      if (e?.name === 'AbortError') return;
      const isTimeout = e?.name === 'TimeoutError' || /timeout|abort/i.test(String(e?.message||''));
      const msg = isTimeout
        ? 'Запрос занял слишком много времени. Откройте «Диагностика загрузки» — там видно какой PK / источник сбоит.'
        : (e?.message || 'Ошибка запроса');
      console.warn('[PortfolioPulse] fetch failed:', e);
      // V22 — telemetry: typed integration failure для unified analytics.
      try {
        const errType =
          isTimeout                                             ? 'timeout' :
          /401|403|unauth/i.test(String(e?.message||''))        ? 'auth' :
          /network|net::|fetch failed/i.test(String(e?.message||'')) ? 'network' :
          /5\d\d/.test(String(e?.message||''))                  ? 'http_5xx' :
          /4\d\d/.test(String(e?.message||''))                  ? 'http_4xx' :
                                                                  'unknown';
        _telIntFail('pulse', errType, { pks: projectKeys, durationMs: 0 });
      } catch (_) {}
      // Sticky error — survives reactive auto-flush re-renders.
      this._errorMsg = msg;
      this._paintError(msg);
    } finally {
      this._loading = false;
      this._loadingMsg = '';
      // F9 fix — clear только если это всё ещё «наш» phaseTimer (перебили мы или
      // пришёл новый fetch). Используем сохранённую ссылку.
      if (this._phaseTimer) { clearInterval(this._phaseTimer); this._phaseTimer = null; }
      this._stopPhraseRotator();
    }
  },

  /* ── Render top header + main tabs + active tab body ── */
  _renderFull() {
    if (!this._container || !this._model) return;
    // Push render-context (jiraBaseUrl) so renderIssueRow can build
    // clickable "{base}/browse/{key}" links without threading the URL
    // through every caller. Re-asserted on each render in case settings change.
    setRenderContext({ jiraBaseUrl: this._model.jiraBaseUrl || '' });
    const fetchedAtLabel = (() => {
      try { return new Date(this._model.fetchedAt).toLocaleString('ru'); } catch(_) { return '—'; }
    })();
    const html = `
      ${renderTopHeader(this._model, this._activePk, fetchedAtLabel)}
      ${renderErrorBanner(this._model)}
      ${renderMainTabs(this._activeTab)}
      <div class="pp-tab-body">${this._renderActiveTab()}</div>
    `;
    this._container.innerHTML = html;
    this._wire();
  },

  _renderActiveTab() {
    const m = filterModelByPk(this._model, this._activePk);
    const ins = filterInsightsByPk(this._insights, this._activePk);
    switch (this._activeTab) {
      case 'teams':    return renderTeamsTab(m, this._activePk);
      case 'summary':  return renderSummaryTab(m, this._activePk);
      case 'sprints':  return renderSprintsTab(m, this._activePk);
      case 'insights': return renderInsightsTab(ins, this._activePk);
      case 'metrics':  return renderMetricsTab(buildMetrics(m));
      case 'backlog': {
        const bl  = buildBacklogModel(m);
        const blI = buildBacklogInsights(bl, m);
        return renderBacklogTab(bl, blI, this._activePk, this._activeBacklogSubtab);
      }
      default:         return renderTeamsTab(m, this._activePk);
    }
  },

  _wire() {
    const root = this._container;
    if (!root) return;
    // Project-key chips
    root.querySelectorAll('.pp-pk-chip').forEach(c => {
      c.addEventListener('click', () => {
        this._activePk = c.dataset.pk || '';
        this._renderFull();
      });
    });
    // Main-tab switcher — skip the help button (lives in the same row but is
    // a different control: opens the explainer modal, doesn't change tab).
    root.querySelectorAll('.pp-tab[data-pp-tab]').forEach(b => {
      b.addEventListener('click', () => {
        this._activeTab = b.dataset.ppTab;
        this._renderFull();
      });
    });
    // "📋 Как считается" — explainer modal showing per-tab calculation rules.
    root.querySelector('#pp-help-btn')?.addEventListener('click', () => this._openHowModal());
    // "🔧 Техническая информация" — debug modal with versions, projects,
    // fields, statuses across Jira / Bitbucket / Confluence. Owned by
    // a separate orchestrator so we don't bloat PortfolioPulse.
    root.querySelector('#pp-tech-info-btn')?.addEventListener('click', () => TechInfo.open());
    // Backlog sub-tabs
    root.querySelectorAll('.pp-subtab').forEach(b => {
      b.addEventListener('click', () => {
        this._activeBacklogSubtab = b.dataset.ppSubtab;
        this._renderFull();
      });
    });
    // Refresh
    root.querySelector('#pp-refresh-btn')?.addEventListener('click', () => this.refresh());
    // Insight target chip → switch to that PK
    root.querySelectorAll('.pp-ins-target').forEach(el => {
      el.addEventListener('click', () => {
        this._activePk = el.dataset.pk || el.textContent.trim();
        this._activeTab = 'teams';
        this._renderFull();
      });
    });
    // Expand / collapse all participant cards
    root.querySelector('#pp-cards-expand-all')?.addEventListener('click', () => {
      root.querySelectorAll('.pp-card-user').forEach(d => d.open = true);
    });
    root.querySelector('#pp-cards-collapse-all')?.addEventListener('click', () => {
      root.querySelectorAll('.pp-card-user').forEach(d => d.open = false);
    });
  },

  /** Open the per-tab "Как считается" explainer modal. */
  _openHowModal() {
    // Append to body so it overlays everything regardless of pp-root scroll.
    const existing = document.getElementById('pp-how-modal-overlay');
    if (existing) existing.remove();
    document.body.insertAdjacentHTML('beforeend', renderHowModal(this._activeTab));
    const overlay = document.getElementById('pp-how-modal-overlay');
    if (!overlay) return;
    const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    overlay.querySelector('#pp-how-close')?.addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', onKey);
  },

  /** Currently configured project keys (for empty-state message). */
  getConfiguredKeys() {
    return this._readConfig().projectKeys;
  },
};

Services.register('PortfolioPulse', PortfolioPulse);
if (typeof window !== 'undefined') window.PortfolioPulse = PortfolioPulse;

/* ============================================================
   V17.2 I5 — Auto-fill employee identity from Pulse data
   ============================================================
   После каждого успешного analysePulse сканируем участников и пытаемся
   подхватить email / jiraAccountId в соответствующего employee из
   state.employees. Это устраняет ручной ввод этих полей в карточке
   сотрудника — для большинства будет достаточно одного pulse'а чтобы
   identity-таблица заполнилась.

   Политика:
   • Match по нормализованному ФИО (lowercase, trim, collapse spaces).
   • НЕ перезаписываем уже заполненные поля (manually-entered wins).
   • Если несколько employees с одинаковым ФИО → конфликт, пропускаем
     обоих (показываем `ambiguous` в счётчике).
   • participant без email/accountId → пропускаем.
   • Возвращаем `{updated, ambiguous}` для toast / log. */
function _autofillEmployeeIdentities(model, employees) {
  const out = { updated: 0, ambiguous: 0 };
  if (!Array.isArray(employees) || !model?.participants?.length) return out;

  const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

  // Build FIO → employees[] map (collisions captured for ambiguity check).
  const empByFio = new Map();
  for (const e of employees) {
    const k = norm(e?.fio);
    if (!k) continue;
    if (!empByFio.has(k)) empByFio.set(k, []);
    empByFio.get(k).push(e);
  }

  for (const p of model.participants) {
    if (!p) continue;
    const hasIdentity = !!(p.email || p.jiraAccountId);
    if (!hasIdentity) continue;
    const k = norm(p.label);
    if (!k) continue;
    const matches = empByFio.get(k);
    if (!matches || !matches.length) continue;
    if (matches.length > 1) { out.ambiguous++; continue; }
    const emp = matches[0];
    let touched = false;
    if (!emp.email && p.email) { emp.email = p.email; touched = true; }
    if (!emp.jiraAccountId && p.jiraAccountId) { emp.jiraAccountId = p.jiraAccountId; touched = true; }
    if (touched) {
      try { EmployeeFactory.normalize(emp); } catch(_) {}
      out.updated++;
    }
  }
  return out;
}
function _pl(n, forms) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}

// Test surface — pure helper, no DOM/state dependency.
export const __testing = { _autofillEmployeeIdentities };
