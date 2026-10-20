const cron = require('node-cron');
const { runOverdueCheck } = require('./overdue.job');
const { runSignalLostCheck, runAutoComplete, runExpiry, runPingRetention } = require('./monitor.jobs');

const running = new Set();

/** Run a job, skipping if the previous run is still in progress. */
function guarded(name, fn) {
  return async () => {
    if (running.has(name)) return;
    running.add(name);
    try {
      const result = await fn();
      if (result && Object.values(result).some((v) => (Array.isArray(v) ? v.length : v))) {
        console.log(`[job:${name}]`, JSON.stringify(result));
      }
    } catch (err) {
      console.error(`[job:${name}] failed:`, err.message);
    } finally {
      running.delete(name);
    }
  };
}

function startJobs() {
  const tasks = [
    cron.schedule('*/5 * * * *', guarded('overdue', () => runOverdueCheck())),
    cron.schedule('*/2 * * * *', guarded('signal-lost', () => runSignalLostCheck())),
    cron.schedule('*/5 * * * *', guarded('auto-complete', () => runAutoComplete())),
    cron.schedule('*/10 * * * *', guarded('expiry', () => runExpiry())),
    cron.schedule('30 3 * * *', guarded('ping-retention', () => runPingRetention())),
  ];
  console.log('[jobs] scheduled: overdue(5m), signal-lost(2m), auto-complete(5m), expiry(10m), ping-retention(daily 03:30)');
  return () => tasks.forEach((t) => t.stop());
}

module.exports = { startJobs };
