'use strict';
/* ============================================================
   chat/scrubChatSecrets.js — V22 holistic-P4 example wrapper
   --
   Тонкий wrapper над `shared/pii.js`, демонстрирующий что shared-модуль —
   drop-in замена для local-функции `scrubChatSecrets()` из app/llmAssistant.js
   (там она объявлена inline на строке 148).

   Старая реализация (app/llmAssistant.js:148):
     replace Bearer / authorization=token / api[_-]?key= / password / secret
     replace JWT (eyJ.x.y)

   Новая реализация: PII.scrubString покрывает все эти паттерны + добавляет
   email / phone / СНИЛС / паспорт. Для чата это безопасно — если LLM-prompt
   уже scrub'ает PII через scrubPiiInText (V21 BG audit-04 §G #1), то здесь
   двойная защита, а если нет — закрывает дыру.

   Совместимость:
     - Bearer → Bearer ***                  ✓ (то же поведение)
     - authorization=X / apiKey=X → ***     ✓ (то же поведение)
     - JWT eyJ... → ***                     ✓ (то же поведение)
     - дополнительно: email/phone/СНИЛС    + (явный win)

   Использование:
     // В Node-side (server):
     const scrubChatSecrets = require('../chat/scrubChatSecrets.js');
     // В browser-side:
     <script src="shared/pii.js"></script>
     <script src="chat/scrubChatSecrets.js"></script>
     window.scrubChatSecrets(text);

   TODO(holistic-P4 phase-2): заменить local `scrubChatSecrets()` в
   app/llmAssistant.js строка 148 на reference к этому wrapper'у.
   Сейчас не делаем чтобы не трогать 4 callsites за один pass.
   ============================================================ */

(function () {
  // Resolve PII (shared/pii.js) в обоих средах.
  const PII = (typeof require === 'function')
    ? require('../shared/pii.js')
    : (typeof window !== 'undefined' ? window.PII : null);

  if (!PII) {
    // Fail-soft: если PII не подключён — функция возвращает sliced string
    // вместо throw (старое поведение тоже не bricks UI на edge cases).
    function fallback(s) { return String(s == null ? '' : s).slice(0, 5000); }
    if (typeof module !== 'undefined' && module.exports) module.exports = fallback;
    if (typeof window !== 'undefined') window.scrubChatSecrets = fallback;
    return;
  }

  /**
   * Drop-in replacement для legacy `scrubChatSecrets()` из app/llmAssistant.js.
   * @param {*} s
   * @returns {string}
   */
  function scrubChatSecrets(s) {
    // chat-context: длинные сообщения, поэтому maxLen = 5000 вместо 200.
    return PII.scrubString(s, 5000);
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = scrubChatSecrets;
  if (typeof window !== 'undefined') window.scrubChatSecrets = scrubChatSecrets;
})();
