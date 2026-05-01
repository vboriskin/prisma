'use strict';
/* ============================================================
   server/integrations/jobs.js — V18.1 P10 (extracted from server.js)

   Generic async-job cluster. Same pattern is used by:
     • Black Dashboard (V12) — long Sigma aggregation
     • Portfolio Pulse (V18 P7) — long Jira+BB+CF aggregation

   Both originally had inline `_bdJobs / _pulseJobs` Maps + create/get/runJob
   helpers (~50 LOC each, identical structure). V18.1 P10 unifies them
   through `createJobsCluster()` factory.

   Public API:
     const cluster = createJobsCluster({ prefix: 'pulse', ttlMs: 30*60*1000, maxCount: 20 });
     cluster.create(payload?) → job
     cluster.get(id)          → job | null
     cluster.run(job, runner) → starts background runner; mutates job on resolve/reject
     cluster.gc()             → manual GC (also auto on each create)

   Job shape:
     { id, status: 'running'|'done'|'error', startedAt, finishedAt, result, error,
       phase, payload }

   `runner(job)` is an async function that EITHER returns the result
   (job.status='done', job.result=value) OR throws (job.status='error',
   job.error=msg). Inside `runner`, `job.phase = '...'` is the way to surface
   progress to the polling client.
   ============================================================ */

/**
 * Create a self-contained job cluster. Each cluster has its own Map +
 * counter — no cross-contamination between bd / pulse / future clusters.
 *
 * @param {object} opts
 * @param {string} [opts.prefix='job']         — job-id prefix (e.g. 'bd', 'pulse')
 * @param {number} [opts.ttlMs=30*60*1000]     — eviction TTL after finishedAt
 * @param {number} [opts.maxCount=50]          — hard ceiling; oldest evicted
 * @param {string} [opts.label='']             — used in console.warn on error
 * @returns {{create:Function, get:Function, run:Function, gc:Function, _map:Map}}
 */
function createJobsCluster(opts = {}) {
  const prefix   = opts.prefix   || 'job';
  const TTL_MS   = Number.isFinite(opts.ttlMs)   ? opts.ttlMs   : 30 * 60 * 1000;
  const MAX_CNT  = Number.isFinite(opts.maxCount) ? opts.maxCount : 50;
  const label    = opts.label    || prefix;
  const jobs     = new Map();
  let counter = 0;

  function gc() {
    const now = Date.now();
    for (const [id, job] of jobs) {
      const t = job.finishedAt || job.startedAt;
      if (now - t > TTL_MS) jobs.delete(id);
    }
    if (jobs.size > MAX_CNT) {
      const entries = [...jobs.entries()].sort(
        (a, b) => (a[1].finishedAt || a[1].startedAt) - (b[1].finishedAt || b[1].startedAt)
      );
      const overflow = jobs.size - MAX_CNT;
      for (let i = 0; i < overflow; i++) jobs.delete(entries[i][0]);
    }
  }

  function create(payload) {
    gc();
    const id = `${prefix}-${++counter}-${Date.now().toString(36)}`;
    const job = {
      id,
      status:     'running',
      startedAt:  Date.now(),
      finishedAt: null,
      result:     null,
      error:      null,
      phase:      'init',
      payload:    payload || null,
    };
    jobs.set(id, job);
    return job;
  }

  function get(id) { return jobs.get(id) || null; }

  function run(job, runner) {
    Promise.resolve()
      .then(() => runner(job))
      .then(
        (result) => {
          job.status     = 'done';
          job.result     = result;
          job.finishedAt = Date.now();
          job.phase      = 'done';
        },
        (err) => {
          job.status     = 'error';
          job.error      = err?.message || String(err);
          job.finishedAt = Date.now();
          job.phase      = 'error';
          console.warn(`[${label}:job ${job.id}] failed:`, job.error);
        }
      );
  }

  return { create, get, run, gc, _map: jobs };
}

module.exports = { createJobsCluster };
