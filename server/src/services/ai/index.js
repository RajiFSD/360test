/**
 * Public AI API used by routes: predictions for outpass requests + insights for staff.
 */
const db = require('../../db');
const repo = require('../repo');
const { haversine } = require('../../utils/geo');
const { buildFeatures, describe, CATEGORIES } = require('./features');
const { getProvider, NodeModelProvider, FALLBACK_MODEL } = require('./predictor');

/** Smoothed late-return rate from training history + real completed trips. */
async function pastDelayRate(studentId) {
  if (!studentId) return 0.25;
  const s = await db.one('SELECT COUNT(*) AS n, COALESCE(SUM(is_late),0) AS late FROM ai_trip_samples WHERE student_id = ?', [studentId]);
  const live = await db.one(
    `SELECT COUNT(*) AS n,
            COALESCE(SUM(COALESCE(t.entry_at, t.returned_at, t.completed_at) > DATE_ADD(o.expected_return_at, INTERVAL 15 MINUTE)), 0) AS late
     FROM trips t JOIN outpass_requests o ON o.id = t.request_id
     LEFT JOIN ai_trip_samples a ON a.source_trip_id = t.id
     WHERE o.student_id = ? AND t.status = 'COMPLETED' AND a.id IS NULL`,
    [studentId],
  );
  const n = Number(s.n) + Number(live.n);
  const late = Number(s.late) + Number(live.late);
  return (late + 0.75) / (n + 3); // Beta(0.75, 2.25) prior ≈ 25% base rate
}

const riskLevel = (score) => (score >= 65 ? 'HIGH' : score >= 35 ? 'MEDIUM' : 'LOW');

/**
 * input: { student_id, reason_category, destination_type, dest_lat, dest_lng, depart_at, expected_return_at }
 */
async function predict(input) {
  const campus = await repo.getCampusFence();
  const distanceKm = campus ? haversine(campus.center_lat, campus.center_lng, Number(input.dest_lat), Number(input.dest_lng)) / 1000 : 0;
  const past = await pastDelayRate(input.student_id);
  const raw = { ...input, distance_km: distanceKm, past_delay_rate: past };
  const features = buildFeatures(raw);

  let result;
  let provider = getProvider();
  try {
    result = await provider.predict(features, raw);
  } catch (err) {
    // Remote model down -> degrade gracefully to local transparent model.
    console.warn('[ai] provider failed, using fallback:', err.message);
    provider = Object.assign(Object.create(NodeModelProvider.prototype), { model: FALLBACK_MODEL });
    result = await provider.predict(features, raw);
  }

  const p = Math.min(0.999, Math.max(0.001, result.delay_probability));
  // Relative risk: 50 = an average trip (p equals the historical late rate), → 100 as p ≫ base rate.
  const base = Math.min(0.9, Math.max(0.01, result.base_rate ?? 0.25));
  const riskScore = Math.round((100 * p) / (p + base));
  const reasons = result.contributions
    .filter((c) => c.value > 0 && c.impact > 0.1)
    .sort((a, b) => b.impact - a.impact)
    .slice(0, 4)
    .map((c) => describe(c.feature, c.feature === 'past_delay_rate' ? past : c.value, raw));
  if (!reasons.length) reasons.push(riskScore < 35 ? 'No significant risk factors' : 'Combination of minor factors');

  return {
    delay_probability: Number(p.toFixed(4)),
    expected_delay_min: Math.round(p * result.delay_if_late_min),
    delay_if_late_min: Math.round(result.delay_if_late_min),
    risk_score: riskScore,
    risk_level: riskLevel(riskScore),
    base_late_rate: Number(base.toFixed(3)),
    reasons,
    contributions: result.contributions.filter((c) => c.value !== 0),
    distance_km: Number(distanceKm.toFixed(1)),
    past_delay_rate: Number(past.toFixed(3)),
    model_version: provider.info().version,
  };
}

async function insights() {
  // Peak request hours/days in campus local time (IST, +05:30).
  const peakHours = await db.query(
    `SELECT HOUR(DATE_ADD(created_at, INTERVAL 330 MINUTE)) AS hour, COUNT(*) AS count FROM outpass_requests GROUP BY hour ORDER BY hour`,
  );
  const peakDays = await db.query(
    `SELECT DAYOFWEEK(DATE_ADD(created_at, INTERVAL 330 MINUTE)) AS dow, COUNT(*) AS count FROM outpass_requests GROUP BY dow ORDER BY dow`,
  );
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  // Derived table: MariaDB doesn't allow aggregate aliases inside ORDER BY expressions.
  const late = await db.query(
    `SELECT * FROM (
       SELECT s.id AS student_id, s.name, s.roll_no, COUNT(*) AS trips,
              SUM(COALESCE(t.entry_at, t.completed_at) > DATE_ADD(o.expected_return_at, INTERVAL 15 MINUTE)) AS late_trips,
              AVG(GREATEST(0, TIMESTAMPDIFF(MINUTE, o.expected_return_at, COALESCE(t.entry_at, t.completed_at)))) AS avg_delay_min
       FROM trips t JOIN outpass_requests o ON o.id = t.request_id JOIN users s ON s.id = o.student_id
       WHERE t.status = 'COMPLETED'
       GROUP BY s.id, s.name, s.roll_no
     ) x
     WHERE x.trips >= 3 AND x.late_trips > 0
     ORDER BY x.late_trips / x.trips DESC, x.late_trips DESC LIMIT 15`,
  );
  const approval = await db.one(
    `SELECT AVG(TIMESTAMPDIFF(SECOND, created_at, reviewed_at)) / 60 AS avg_min FROM outpass_requests WHERE reviewed_at IS NOT NULL`,
  );
  const byCat = await db.query(
    `SELECT o.reason_category AS category, COUNT(*) AS count,
            AVG(COALESCE(t.entry_at, t.completed_at) > DATE_ADD(o.expected_return_at, INTERVAL 15 MINUTE)) AS late_rate
     FROM trips t JOIN outpass_requests o ON o.id = t.request_id WHERE t.status = 'COMPLETED' GROUP BY o.reason_category`,
  );
  const catMap = Object.fromEntries(byCat.map((r) => [r.category, r]));
  return {
    peak_hours: Array.from({ length: 24 }, (_, h) => ({ hour: h, count: Number(peakHours.find((r) => r.hour === h)?.count || 0) })),
    peak_days: dayNames.map((day, i) => ({ day, count: Number(peakDays.find((r) => r.dow === i + 1)?.count || 0) })),
    frequent_late_returners: late.map((r) => ({
      student_id: r.student_id,
      name: r.name,
      roll_no: r.roll_no,
      trips: Number(r.trips),
      late_trips: Number(r.late_trips),
      late_rate: Number((Number(r.late_trips) / Number(r.trips)).toFixed(3)),
      avg_delay_min: Math.round(Number(r.avg_delay_min || 0)),
    })),
    avg_approval_minutes: approval?.avg_min != null ? Math.round(Number(approval.avg_min)) : null,
    late_rate_by_category: CATEGORIES.map((c) => ({
      category: c,
      count: Number(catMap[c]?.count || 0),
      late_rate: Number(Number(catMap[c]?.late_rate || 0).toFixed(3)),
    })),
    model: getProvider().info(),
  };
}

module.exports = { predict, insights, pastDelayRate, riskLevel };
