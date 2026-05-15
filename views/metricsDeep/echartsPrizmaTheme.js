'use strict';
/* ============================================================
   ECharts theme — Призма
   Резолвит CSS-переменные из текущей темы (light/dark) в hex
   и возвращает theme-объект для `echarts.registerTheme(...)`.
   Перерезолвится при каждом mount'е, чтобы тема ECharts всегда
   совпадала с активной темой страницы.
   ============================================================ */

/** Read CSS variable from :root (resolved hex/rgb string). */
function _cssVar(name, fallback) {
  if (typeof document === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/** Build theme JSON tied to current Prizma palette. */
export function buildPrizmaEchartsTheme() {
  const information = _cssVar('--prizma-information', '#6EC1E4');
  const onCourse    = _cssVar('--prizma-on-course',   '#7FE8B5');
  const drift       = _cssVar('--prizma-drift',       '#FFB347');
  const offCourse   = _cssVar('--prizma-off-course',  '#FF6B6B');
  const insight     = _cssVar('--prizma-insight',     '#B084CC');
  const textPrimary = _cssVar('--prizma-text-primary',  '#1A1A22');
  const textSecondary = _cssVar('--prizma-text-secondary', '#5A5A64');
  const bgElevated  = _cssVar('--prizma-bg-elevated', '#FFFFFF');
  const border      = _cssVar('--prizma-border',      'rgba(26,26,34,.08)');

  // Сигнальная палитра Призмы — порядок: information → on-course → drift → off-course → insight.
  const palette = [information, onCourse, drift, offCourse, insight];

  return {
    color: palette,
    backgroundColor: 'transparent',
    textStyle: {
      color: textPrimary,
      fontFamily: "'SF Pro Display', 'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
      fontSize: 12,
    },
    title: {
      textStyle: { color: textPrimary, fontWeight: 600 },
      subtextStyle: { color: textSecondary },
    },
    legend: {
      textStyle: { color: textSecondary, fontSize: 11 },
      itemWidth: 12, itemHeight: 8,
      itemGap: 14,
    },
    tooltip: {
      backgroundColor: bgElevated,
      borderColor: border,
      borderWidth: 1,
      textStyle: { color: textPrimary, fontSize: 12 },
      extraCssText: 'border-radius: 8px; box-shadow: 0 4px 16px rgba(0,0,0,.12); padding: 8px 12px;',
    },
    grid: { borderColor: border, containLabel: true },
    categoryAxis: {
      axisLine:  { lineStyle: { color: border } },
      axisTick:  { lineStyle: { color: border } },
      axisLabel: { color: textSecondary, fontSize: 11 },
      splitLine: { lineStyle: { color: border, type: 'dashed' } },
    },
    valueAxis: {
      axisLine:  { show: false },
      axisTick:  { show: false },
      axisLabel: { color: textSecondary, fontSize: 11 },
      splitLine: { lineStyle: { color: border, type: 'dashed' } },
    },
    line: { itemStyle: { borderWidth: 0 }, lineStyle: { width: 2 }, symbolSize: 6, smooth: true },
    bar:  { itemStyle: { borderRadius: [4, 4, 0, 0] } },
    pie:  { itemStyle: { borderColor: bgElevated, borderWidth: 2 } },
    radar: {
      axisLine:  { lineStyle: { color: border } },
      splitLine: { lineStyle: { color: border, type: 'dashed' } },
      splitArea: { show: false },
      axisName:  { color: textSecondary, fontSize: 10 },
    },
    // V21 audit P2 — animation отключена по умолчанию: 60 одновременных
    // mount'ов запускали 60 параллельных rAF-loops и фризили main thread на
    // 1-2 секунды. Brand-feel приходит из CSS-обёртки `.md-chart` (enter
    // анимация через cubic-bezier(0.16,1,0.3,1) — точный брендовый easing,
    // ECharts cubicOut был только аппроксимацией).
    // V21 audit S5 — кастомный cubic-bezier ECharts не поддерживает, поэтому
    // полагаемся на CSS animation у контейнера, не у series.
    animation: false,
    animationDurationUpdate: 240,
    animationEasingUpdate: 'cubicOut',
    // V21 audit S6 — aria-tree для screen reader'а. ECharts генерирует
    // полу-структурированное описание из option (title, series, values).
    aria: { enabled: true, decal: { show: false } },
  };
}

/** Convenience: register the theme with an echarts namespace import. */
export function registerPrizmaTheme(echarts, name = 'prizma') {
  if (!echarts || typeof echarts.registerTheme !== 'function') return false;
  echarts.registerTheme(name, buildPrizmaEchartsTheme());
  return true;
}
