/**
 * Pure geofence state machine, evaluated server-side on every location ping.
 *
 * state: { left_campus_at, reached_destination_at, returned_at, dest_streak, campus_streak }
 * ping:  { lat, lng, accuracy, recorded_at }
 * ctx:   { campus, destination, debounce = 2, maxAccuracy = 100 }  — campus may be one fence or an array
 *        (e.g. college + off-site hostel): outside ALL of them = left, inside ANY of them = returned.
 *
 * Rules
 * - Pings with accuracy >= maxAccuracy are ignored entirely (no streak change).
 * - LEFT_CAMPUS: first accurate ping outside the campus fence.
 * - REACHED_DESTINATION: `debounce` consecutive accurate pings inside the destination fence (first time only).
 * - RETURNED_CAMPUS: after leaving campus, `debounce` consecutive accurate pings inside campus (first time only).
 * Each event fires at most once because its timestamp is persisted in state.
 */
const { isInsideFence } = require('../utils/geo');

function evaluatePing(state, ping, ctx) {
  const debounce = ctx.debounce ?? 2;
  const maxAccuracy = ctx.maxAccuracy ?? 100;
  const next = { ...state, dest_streak: state.dest_streak || 0, campus_streak: state.campus_streak || 0 };
  const events = [];
  const at = ping.recorded_at instanceof Date ? ping.recorded_at : new Date(ping.recorded_at);

  if (ping.accuracy != null && Number(ping.accuracy) >= maxAccuracy) {
    return { state: next, events, ignored: true };
  }

  const campuses = [].concat(ctx.campus || []);
  const inCampus = campuses.some((f) => isInsideFence(ping.lat, ping.lng, f));
  const inDest = ctx.destination ? isInsideFence(ping.lat, ping.lng, ctx.destination) : false;

  if (!next.left_campus_at && campuses.length && !inCampus) {
    next.left_campus_at = at;
    events.push({ type: 'LEFT_CAMPUS', at });
  }

  if (!next.reached_destination_at && ctx.destination) {
    next.dest_streak = inDest ? next.dest_streak + 1 : 0;
    if (next.dest_streak >= debounce) {
      next.reached_destination_at = at;
      events.push({ type: 'REACHED_DESTINATION', at });
    }
  }

  if (next.left_campus_at && !next.returned_at && campuses.length) {
    next.campus_streak = inCampus ? next.campus_streak + 1 : 0;
    if (next.campus_streak >= debounce) {
      next.returned_at = at;
      events.push({ type: 'RETURNED_CAMPUS', at });
    }
  }

  return { state: next, events, ignored: false };
}

/** Pick the next ping interval (seconds) from speed + battery. */
function nextIntervalSec({ speed, battery }, s) {
  if (battery != null && Number(battery) < 0.2) return s.tracking_interval_low_battery_sec;
  if (speed != null && Number(speed) > 1.5) return s.tracking_interval_moving_sec;
  return s.tracking_interval_idle_sec;
}

module.exports = { evaluatePing, nextIntervalSec };
