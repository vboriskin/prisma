'use strict';
/* ============================================================
   SLIDE DECK EXPORT — AUDIT_HOLISTIC §5.2
   ------------------------------------------------------------
   Экспорт SteerCo brief'а в markdown / pptx-outline / clipboard /
   download. Используется views/exec.js (SteerCo brief layout):
   CEO больше не копирует руками 6 карточек в Slides.

   API:
     · SlideDeck.exportMarkdown(brief)     → string
         markdown с slide breaks `---`. `# title slide`, `## body`,
         `-` bullets. Один документ = один SteerCo readout.
     · SlideDeck.exportPptxOutline(brief)  → string
         outline без библиотек: те же `# / ## / -`, но плоский
         текст без code-fences и без markdown-extensions, чтобы
         PowerPoint Outline import (File → New from Outline) или
         Google Slides import нормально подцепили.
     · SlideDeck.copyToClipboard(text)     → Promise<bool>
         async clipboard API; возвращает true если ok.
     · SlideDeck.download(filename, content, mime?) → bool
         Blob + anchor download. Без libraries.

   Контракты:
     · Без эмодзи в выходе (брендбук §1).
     · Identity-deterministic — никакого fuzzy-matching по именам.
       Brief приходит уже агрегированный (см. _buildSteerCoBrief).
     · Read-only: ни Storage.save(), ни state-мутаций.
     · _scrubSecrets уже отрабатывают на уровне CSV-экспорта;
       здесь brief — production-data, не raw rows, поэтому secrets
       не могут просочиться (имена, числа, статусы).

   Размер: ~180 LOC, нет внешних зависимостей.
   ============================================================ */

import { Services } from './services.js';

/* ── helpers ───────────────────────────────────────────────── */

function _date(brief) {
  const d = brief?.meta?.date || new Date().toISOString().slice(0, 10);
  return String(d);
}

function _line(s) {
  // Markdown-safe single-line text. Никаких \n внутри bullet'а —
  // schema требует ровно 1 строку на bullet.
  return String(s ?? '').replace(/[\r\n]+/g, ' ').trim();
}

function _kpiLine(kpi) {
  if (!kpi || typeof kpi !== 'object') return '';
  const parts = [];
  if (kpi.total != null)    parts.push(`Total: ${kpi.total}`);
  if (kpi.done != null)     parts.push(`Done: ${kpi.done}`);
  if (kpi.donePct != null)  parts.push(`Done%: ${kpi.donePct}%`);
  if (kpi.blockers != null) parts.push(`Blockers: ${kpi.blockers}`);
  if (kpi.risks != null)    parts.push(`Risks: ${kpi.risks}`);
  return parts.join(' · ');
}

function _stateLabel(state) {
  return ({
    'on-course':  'ровный',
    'drift':      'дрейф',
    'off-course': 'off-course',
  })[state] || 'неизвестно';
}

/* ── markdown builder ──────────────────────────────────────── */

function _slideTitle(brief) {
  const date = _date(brief);
  const stateLabel = _stateLabel(brief?.overall?.state);
  const narrative = _line(brief?.overall?.narrative || '');
  const lines = [
    `# Призма · SteerCo · ${date}`,
    `## Курс: ${stateLabel}`,
  ];
  if (narrative) lines.push(`- ${narrative}`);
  return lines.join('\n');
}

function _slidePortfolio(brief) {
  const lines = ['## Здоровье портфеля'];
  const kpiText = _kpiLine(brief?.portfolio?.kpi);
  if (kpiText) lines.push(`- ${kpiText}`);
  const health = brief?.portfolio?.health;
  if (health?.summary) lines.push(`- ${_line(health.summary)}`);
  if (Array.isArray(health?.insights)) {
    health.insights.slice(0, 4).forEach(i => i && lines.push(`- ${_line(i)}`));
  }
  return lines.join('\n');
}

function _slideRisks(brief) {
  const lines = ['## Топ-3 риска'];
  const top3 = Array.isArray(brief?.risks?.top3) ? brief.risks.top3 : [];
  if (!top3.length) {
    lines.push('- Значимых рисков не обнаружено');
  } else {
    top3.forEach(r => {
      const head  = _line(r?.title || r?.epic || r?.tasks || '—');
      const cause = _line(r?.reason || r?.team || '');
      lines.push(`- ${head}${cause ? ' · ' + cause : ''}`);
    });
  }
  const nar = brief?.risks?.narrative;
  if (Array.isArray(nar?.narratives)) {
    nar.narratives.slice(0, 2).forEach(n => {
      if (n?.title && n?.count) lines.push(`- ${_line(n.title)} · ${n.count}`);
    });
  }
  return lines.join('\n');
}

