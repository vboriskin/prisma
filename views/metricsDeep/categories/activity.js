'use strict';
/* ============================================================
   METRICS DEEP — Категория 5: Активность
   --
   AUDIT_SCANNER_METRICS F-FAKE-4 (CRITICAL) — вся категория удалена.
   Все 10 чартов были полностью синтетическими (sin/cos/random/exp), без
   единого extractor'а реальных данных:
   - activity-timeline       = exp(-(i-14)²/18)*12
   - activity-calendar       = sin(i*0.2)*8 + random()*3
   - activity-git-heatmap    = 53×7 матрица random()
   - activity-timeline-heatmap = «10-18 ПН-ПТ» × sin × random
   - activity-streamgraph    = переходы статусов синтез
   - activity-timeseries     = 15 + sin(i*0.4)*8 + random()*4
   - activity-weekday-bar    = 40 + cos(i*0.4)*8
   - activity-trend-line     = 60 точек = 40 + i*0.4 + sin*10
   - activity-area-status    = 14 дней × 4 статуса синтез
   - activity-session-histogram = hardcoded [4,22,38,28,16,9,3]

   Возврат категории — после появления реальных event-timestamps
   (через `metricsHistory` writer, см. F-FAKE-3) и BB git-events
   агрегации (через `participant.bbActivity.byDay`). До тех пор
   категория не должна вводить тимлида в заблуждение.
   ============================================================ */

export const ACTIVITY_CHARTS = [];
