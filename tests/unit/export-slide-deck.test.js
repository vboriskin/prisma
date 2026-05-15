'use strict';
/* ============================================================
   tests/unit/export-slide-deck.test.js
   --
   Tests for SlideDeck export module (AUDIT_HOLISTIC §5.2).
   Covers:
     1. exportMarkdown — структура (title, 5 секций, slide breaks)
     2. exportPptxOutline — формат (плоский, табы, без `---`)
     3. copyToClipboard — async API mock + rejection path
     4. brief shape сохраняется (бренд: без эмодзи)
     5. download — Blob + anchor mock
     6. exportMarkdown — резистентность к пустому/частичному brief
   ============================================================ */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import SlideDeck from '../../app/exportSlideDeck.js';

/* ── fixture: минимальный, но реалистичный brief ─────────── */

function makeBrief(over = {}) {
  return {
    meta: {
      date:      '2026-05-08',
      builtAt:   '2026-05-08T10:00:00Z',
      rowsCount: 45,
    },
    overall: {
      state:     'drift',
      narrative: 'Курс с дрейфом, два релиза просели за неделю.',
    },
    portfolio: {
      kpi: { total: 45, done: 12, donePct: 27, blockers: 3, risks: 5 },
      health: {
        summary: 'Проект требует внимания. 27% готово.',
        insights: [
          'Выполнено 12 из 45 задач (27%)',
          '3 активных блокера',
          '5 задач без релиза',
        ],
      },
    },
    risks: {
      top3: [
        { title: 'Релиз 1.21 в дрейфе', reason: 'burn-down 42%', kind: 'release' },
        { title: 'Авторизация',         reason: 'Pay',           kind: 'blocker' },
        { title: 'Поиск',               reason: 'Search',        kind: 'blocker' },
      ],
      narrative: {
        narratives: [
          { title: 'Блокеры в ближайших релизах', count: 3 },
        ],
      },
    },
    coverage: {
      sigmaJira: {
        summary:        { totalGoals: 10, linkedCount: 7, unlinkedCount: 3, coveragePct: 70 },
        coverageByTeam: [
          { name: 'Pay',    pk: 'PAY',  total: 20, linked: 18, pct: 90 },
          { name: 'Search', pk: 'SCH',  total: 15, linked: 10, pct: 67 },
        ],
        goalsCount:     10,
      },
    },
    teams: {
      overload:   2,
      actionFeed: [
        { id: 'feed_blockers_near', title: 'Разобрать 3 блокеров в релизах', severity: 'critical' },
        { id: 'feed_overload',      title: 'Перегруз: Иванов, Петров',       severity: 'warning' },
      ],
    },
    actions: {
      top5: [
        { id: 'fix_blockers', title: 'Разблокировать 3 задач', kind: 'hygiene' },
        { id: 'confirm_scope', title: 'Подтвердить scope у 7 задач', kind: 'hygiene' },
      ],
    },
    ...over,
  };
}

/* ── 1. exportMarkdown structure ───────────────────────────── */

