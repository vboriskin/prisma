'use strict';
/* ============================================================
   GANTT EDITABLE HTML IMPORT — приёмная сторона round-trip

   Парсит файл, выпущенный через GanttEditableHTMLExport, и накладывает
   правки на текущее state. На каждом editable поле сравниваем local vs
   imported по updatedAt — если конфликт, передаём в conflict-модалку
   (см. openConflictModal в C6).
   ============================================================ */

import { state } from '../state.js';

export const SUPPORTED_VERSION = 1;
export const SUPPORTED_EDITABLE_SCHEMA = 1;

/** Извлекает meta-объект из HTML-текста файла. Бросает Error если не наш формат. */
export function parseEditableHtml(htmlText) {
  if (!htmlText || typeof htmlText !== 'string') throw new Error('Пустой файл.');
  const m = htmlText.match(/<script id="prizma-snapshot"[^>]*>([\s\S]+?)<\/script>/);
  if (!m) throw new Error('Это не editable-HTML Призмы — нет блока snapshot.');
  const raw = m[1].replace(/\\u003c/g, '<');
  let meta;
  try { meta = JSON.parse(raw); }
  catch (e) { throw new Error('Сломанный snapshot: ' + e.message); }
  if (!meta || typeof meta !== 'object') throw new Error('Неверный формат snapshot.');
  if (meta.version !== SUPPORTED_VERSION) {
    throw new Error(`Несовместимая версия файла (${meta.version}). Обновите приложение.`);
  }
  if (meta.editableSchema !== SUPPORTED_EDITABLE_SCHEMA) {
    throw new Error(`Несовместимая схема editable (${meta.editableSchema}).`);
  }
  return meta;
}

/** Pre-checks перед запуском diff — возвращает массив предупреждений
 *  ('info'/'warning'), которые UI покажет в модалке. Не блокирует. */
export function preCheck(meta) {
  const warnings = [];
  // dataSource mismatch.
  const localIsDemo = (state.rows || []).some(r => String(r.id || '').startsWith('demo_'));
  const localDS = localIsDemo ? 'demo' : 'production';
  if (meta.dataSource && meta.dataSource !== localDS) {
    warnings.push({
      level: 'warning',
      text: `Файл сформирован для «${meta.dataSource === 'demo' ? 'демо-данных' : 'рабочих данных'}», а у вас сейчас «${localDS === 'demo' ? 'демо-данные' : 'рабочие данные'}». Импорт может затронуть не те эпики.`,
    });
  }
  // Already-imported guard. Проверим в action log.
  const log = Array.isArray(state.actionLog) ? state.actionLog : [];
  const seen = log.some(e => e && e.type === 'import_gantt_edits' && e.exportId === meta.exportId);
  if (seen) {
    warnings.push({
      level: 'info',
      text: 'Этот файл уже был импортирован ранее. Импорт можно повторить — изменения будут пере-применены.',
    });
  }
  return warnings;
}

/** Сравнить два значения (deep) для определения «изменилось ли». */
function _eq(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;
  try { return JSON.stringify(a) === JSON.stringify(b); } catch (_) { return false; }
}

/** Имя поля row по типу change — для conflict label. */
const TYPE_LABEL = {
  'donePills':       'Статус «завершено»',
  'inProgressPills': 'Статус «в работе»',
  'cellNotes':       'Заметка',
  'cellRisks':       'Риск',
  'releaseTypes':    'Состав работ колодца',
};

const COL_LABEL = { backlog: 'Бэклог', r120: '1.20', r121: '1.21', r122: '1.22', overtime: 'Овертайм' };
function _colLabel(key) { return COL_LABEL[key] || key; }

/**
 * Возвращает Array<Change>:
 *   { id, type, rowId, epic, subKey, action,
 *     local, imported, isConflict }
 *
 * type: 'donePills' | 'inProgressPills' | 'cellNotes' | 'cellRisks'.
 * action для array-полей (notes/risks): 'add' | 'delete' | 'edit'.
 * isConflict: local поле изменялось ПОСЛЕ meta.exportedAt И local != imported.
 */
