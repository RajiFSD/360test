const db = require('../db');

/** Known settings with defaults and types. Only these keys can be stored. */
const DEFAULTS = {
  overdue_grace_min: { value: 15, type: 'int', public: true, help: 'Minutes after expected return before a trip is marked OVERDUE' },
  escalation_student_min: { value: 15, type: 'int', help: 'Minutes late: notify student (level 1)' },
  escalation_warden_min: { value: 30, type: 'int', help: 'Minutes late: notify warden (level 2)' },
  escalation_parent_min: { value: 60, type: 'int', help: 'Minutes late: notify parents + security (level 3)' },
  destination_radius_m: { value: 200, type: 'int', public: true, help: 'Default destination geofence radius' },
  return_autocomplete_grace_min: { value: 30, type: 'int', help: 'Auto-complete a returned trip if no ENTRY scan within this time' },
  signal_lost_min: { value: 10, type: 'int', help: 'Raise a signal-lost alert when no ping for this long' },
  ping_retention_days: { value: 30, type: 'int', help: 'Location pings older than this are deleted' },
  geofence_debounce_count: { value: 2, type: 'int', help: 'Consecutive pings inside a fence required to trigger' },
  geofence_max_accuracy_m: { value: 100, type: 'int', public: true, help: 'Pings less accurate than this are ignored by the geofence engine' },
  tracking_interval_moving_sec: { value: 30, type: 'int', public: true, help: 'Ping interval while moving' },
  tracking_interval_idle_sec: { value: 60, type: 'int', public: true, help: 'Ping interval while stationary' },
  tracking_interval_low_battery_sec: { value: 120, type: 'int', public: true, help: 'Ping interval when battery < 20%' },
  tracking_overrun_max_min: { value: 720, type: 'int', help: 'Tracking stays allowed this long past expected return (overdue trips)' },
  qr_exit_early_min: { value: 60, type: 'int', help: 'How early before departure the exit scan is accepted' },
  sms_enabled: { value: false, type: 'bool', help: 'Send SMS for high-priority alerts (overdue, returned)' },
  daily_pass_max_days: { value: 90, type: 'int', public: true, help: 'Longest date range a daily pass may cover' },
  daily_pass_max_per_student: { value: 1, type: 'int', public: true, help: 'Daily passes a student may have pending/active at once' },
  daily_pass_qr_grace_min: { value: 30, type: 'int', help: "Daily pass: minutes before/after the day's window the QR is accepted" },
  daily_pass_tracking_grace_min: { value: 120, type: 'int', help: "Daily pass: tracking stays allowed this long after the day's return time" },
};

let cache = null;
let cacheAt = 0;
const TTL_MS = 30_000;

function cast(type, raw) {
  if (type === 'int') return Number.parseInt(raw, 10);
  if (type === 'bool') return raw === true || raw === 'true' || raw === '1' || raw === 1;
  return raw;
}

async function getAll({ fresh = false } = {}) {
  if (!fresh && cache && Date.now() - cacheAt < TTL_MS) return cache;
  const out = {};
  for (const [k, d] of Object.entries(DEFAULTS)) out[k] = d.value;
  try {
    const rows = await db.query('SELECT `key`, `value` FROM settings');
    for (const r of rows) if (DEFAULTS[r.key]) out[r.key] = cast(DEFAULTS[r.key].type, r.value);
  } catch (err) {
    if (err.code !== 'ER_NO_SUCH_TABLE') throw err;
  }
  cache = out;
  cacheAt = Date.now();
  return out;
}

async function get(key) {
  return (await getAll())[key];
}

async function update(values) {
  const unknown = Object.keys(values).filter((k) => !DEFAULTS[k]);
  if (unknown.length) {
    const { badRequest } = require('../utils/errors');
    throw badRequest(`Unknown setting(s): ${unknown.join(', ')}`);
  }
  for (const [k, v] of Object.entries(values)) {
    const typed = cast(DEFAULTS[k].type, v);
    if (DEFAULTS[k].type === 'int' && (!Number.isFinite(typed) || typed < 0)) {
      const { badRequest } = require('../utils/errors');
      throw badRequest(`Setting ${k} must be a non-negative integer`);
    }
    await db.query(
      'INSERT INTO settings (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)',
      [k, String(typed)],
    );
  }
  return getAll({ fresh: true });
}

async function getPublic() {
  const all = await getAll();
  return Object.fromEntries(Object.entries(DEFAULTS).filter(([, d]) => d.public).map(([k]) => [k, all[k]]));
}

function clearCache() {
  cache = null;
}

module.exports = { DEFAULTS, getAll, get, update, getPublic, clearCache };
