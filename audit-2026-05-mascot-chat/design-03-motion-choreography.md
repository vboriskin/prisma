# Design — motion choreography (детальный аудит)

> Motion-дизайнер. Tier-stacking, particles, hibernate, easing tokens.
> Дата: 2026-05-07

## 1. Таблица проблем

| ID | Sev | Issue | Fix |
|---|---|---|---|
| **M1** | **HIGH** | **Tier 3+2 stacking сломан**: `_setLoop`/`_playOnce` вызывают `_clearStates`, который снимает `obs--breathe`. На hover на FAB класс становится `obs obs--cur` без Breathe — нарушает §13.9 «Tier 3 + Tier 2 — всегда стакаются». То же для всех Tier 2 на FAB и для chat avatar (Breathe пропадает во время `ls-thinking`/`ls-streaming`). | Разделить classes на «exclusive» (T1 + Living Shape + T2) и «ambient» (T3). `_clearStates` снимает только exclusive; Breathe/Blink остаются всегда. См. код-fix ниже. |
| **M2** | MED | **Alert перебивает Emerge**: `pulseAlertOnFab` использует `_playOnce`, который слепо `_clearStates`. Если Emerge ещё идёт (2400ms), alert обрывает signature-анимацию. Гард `_wireFabHover` против Emerge есть, но `pulseAlertOnFab` его НЕ имеет. Нарушает §13.9 «T1 не стакать с T2». | В `pulseAlertOnFab` добавить guard `if (this._fab.classList.contains('obs--emerge')) { setTimeout(()=>this.pulseAlertOnFab(), EMERGE_MS); return; }`. |
| **M3** | LOW | **`prefers-reduced-motion`**: блок в css:943 ставит `animation: none !important` на `.obs *` и `.obs svg`. Корректно отключает T1/T2/T3 включая Breathe. `obs--once` `animation-fill-mode: both` тоже `!important`, но `animation: none` берёт верх. Маскот остаётся в начальной 0%-позе спрайта (нейтрал, глаза открыты). OK. Однако `_playOnce` навешивает `obs--once` и в reduced-motion `animationend` не выстреливает — спасает 3500ms safety timeout. | OK как есть. Мелкая рекомендация: в `_playOnce` дополнительно проверять `_reducedMotion()` и сразу резолвить promise без навешивания once-класса. |
| **M4** | MED | **Hover jank**: при быстром mouseenter/leave `_setLoop` снимает класс и ставит новый — CSS-анимация перезапускается с 0% (тело прыгает в нейтраль, потом снова в наклон). Видимое дёрганье. | Добавить debounce 80–120ms на mouseleave; либо использовать CSS-only hover (`:hover` на `.assistant-fab` → `.obs--cur`). Лучше — переход по transitions, не animation, для T2 «Curious» в idle-режиме. |
| **M5** | LOW | **Easing tokens**: `--obs-quick`, `--obs-active` объявлены в `:root`, но в коде НЕ используются. Анимации применяют только `--obs-ease-*`. Также есть hardcoded `cubic-bezier(0.85, 0, 0.15, 1)` (look), `cubic-bezier(0.4, 0, 0.6, 1)` (sway), `cubic-bezier(0.5, 0, 0.5, 1)` (settle/hibernate eye), `cubic-bezier(0.34, 1.5, 0.64, 1)` (success), `cubic-bezier(0.34, 1.3, 0.64, 1)` (wink/ls-done) и др. ~10 raw cubic-bezier. | Прибраться: либо удалить неиспользуемые `--obs-quick`/`--obs-active`, либо заменить hardcoded easings на токены. |
| **M6** | MED | **Living Shape physics на 32px**: ls-streaming делает skewY 1.5deg + scale 1.04 + translateX 0.5%. На 32×32 это ≈0.5px смещения, ≈1.3px scale-delta. Видимо, но subtle — physics «ундуляции» теряется, читается скорее как jitter. §13.6 описывает выраженное волнообразное движение. | На chat avatar (small) усилить amplitude через override: `.obs--ls-streaming.obs--sm .obs-body { animation-name: obs-ls-stream-body-sm; }` с увеличенными значениями (skewY 3deg, scale 1.08). |
| **M7** | **HIGH UX** | **Particles в ls-streaming отсутствуют**: CSS таргетит `.obs-emit-1..4` внутри `.obs--ls-streaming`, но в текущем SVG-спрайте этих узлов нет. Будет только тело-ундуляция, без характерных частиц «вылетающих к ответу». §13.6 явно требует частицы. | Добавить в SVG спрайт `<circle class="obs-emit-1/2/3/4" cx="0" cy="0" r="0">` (4 шт.). То же для `obs-return-1/2`, `obs-trail-1/2/3`, `obs-particle`, `obs-socket` для других ls-* состояний. Без них ls-complete/move/tool тоже неполные. |
| **M8** | MED | **Hibernate trigger отсутствует**: §13.7 требует idle 5+ мин → Hibernate. В `obsidianMascot.js` нет idle-таймера, нет `vanish` → `hibernate`. Остаётся вечный Breathe. | Реализовать idle-detector (`mousemove`/`keydown` в `init`, debounce 5min) → `_playOnce(fab, 'obs--vanish')` → `_setLoop(fab, 'obs--hibernate')`. Будит обратно: любой mousemove → `obs--awaken` once → Breathe. |
| **M9** | LOW | **`once` safety timeout 3500ms vs `ls-tool` 2800ms**: 3500 > 2800 — OK. Запас 700ms покрывает event-loop задержки. Самая длинная once — `ls-tool` (2800), `ls-error` (2400), `vanish` (2800), `emerge` (2400). Все < 3500. OK. | None. |
| **M10** | LOW | **Theme switch flash**: `--obs-body`/`--obs-feature` меняются мгновенно, fill SVG-частей берёт новое значение в следующий paint. На path/circle нет `transition: fill 200ms` — будет видимый flash на larger 56px FAB (особенно при streaming). | Добавить в `.obs svg path, .obs svg circle, .obs svg rect { transition: fill 200ms var(--obs-ease-out), stroke 200ms var(--obs-ease-out); }`. В reduced-motion отрубается через `transition: none !important` в @media. |

