'use strict';
/* ============================================================
   TEXT AUTOCOMPLETE — single-value drop-in для <input>

   Навешивает popover-suggestions на существующий <input>. Не меняет
   HTML — augment'ит. Кейс: модалка «Добавить эпик» в Ганте (#5).

   Подсказки берутся из getSuggestions() (вызывается на каждый input).
   Фильтр — substring case-insensitive. Стрелки ↑/↓ для навигации,
   Enter выбирает, Escape закрывает.

   Возвращает cleanup-функцию для unmount.
   ============================================================ */

export function attachAutocomplete(inputEl, getSuggestions, opts = {}) {
  if (!inputEl || typeof getSuggestions !== 'function') return () => {};
  const maxItems = opts.maxItems || 10;
  const dropdown = document.createElement('div');
  dropdown.className = 'tag-suggest-drop hidden';
  dropdown.style.cssText = 'position:fixed;z-index:9999;';
  document.body.appendChild(dropdown);

  let activeIdx = -1;
  let visible = [];

  function render() {
    const q = inputEl.value.trim().toLowerCase();
    visible = getSuggestions()
      .filter(s => q ? String(s).toLowerCase().includes(q) : true)
      .slice(0, maxItems);
    if (!visible.length) { dropdown.classList.add('hidden'); return; }
    if (activeIdx >= visible.length) activeIdx = -1;
    const r = inputEl.getBoundingClientRect();
    dropdown.style.left = r.left + 'px';
    dropdown.style.top = (r.bottom + 2) + 'px';
    dropdown.style.minWidth = Math.max(160, r.width) + 'px';
    dropdown.innerHTML = visible.map((s, i) => {
      const safe = String(s).replace(/"/g, '&quot;').replace(/</g, '&lt;');
      return `<div class="tag-suggest-item${i === activeIdx ? ' is-active' : ''}" data-val="${safe}" data-idx="${i}">${safe}</div>`;
    }).join('');
    dropdown.querySelectorAll('.tag-suggest-item').forEach(item => {
      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        commit(item.dataset.val);
      });
    });
    dropdown.classList.remove('hidden');
  }

  function commit(value) {
    inputEl.value = value;
    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    inputEl.dispatchEvent(new Event('change', { bubbles: true }));
    dropdown.classList.add('hidden');
    activeIdx = -1;
  }

  const onInput = () => { activeIdx = -1; render(); };
  const onFocus = () => render();
  const onBlur = () => setTimeout(() => dropdown.classList.add('hidden'), 150);
  const onKey = (e) => {
    if (dropdown.classList.contains('hidden')) {
      if (e.key === 'ArrowDown') { e.preventDefault(); render(); }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIdx = Math.min(visible.length - 1, activeIdx + 1);
      render();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIdx = activeIdx <= 0 ? -1 : activeIdx - 1;
      render();
    } else if (e.key === 'Enter' && activeIdx >= 0) {
      e.preventDefault();
      commit(visible[activeIdx]);
    } else if (e.key === 'Escape') {
      dropdown.classList.add('hidden');
    }
  };

  inputEl.addEventListener('input', onInput);
  inputEl.addEventListener('focus', onFocus);
  inputEl.addEventListener('blur', onBlur);
  inputEl.addEventListener('keydown', onKey);

  return () => {
    inputEl.removeEventListener('input', onInput);
    inputEl.removeEventListener('focus', onFocus);
    inputEl.removeEventListener('blur', onBlur);
    inputEl.removeEventListener('keydown', onKey);
    dropdown.remove();
  };
}
