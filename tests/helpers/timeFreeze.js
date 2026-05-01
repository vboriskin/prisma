'use strict';
/* ============================================================
   tests/helpers/timeFreeze.js
   --
   Detereminism for time-dependent tests. Freezes Date.now() and
   `new Date()` (zero-arg form) to a fixed instant; restores on cleanup.
   Use via the `withFrozenTime` helper below — it returns a restore fn,
   so tests can `t.after(restore)` to clean up reliably.

   Usage:
     import { withFrozenTime, ISO_2026_04_28_NOON } from '../helpers/timeFreeze.js';
     test('something time-dependent', (t) => {
       const restore = withFrozenTime(ISO_2026_04_28_NOON);
       t.after(restore);
       // ... assertions ...
     });
   ============================================================ */

/** Reference instants used across tests. Picking 2026-04-28 12:00 UTC
 *  keeps "today" / "yesterday" / "two days ago" inside a Tuesday-Thursday
 *  range so weekday-sensitive tests don't straddle a weekend boundary. */
export const ISO_2026_04_28_NOON     = '2026-04-28T12:00:00.000Z';
export const ISO_2026_04_27_NOON     = '2026-04-27T12:00:00.000Z'; // yesterday
export const ISO_2026_04_26_NOON     = '2026-04-26T12:00:00.000Z'; // 2 days ago
export const ISO_2026_04_28_EARLY_AM = '2026-04-28T03:15:00.000Z'; // today, early
export const ISO_2026_04_25_NOON     = '2026-04-25T12:00:00.000Z'; // 3 days ago

/** Freeze the global clock to `iso`. Returns a restore function the
 *  caller MUST invoke (typically via `t.after(restore)`). */
export function withFrozenTime(iso) {
  const frozen = new Date(iso).getTime();
  const RealDate = Date;
  const realNow  = Date.now;

  // Subclass so `instanceof Date` still works and full Date API is preserved.
  class FrozenDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(frozen);
      else super(...args);
    }
    static now() { return frozen; }
  }
  // Keep static methods like Date.parse/UTC pointing at the real Date.
  FrozenDate.parse = RealDate.parse.bind(RealDate);
  FrozenDate.UTC   = RealDate.UTC.bind(RealDate);

  globalThis.Date = FrozenDate;

  return function restore() {
    globalThis.Date = RealDate;
    Date.now = realNow;
  };
}