## 2. Код-fix для главного бага (M1) — Tier 3+2 stacking

Файл: `app/obsidianMascot.js`

```js
// Tier 3 ambient — НЕ снимаются при exclusive swap (§13.9 stack contract).
const AMBIENT_CLASSES = new Set([
  'obs--breathe', 'obs--blink', 'obs--look', 'obs--float', 'obs--sway', 'obs--pulse',
]);

// Exclusive (Tier 1, Tier 2, Living Shape) — взаимоисключающие.
const EXCLUSIVE_CLASSES = [
  'obs--emerge', 'obs--vanish', 'obs--hibernate',
  'obs--ack', 'obs--cur', 'obs--alert', 'obs--success', 'obs--surprised',
  'obs--awaken', 'obs--settle', 'obs--squint', 'obs--wink', 'obs--concerned',
  'obs--ls-thinking', 'obs--ls-streaming', 'obs--ls-complete',
  'obs--ls-stop', 'obs--ls-error', 'obs--ls-tool', 'obs--ls-move',
  'obs--once',
];

function _clearExclusive(el) {
  if (!el) return;
  for (const c of EXCLUSIVE_CLASSES) el.classList.remove(c);
}

function _ensureAmbient(el, ambient = 'obs--breathe') {
  if (!el) return;
  // Breathe всегда живёт поверх state (§13.9 п. «Tier 3 + Tier 2 стакаются»).
  // Tier 1 (emerge/vanish/hibernate) сами решают про breathe — для них ambient
  // отключаем, т.к. signature-анимация уже трансформирует svg.
  el.classList.add(ambient);
}

function _setLoop(el, stateClass, opts = {}) {
  if (!el) return;
  _clearExclusive(el);
  // Для Tier 1 — без ambient (§13.9 «Tier 1 + Living Shape нельзя стакать»;
  // breathe также конфликтует с emerge body-scale).
  const isTier1 = /^obs--(emerge|vanish|hibernate)$/.test(stateClass);
  if (!isTier1 && opts.ambient !== false) _ensureAmbient(el);
  el.classList.add(stateClass);
}

function _playOnce(el, stateClass, baseState = 'obs--breathe') {
  if (!el) return Promise.resolve();
  return new Promise(resolve => {
    _clearExclusive(el);
    _ensureAmbient(el);                 // breathe держится во время T2
    el.classList.add(stateClass);
    el.classList.add('obs--once');
    let done = false;
    const finish = () => {
      if (done) return; done = true;
      el.removeEventListener('animationend', finish);
      _clearExclusive(el);
      if (baseState && baseState !== 'obs--breathe') el.classList.add(baseState);
      _ensureAmbient(el);
      resolve();
    };
    el.addEventListener('animationend', finish);
    setTimeout(finish, 3500);
  });
}
```

