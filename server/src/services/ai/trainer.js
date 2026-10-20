/**
 * Train the delay model from ai_trip_samples and persist it as JSON (config.ai.modelPath).
 * Swappable: a Python service only needs to accept the same named features (see features.js).
 */
const fs = require('fs');
const path = require('path');
const db = require('../../db');
const config = require('../../config');
const { buildFeatures, toVector, FEATURE_NAMES } = require('./features');
const { trainLogistic, predictLogistic, trainRidge, predictRidge, auc } = require('./logistic');

/** Mulberry32 – deterministic shuffling so metrics are reproducible. */
function rng(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rowToFeatures(r) {
  return buildFeatures({
    reason_category: r.reason_category,
    destination_type: r.destination_type,
    distance_km: r.distance_km,
    depart_at: r.depart_at,
    expected_return_at: r.expected_return_at,
    past_delay_rate: r.past_delay_rate,
  });
}

function trainFromRows(rows) {
  if (rows.length < 50) throw new Error(`Need at least 50 samples to train, found ${rows.length}`);
  const rand = rng(42);
  const shuffled = rows.map((r) => [rand(), r]).sort((a, b) => a[0] - b[0]).map(([, r]) => r);
  const split = Math.floor(shuffled.length * 0.8);
  const train = shuffled.slice(0, split);
  const test = shuffled.slice(split);

  const Xtr = train.map((r) => toVector(rowToFeatures(r)));
  const ytr = train.map((r) => (r.is_late ? 1 : 0));
  const clf = trainLogistic(Xtr, ytr);
  // Feature means of the training set: explanations are measured against the average trip.
  const means = FEATURE_NAMES.map((_, j) => Xtr.reduce((s, x) => s + x[j], 0) / Xtr.length);

  const lateTrain = train.filter((r) => r.is_late);
  const reg = lateTrain.length >= 20
    ? trainRidge(lateTrain.map((r) => toVector(rowToFeatures(r))), lateTrain.map((r) => Math.log1p(r.delay_minutes)))
    : { weights: new Array(FEATURE_NAMES.length).fill(0), bias: Math.log1p(30) };

  const scores = test.map((r) => predictLogistic(clf, toVector(rowToFeatures(r))));
  const labels = test.map((r) => (r.is_late ? 1 : 0));
  const accuracy = scores.filter((p, i) => (p >= 0.5 ? 1 : 0) === labels[i]).length / test.length;
  const logloss = -scores.reduce((s, p, i) => s + (labels[i] ? Math.log(p + 1e-9) : Math.log(1 - p + 1e-9)), 0) / test.length;
  const lateTest = test.filter((r) => r.is_late);
  const mae = lateTest.length
    ? lateTest.reduce((s, r) => s + Math.abs(Math.expm1(predictRidge(reg, toVector(rowToFeatures(r)))) - r.delay_minutes), 0) / lateTest.length
    : null;

  return {
    version: `logreg-${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '')}`,
    provider: 'node-logreg',
    trained_at: new Date().toISOString(),
    features: FEATURE_NAMES,
    feature_means: means,
    classifier: { weights: clf.weights, bias: clf.bias },
    delay_regressor: { target: 'log1p(delay_minutes)', weights: reg.weights, bias: reg.bias },
    metrics: {
      samples: rows.length,
      train_samples: train.length,
      test_samples: test.length,
      base_late_rate: Number((rows.filter((r) => r.is_late).length / rows.length).toFixed(4)),
      accuracy: Number(accuracy.toFixed(4)),
      auc: Number(auc(scores, labels).toFixed(4)),
      logloss: Number(logloss.toFixed(4)),
      mae_minutes: mae != null ? Number(mae.toFixed(1)) : null,
    },
  };
}

/** Pull completed real trips that aren't yet in ai_trip_samples (continuous learning). */
async function syncSamplesFromTrips() {
  const rows = await db.query(
    `SELECT t.id AS trip_id, o.student_id, o.reason_category, o.destination_type, o.dest_lat, o.dest_lng,
            o.depart_at, o.expected_return_at, o.created_at, o.reviewed_at, COALESCE(t.entry_at, t.returned_at, t.completed_at) AS actual
     FROM trips t JOIN outpass_requests o ON o.id = t.request_id
     LEFT JOIN ai_trip_samples a ON a.source_trip_id = t.id
     WHERE t.status = 'COMPLETED' AND a.id IS NULL AND COALESCE(t.entry_at, t.returned_at, t.completed_at) IS NOT NULL
     ORDER BY t.completed_at`,
  );
  if (!rows.length) return 0;
  const repo = require('../repo');
  const campus = await repo.getCampusFence();
  const { haversine } = require('../../utils/geo');
  const { local } = require('./features');
  for (const r of rows) {
    const prev = await db.one('SELECT COUNT(*) AS n, COALESCE(SUM(is_late),0) AS late FROM ai_trip_samples WHERE student_id = ?', [r.student_id]);
    const pastRate = (Number(prev.late) + 0.75) / (Number(prev.n) + 3);
    const delay = Math.round((new Date(r.actual) - new Date(r.expected_return_at)) / 60000);
    const distKm = campus ? haversine(campus.center_lat, campus.center_lng, Number(r.dest_lat), Number(r.dest_lng)) / 1000 : 0;
    const ret = local(r.expected_return_at);
    await db.query(
      `INSERT IGNORE INTO ai_trip_samples (source_trip_id, student_id, reason_category, destination_type, distance_km, depart_at,
         expected_return_at, actual_return_at, requested_at, approved_at, day_of_week, return_hour, duration_hours, past_delay_rate,
         delay_minutes, is_late) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        r.trip_id, r.student_id, r.reason_category, r.destination_type, distKm, r.depart_at, r.expected_return_at, r.actual,
        r.created_at, r.reviewed_at, ret.getUTCDay(), ret.getUTCHours(),
        (new Date(r.expected_return_at) - new Date(r.depart_at)) / 3_600_000, pastRate, Math.max(0, delay), delay > 15 ? 1 : 0,
      ],
    );
  }
  return rows.length;
}

async function retrain() {
  const synced = await syncSamplesFromTrips();
  const rows = await db.query(
    'SELECT reason_category, destination_type, distance_km, depart_at, expected_return_at, past_delay_rate, delay_minutes, is_late FROM ai_trip_samples',
  );
  const model = trainFromRows(rows);
  model.metrics.synced_new_samples = synced;
  fs.mkdirSync(path.dirname(config.ai.modelPath), { recursive: true });
  fs.writeFileSync(config.ai.modelPath, JSON.stringify(model, null, 2));
  require('./predictor').reload();
  return model;
}

module.exports = { trainFromRows, retrain, syncSamplesFromTrips };