export function computeDiff(meta) {
  const importedRows = meta.snapshot?.data?.rows || [];
  const localById = Object.create(null);
  for (const r of (state.rows || [])) localById[r.id] = r;
  const exportedAt = meta.exportedAt || '';
  const changes = [];
  let cId = 0;

  for (const impRow of importedRows) {
    const local = localById[impRow.id];
    if (!local) continue;     // эпик удалён локально — пропускаем (не воссоздаём)
    const wasEditedLocally = (local.updatedAt || '') > exportedAt;
    const epicLabel = String(local.epic || local.tasks || impRow.epic || '(без эпика)').slice(0, 80);

    // 1. donePills / inProgressPills — key-map.
    for (const field of ['donePills', 'inProgressPills']) {
      const impMap = impRow[field] || {};
      const locMap = local[field] || {};
      // Добавленные/изменённые в imported.
      for (const [k, v] of Object.entries(impMap)) {
        if (_eq(locMap[k], v)) continue;
        changes.push({
          id: 'c' + (++cId), type: field, action: locMap[k] === undefined ? 'add' : 'edit',
          rowId: impRow.id, epic: epicLabel, subKey: k,
          imported: v, local: locMap[k] ?? null,
          isConflict: wasEditedLocally && locMap[k] !== undefined,
        });
      }
      // Удалённые в imported (есть локально, нет в imported).
      for (const [k, v] of Object.entries(locMap)) {
        if (impMap[k] !== undefined) continue;
        changes.push({
          id: 'c' + (++cId), type: field, action: 'delete',
          rowId: impRow.id, epic: epicLabel, subKey: k,
          imported: null, local: v,
          isConflict: wasEditedLocally,
        });
      }
    }

    // 2. cellNotes / cellRisks — массивы с id.
    for (const field of ['cellNotes', 'cellRisks']) {
      const impArr = Array.isArray(impRow[field]) ? impRow[field] : [];
      const locArr = Array.isArray(local[field]) ? local[field] : [];
      const impById = Object.create(null); for (const it of impArr) if (it?.id) impById[it.id] = it;
      const locById = Object.create(null); for (const it of locArr) if (it?.id) locById[it.id] = it;
      for (const it of impArr) {
        if (!it?.id) continue;
        const lc = locById[it.id];
        if (!lc) {
          changes.push({
            id: 'c' + (++cId), type: field, action: 'add',
            rowId: impRow.id, epic: epicLabel, subKey: it.id,
            imported: it, local: null,
            isConflict: false,         // add без локального — нет конфликта
          });
        } else if (!_eq(lc, it)) {
          changes.push({
            id: 'c' + (++cId), type: field, action: 'edit',
            rowId: impRow.id, epic: epicLabel, subKey: it.id,
            imported: it, local: lc,
            isConflict: wasEditedLocally,
          });
        }
      }
      for (const it of locArr) {
        if (!it?.id || impById[it.id] !== undefined) continue;
        changes.push({
          id: 'c' + (++cId), type: field, action: 'delete',
          rowId: impRow.id, epic: epicLabel, subKey: it.id,
          imported: null, local: it,
          isConflict: wasEditedLocally,
        });
      }
    }

    // 3. release-types membership (перенос pill между колодцами / состав работ).
    const RELEASE_FIELDS = [
      ['release120Types', 'r120'], ['release121Types', 'r121'],
      ['release122Types', 'r122'], ['overtimeTypes', 'overtime'], ['backlogTypes', 'backlog'],
    ];
    const pushRt = (col, wt, action) => {
      changes.push({
        id: 'c' + (++cId), type: 'releaseTypes', action,
        rowId: impRow.id, epic: epicLabel, subKey: col + '__' + wt, col, wt,
        imported: action === 'add' ? wt : null,
        local: action === 'delete' ? wt : null,
        isConflict: wasEditedLocally,
      });
    };
    for (const [field, col] of RELEASE_FIELDS) {
      const impArr = Array.isArray(impRow[field]) ? impRow[field] : [];
      const locArr = Array.isArray(local[field]) ? local[field] : [];
      for (const wt of impArr) if (!locArr.includes(wt)) pushRt(col, wt, 'add');
      for (const wt of locArr) if (!impArr.includes(wt)) pushRt(col, wt, 'delete');
    }
    // Custom releases.
    const impCustom = impRow.customReleaseTypes || {};
    const locCustom = local.customReleaseTypes || {};
    for (const key of new Set([...Object.keys(impCustom), ...Object.keys(locCustom)])) {
      const impArr = Array.isArray(impCustom[key]) ? impCustom[key] : [];
      const locArr = Array.isArray(locCustom[key]) ? locCustom[key] : [];
      for (const wt of impArr) if (!locArr.includes(wt)) pushRt(key, wt, 'add');
      for (const wt of locArr) if (!impArr.includes(wt)) pushRt(key, wt, 'delete');
    }
  }
  return changes;
}

/** Human-readable label для change (для conflict UI). */
export function describeChange(c) {
  const t = TYPE_LABEL[c.type] || c.type;
  if (c.type === 'donePills' || c.type === 'inProgressPills') {
    return `${t} · pill «${c.subKey}»`;
  }
  if (c.type === 'cellNotes') return `Заметка в ячейке`;
  if (c.type === 'cellRisks') return `Риск в ячейке`;
  if (c.type === 'releaseTypes') return `«${c.wt}» в колодце ${_colLabel(c.col)}`;
  return t;
}

/** Краткое отображение значения для UI (local или imported). */
export function snippetValue(c, which) {
  const v = which === 'local' ? c.local : c.imported;
  if (v == null) return '(нет)';
  if (c.type === 'donePills') {
    return `Завершено${v.at ? ' · ' + v.at : ''}${v.comment ? ' · ' + v.comment.slice(0, 60) : ''}`;
  }
  if (c.type === 'inProgressPills') {
    return `В работе${v.at ? ' · ' + String(v.at).slice(0, 10) : ''}`;
  }
  if (c.type === 'cellNotes') {
    return `${v.col || ''} · ${(v.text || '').slice(0, 80)}`;
  }
  if (c.type === 'cellRisks') {
    return `${v.kind || ''} · ${(v.text || '').slice(0, 80)}${v.dueDate ? ' (до ' + v.dueDate + ')' : ''}`;
  }
  if (c.type === 'releaseTypes') {
    return which === 'imported' ? `есть в ${_colLabel(c.col)}` : `есть в ${_colLabel(c.col)}`;
  }
  try { return JSON.stringify(v).slice(0, 80); } catch (_) { return '(значение)'; }
}