describe('SlideDeck.exportMarkdown', () => {
  test('содержит title slide с датой', () => {
    const md = SlideDeck.exportMarkdown(makeBrief());
    assert.match(md, /^# Призма · SteerCo · 2026-05-08/);
  });

  test('содержит все 5 секций как `## ...`', () => {
    const md = SlideDeck.exportMarkdown(makeBrief());
    assert.ok(md.includes('## Курс: дрейф'), 'state heading');
    assert.ok(md.includes('## Здоровье портфеля'), 'portfolio');
    assert.ok(md.includes('## Топ-3 риска'), 'risks');
    assert.ok(md.includes('## Покрытие квартальных целей'), 'coverage');
    assert.ok(md.includes('## Команды и нагрузка'), 'teams');
    assert.ok(md.includes('## Действия на неделю'), 'actions');
  });

  test('slides разделены `---` (минимум 5 разделителей = 6 slide-блоков)', () => {
    const md = SlideDeck.exportMarkdown(makeBrief());
    const breaks = md.match(/^---$/gm) || [];
    assert.ok(breaks.length >= 5, `expected >=5 slide breaks, got ${breaks.length}`);
  });

  test('брендбук: без эмодзи', () => {
    const md = SlideDeck.exportMarkdown(makeBrief());
    // диапазоны emoji: dingbats, misc-symbols, emoticons, transport.
    assert.doesNotMatch(md, /[\u{1F300}-\u{1FAFF}]|[\u{2600}-\u{27BF}]/u);
  });

  test('включает KPI и top-3 risks', () => {
    const md = SlideDeck.exportMarkdown(makeBrief());
    assert.ok(md.includes('Total: 45'));
    assert.ok(md.includes('Done: 12'));
    assert.ok(md.includes('Blockers: 3'));
    assert.ok(md.includes('Релиз 1.21 в дрейфе'));
  });

  test('пустой brief не падает', () => {
    const md = SlideDeck.exportMarkdown({});
    assert.equal(typeof md, 'string');
    assert.ok(md.includes('# Призма · SteerCo · '));
    assert.ok(md.includes('## Здоровье портфеля'));
  });
});

/* ── 2. exportPptxOutline format ───────────────────────────── */

describe('SlideDeck.exportPptxOutline', () => {
  test('format: первая строка = title без `#`', () => {
    const txt = SlideDeck.exportPptxOutline(makeBrief());
    const firstLine = txt.split('\n')[0];
    assert.equal(firstLine, 'Призма · SteerCo · 2026-05-08');
    assert.ok(!firstLine.startsWith('#'));
  });

  test('bullet'+'ы — табом, не дефисом', () => {
    const txt = SlideDeck.exportPptxOutline(makeBrief());
    assert.match(txt, /^\tTotal: 45/m);
    assert.doesNotMatch(txt, /^- /m);
  });

  test('нет `---` slide-разделителей', () => {
    const txt = SlideDeck.exportPptxOutline(makeBrief());
    assert.doesNotMatch(txt, /^---$/m);
  });

  test('содержит slide-titles без префикса', () => {
    const txt = SlideDeck.exportPptxOutline(makeBrief());
    assert.match(txt, /^Здоровье портфеля$/m);
    assert.match(txt, /^Топ-3 риска$/m);
  });
});

/* ── 3. copyToClipboard mock ───────────────────────────────── */

describe('SlideDeck.copyToClipboard', () => {
  // В Node 22+ globalThis.navigator — getter-only. Используем defineProperty
  // с writable: true чтобы перезаписать на время теста, и восстанавливаем
  // оригинальный descriptor в finally.
  function _withNavigator(fakeNav, fn) {
    const origDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'navigator', {
      value: fakeNav, writable: true, configurable: true, enumerable: true,
    });
    return Promise.resolve()
      .then(fn)
      .finally(() => {
        if (origDesc) Object.defineProperty(globalThis, 'navigator', origDesc);
        else delete globalThis.navigator;
      });
  }

  test('возвращает true когда navigator.clipboard.writeText резолвится', async () => {
    const captured = { text: null };
    await _withNavigator({
      clipboard: { writeText: async (s) => { captured.text = s; } },
    }, async () => {
      const ok = await SlideDeck.copyToClipboard('hello');
      assert.equal(ok, true);
      assert.equal(captured.text, 'hello');
    });
  });

  test('возвращает false если API недоступен', async () => {
    await _withNavigator({}, async () => {
      const ok = await SlideDeck.copyToClipboard('x');
      assert.equal(ok, false);
    });
  });

  test('возвращает false когда writeText бросает', async () => {
    await _withNavigator({
      clipboard: { writeText: async () => { throw new Error('blocked'); } },
    }, async () => {
      const ok = await SlideDeck.copyToClipboard('x');
      assert.equal(ok, false);
    });
  });
});

/* ── 4. brief shape сохраняется ─────────────────────────── */

describe('brief shape integrity', () => {
  test('exportMarkdown НЕ мутирует input brief', () => {
    const brief = makeBrief();
    const before = JSON.stringify(brief);
    SlideDeck.exportMarkdown(brief);
    SlideDeck.exportPptxOutline(brief);
    const after = JSON.stringify(brief);
    assert.equal(before, after, 'brief был мутирован экспортом');
  });

  test('exportMarkdown терпит partial brief (нет coverage / risks)', () => {
    const partial = {
      overall: { state: 'on-course', narrative: 'Всё ровно.' },
      portfolio: { kpi: { total: 10, done: 10, donePct: 100, blockers: 0, risks: 0 } },
    };
    const md = SlideDeck.exportMarkdown(partial);
    assert.ok(md.includes('## Курс: ровный'));
    assert.ok(md.includes('## Покрытие квартальных целей'));
    assert.ok(md.includes('Чёрный дашборд: данных нет') || md.includes('данных нет'));
  });
});

/* ── 5. download — Blob + anchor mock ──────────────────────── */

describe('SlideDeck.download', () => {
  test('создаёт Blob и кликает по anchor', () => {
    const events = [];
    const fakeAnchor = {
      href: '', download: '', style: {},
      click() { events.push(['click', this.href, this.download]); },
      remove() { events.push(['remove']); },
    };
    const origDoc = globalThis.document;
    const origURL = globalThis.URL;
    let createdBlob = null;
    globalThis.document = {
      createElement: (tag) => {
        events.push(['createElement', tag]);
        return fakeAnchor;
      },
      body: { appendChild: (el) => events.push(['appendChild', el === fakeAnchor ? 'anchor' : '?']) },
    };
    globalThis.URL = {
      createObjectURL: (blob) => {
        createdBlob = blob;
        return 'blob:fake-url';
      },
      revokeObjectURL: () => {},
    };
    try {
      const ok = SlideDeck.download('test.md', '# hello', 'text/markdown');
      assert.equal(ok, true);
      assert.ok(createdBlob instanceof Blob, 'Blob создан');
      assert.equal(fakeAnchor.download, 'test.md');
      assert.equal(fakeAnchor.href, 'blob:fake-url');
      assert.ok(events.some(e => e[0] === 'click'), 'был клик по anchor');
    } finally {
      if (origDoc === undefined) delete globalThis.document; else globalThis.document = origDoc;
      if (origURL === undefined) delete globalThis.URL;      else globalThis.URL      = origURL;
    }
  });

  test('возвращает false если document недоступен', () => {
    const origDoc = globalThis.document;
    delete globalThis.document;
    try {
      const ok = SlideDeck.download('x.md', 'y');
      assert.equal(ok, false);
    } finally {
      if (origDoc !== undefined) globalThis.document = origDoc;
    }
  });
});