function _slideCoverage(brief) {
  const lines = ['## Покрытие квартальных целей'];
  const sj = brief?.coverage?.sigmaJira;
  if (!sj || !sj.summary) {
    lines.push('- Чёрный дашборд: данных нет');
    return lines.join('\n');
  }
  const s = sj.summary || {};
  lines.push(`- Цели: ${s.totalGoals || 0}, привязано: ${s.linkedCount || 0}, не привязано: ${s.unlinkedCount || 0}`);
  if (s.coveragePct != null) lines.push(`- Покрытие: ${s.coveragePct}%`);
  if (Array.isArray(sj.coverageByTeam)) {
    sj.coverageByTeam.slice(0, 3).forEach(t => {
      lines.push(`- ${_line(t.name || t.pk)} · ${t.linked}/${t.total} (${t.pct}%)`);
    });
  }
  return lines.join('\n');
}

function _slideTeams(brief) {
  const lines = ['## Команды и нагрузка'];
  const overload = brief?.teams?.overload;
  if (overload != null) lines.push(`- Перегруженных исполнителей: ${overload}`);
  const feed = Array.isArray(brief?.teams?.actionFeed) ? brief.teams.actionFeed : [];
  feed.slice(0, 4).forEach(item => {
    const head = _line(item?.title || '');
    if (head) lines.push(`- ${head}`);
  });
  if (!feed.length && overload == null) lines.push('- Нет данных по командам');
  return lines.join('\n');
}

function _slideActions(brief) {
  const lines = ['## Действия на неделю'];
  const top5 = Array.isArray(brief?.actions?.top5) ? brief.actions.top5 : [];
  if (!top5.length) {
    lines.push('- Действий в очереди нет');
  } else {
    top5.forEach(a => {
      const head = _line(a?.title || a?.name || a?.epic || '—');
      lines.push(`- ${head}`);
    });
  }
  return lines.join('\n');
}

const SLIDE_BUILDERS = [
  _slideTitle, _slidePortfolio, _slideRisks, _slideCoverage, _slideTeams, _slideActions,
];

/* ── public API ───────────────────────────────────────────── */

export const SlideDeck = {
  /**
   * Markdown с slide breaks `---`. Один header `#` = title slide,
   * `##` = body slide title, `-` = bullet.
   * @param {object} brief — output of _buildSteerCoBrief
   * @returns {string}
   */
  exportMarkdown(brief) {
    const slides = SLIDE_BUILDERS.map(fn => fn(brief || {}));
    return slides.join('\n\n---\n\n') + '\n';
  },

  /**
   * PowerPoint / Google Slides outline import: same `# / ## / -`
   * structure, но без markdown-fences и без trailing newline.
   * Slide-разделитель = пустая строка между заголовками (PowerPoint
   * outline не понимает `---`, ему нужны header-levels).
   * @param {object} brief
   * @returns {string}
   */
  exportPptxOutline(brief) {
    const slides = SLIDE_BUILDERS.map(fn => fn(brief || {}));
    // Заменяем `# title` → `Title` (level-1), `## title` → tab+title (level-2)
    // PowerPoint импорт OPML/text outline ожидает табы для индентов:
    //   line0 = slide title (no tab)
    //   line1+ = bullet body (1 tab)
    const out = [];
    slides.forEach((md, idx) => {
      const lines = md.split('\n');
      lines.forEach(ln => {
        if (ln.startsWith('# ')) {
          // первый title — title slide; следующие заменим на slide-titles
          out.push(ln.replace(/^#\s+/, ''));
        } else if (ln.startsWith('## ')) {
          out.push(ln.replace(/^##\s+/, ''));
        } else if (ln.startsWith('- ')) {
          out.push('\t' + ln.replace(/^-\s+/, ''));
        } else if (ln.trim()) {
          out.push(ln);
        }
      });
      if (idx < slides.length - 1) out.push(''); // разделитель slide'ов
    });
    return out.join('\n');
  },

  /**
   * Async Clipboard API. Возвращает true если успешно скопировали.
   * Не падает если API недоступен — просто возвращает false.
   * @param {string} text
   * @returns {Promise<boolean>}
   */
  async copyToClipboard(text) {
    try {
      if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return false;
      await navigator.clipboard.writeText(String(text ?? ''));
      return true;
    } catch (_) {
      return false;
    }
  },

  /**
   * Blob + anchor download. Без libraries.
   * @param {string} filename
   * @param {string} content
   * @param {string} [mime='text/markdown;charset=utf-8']
   * @returns {boolean}
   */
  download(filename, content, mime) {
    try {
      if (typeof document === 'undefined' || typeof Blob === 'undefined') return false;
      const type = mime || 'text/markdown;charset=utf-8';
      const blob = new Blob([String(content ?? '')], { type });
      const url  = (typeof URL !== 'undefined' && URL.createObjectURL)
        ? URL.createObjectURL(blob)
        : null;
      if (!url) return false;
      const a = document.createElement('a');
      a.href = url;
      a.download = String(filename || 'slide-deck.md');
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        try { a.remove(); } catch (_) {}
        try { URL.revokeObjectURL(url); } catch (_) {}
      }, 100);
      return true;
    } catch (_) {
      return false;
    }
  },
};

Services.register('SlideDeck', SlideDeck);
if (typeof window !== 'undefined') window.SlideDeck = SlideDeck;

export default SlideDeck;
