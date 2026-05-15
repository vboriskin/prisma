'use strict';
/* ============================================================
   server/integrations/jobs.js — V18.1 P10 (extracted from server.js)
                                   + V21 Q (audit-2026-05-03 §E R1) persistence

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
 * V21 Q (audit-2026-05-03 §E R1) — опциональная persistence на диск.
 * Если передан `persistDir`, finished jobs (done/error) пишутся в JSON-файлы;
 * при создании cluster'а — load файлов из dir, running-jobs автоматически
 * переходят в status=error с message «server restarted before completion»
 * (running jobs нельзя resume — fetch-work потерян). Это снимает «бесконечный
 * 404 polling» когда сервер перезапустили в процессе работы.
 *
 * @param {object} opts
 * @param {string} [opts.prefix='job']         — job-id prefix (e.g. 'bd', 'pulse')
 * @param {number} [opts.ttlMs=30*60*1000]     — eviction TTL after finishedAt
 * @param {number} [opts.maxCount=50]          — hard ceiling; oldest evicted
 * @param {string} [opts.label='']             — used in console.warn on error
 * @param {string} [opts.persistDir]           — если задан, finished jobs пишутся туда
 * @returns {{create:Function, get:Function, run:Function, gc:Function, _map:Map}}
 */
function createJobsCluster(opts = {}) {
  const prefix     = opts.prefix     || 'job';
  const TTL_MS     = Number.isFinite(opts.ttlMs)   ? opts.ttlMs   : 30 * 60 * 1000;
  const MAX_CNT    = Number.isFinite(opts.maxCount) ? opts.maxCount : 50;
  const label      = opts.label      || prefix;
  const persistDir = opts.persistDir || null;
  const jobs       = new Map();
  let counter = 0;

  // ── Persistence helpers ─────────────────────────────────
  let fs = null, path = null;
  if (persistDir) {
    try { fs   = require('fs'); } catch (_) {}
    try { path = require('path'); } catch (_) {}
    if (fs && path) {
      try { fs.mkdirSync(persistDir, { recursive: true }); } catch (_) {}
    }
  }
  const _file = (id) => (fs && path) ? path.join(persistDir, `${id}.json`) : null;
  function _persist(job) {
    if (!fs || !persistDir) return;
    const f = _file(job.id);
    try { fs.writeFileSync(f, JSON.stringify(job), { mode: 0o600 }); } catch (e) { console.warn(`[${label}:persist] write failed:`, e.message); }
  }
  function _unpersist(id) {
    if (!fs || !persistDir) return;
    try { fs.unlinkSync(_file(id)); } catch (_) {}
  }
  function _loadFromDisk() {
    if (!fs || !persistDir) return;
    let files = [];
    try { files = fs.readdirSync(persistDir).filter(f => f.endsWith('.json')); } catch (_) { return; }
    const now = Date.now();
    for (const f of files) {
      try {
        const raw = fs.readFileSync(path.join(persistDir, f), 'utf8');
        const job = JSON.parse(raw);
        if (!job || !job.id) continue;
        // TTL respected on load — старые удаляем сразу.
        const t = job.finishedAt || job.startedAt || 0;
        if (now - t > TTL_MS) { _unpersist(job.id); continue; }
        // Running jobs from previous run = orphan'ы. Помечаем error чтобы
        // клиент-poller сразу получил definite ответ, а не вечный 404.
        if (job.status === 'running') {
          job.status     = 'error';
          job.error      = 'Server restarted before job finished — please retry.';
          job.finishedAt = now;
          job.phase      = 'error';
          _persist(job);
        }
        jobs.set(job.id, job);
      } catch (_) {
        try { fs.unlinkSync(path.join(persistDir, f)); } catch (_2) {}
      }
    }
  }
  _loadFromDisk();

  function gc() {
    const now = Date.now();
    for (const [id, job] of jobs) {
      const t = job.finishedAt || job.startedAt;
      if (now - t > TTL_MS) { jobs.delete(id); _unpersist(id); }
    }
    if (jobs.size > MAX_CNT) {
      const entries = [...jobs.entries()].sort(
        (a, b) => (a[1].finishedAt || a[1].startedAt) - (b[1].finishedAt || b[1].startedAt)
      );
      const overflow = jobs.size - MAX_CNT;
      for (let i = 0; i < overflow; i++) { jobs.delete(entries[i][0]); _unpersist(entries[i][0]); }
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
    _persist(job); // persist as running — server restart marks orphan as error on reload
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
          _persist(job);
        },
        (err) => {
          job.status     = 'error';
          job.error      = err?.message || String(err);
          job.finishedAt = Date.now();
          job.phase      = 'error';
          _persist(job);
          console.warn(`[${label}:job ${job.id}] failed:`, job.error);
        }
      );
  }

  return { create, get, run, gc, _map: jobs };
}

module.exports = { createJobsCluster };
