#!/usr/bin/env node
/**
 * Retrain the delay model.
 *  1. Copies newly COMPLETED real trips into ai_trip_samples (continuous learning)
 *  2. Trains logistic regression (late > 15 min) + ridge regression (log delay minutes) with an 80/20 split
 *  3. Writes models/delay-model.json, which the API hot-reloads (POST /api/ai/retrain does the same in-process)
 *
 * To swap in a Python model: export the samples (SELECT * FROM ai_trip_samples), train anywhere, serve
 * POST /predict { features, raw } -> { delay_probability, delay_if_late_min, contributions?, version? }
 * and set AI_PROVIDER=http AI_SERVICE_URL=http://host:port.
 */
const db = require('../src/db');
const config = require('../src/config');
const { retrain } = require('../src/services/ai/trainer');

retrain()
  .then((model) => {
    console.log(`Model ${model.version} written to ${config.ai.modelPath}`);
    console.table(model.metrics);
    const top = model.features
      .map((f, i) => ({ feature: f, weight: Number(model.classifier.weights[i].toFixed(3)) }))
      .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))
      .slice(0, 8);
    console.log('Most influential features (logit weights):');
    console.table(top);
  })
  .catch((err) => {
    console.error('Retrain failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => db.close());