Дополнительно в `_playEmergeIfFirstSession`/`init` для T1 НЕ ставить `obs--breathe` параллельно (свертится со scale). Все остальные пути теперь дают корректный стак, например на hover: `class="obs obs--breathe obs--cur"`.

CSS-уточнение: `obs-breathe` использует `transform: scale` на `svg`, и Tier 2 классы вроде `obs--ack` анимируют `.obs-body` (под svg-нодой). Конфликта transform-target'а нет — Breathe модифицирует svg root, T2 модифицирует группу внутри. Стак работает корректно. Для T1 (emerge/vanish/hibernate), которые трогают `.obs-body` тоже, Breathe всё ещё на svg — но scale «дышания» поверх Emerge body-scale даст лёгкий двойной overshoot; поэтому для T1 ambient отключаем.

## 3. Рекомендации по будущему развитию

1. **Particles SVG-spritesheet**: расширить `obsidian-sprite.svg` дополнительными `<circle>` нодами с классами `obs-emit-1..4`, `obs-return-1..2`, `obs-trail-1..3`, `obs-particle`, `obs-socket`. Без них половина Living Shape анимаций — только тело без обещанной §13.6 экспрессии.
2. **Idle-timer для Hibernate**: в `init()` повесить throttled `mousemove`+`keydown`+`visibilitychange`, дебаунс 5 минут → `_playOnce(fab, 'obs--vanish')` → `_setLoop(fab, 'obs--hibernate', {ambient:false})`. Awake: первый input-event → `_playOnce(fab, 'obs--awaken', 'obs--breathe')`.
3. **Smooth chat-phase transitions**: между `ls-thinking` → `ls-streaming` сейчас жёсткий swap. Добавить промежуточный `_playOnce(avatar, 'obs--ack', 'obs--ls-streaming')` (короткий кивок «принял»).
4. **Hover debounce**: 100ms `mouseleave` debounce в `_wireFabHover` против jank.
5. **Theme transition**: `transition: fill 200ms` на SVG элементах для smooth-переключения тем в mid-animation.
6. **Token cleanup**: либо использовать `--obs-quick`/`--obs-active`, либо удалить — сейчас они dead code; hardcoded cubic-bezier'ы перевести в токены `--obs-ease-pendulum` (sway/blink), `--obs-ease-bounce` (success).
7. **ls-streaming amplitude override** для small (32px) chat avatar — увеличить deformation в 1.5–2× чтобы physics §13.6 читалась.
8. **Reduced-motion path в `_playOnce`**: ранний return без навешивания once-класса, сразу финальный baseState — избавит от 3500ms холостого таймера.
9. **Telemetry hook**: `logger.event('obsidian.phase', {phase, dur})` в каждом swap — пригодится для UX-метрик.
10. **Контракт-тест**: unit-test, что после любого `setChatPhase`/`pulseAlertOnFab` элемент содержит класс `obs--breathe` (Tier 3 invariant), кроме T1 состояний — закрепит §13.9 регрессионно.
