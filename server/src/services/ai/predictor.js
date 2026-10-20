/**
 * Prediction providers behind one interface:
 *   provider.predict(features: Record<string, number>, raw) -> { delay_probability, delay_if_late_min, contributions }
 *   provider.info() -> { version, provider, trained_at, metrics }
 *
 * AI_PROVIDER=node  -> NodeModelProvider (JSON weights trained by scripts/retrain.js)
 * AI_PROVIDER=http  -> HttpModelProvider (POST {features} to `${AI_SERVICE_URL}/predict`, e.g. a Python/FastAPI model)
 */
const fs = require('fs');
const config = require('../../config');
const { toVector, FEATURE_NAMES } = require('./features');
const { sigmoid } = require('./logistic');

/** Transparent fallback weights used before the first training run. */
const FALLBACK_MODEL = {
  version: 'fallback-weighted-v1',
  provider: 'node-weighted',
  trained_at: null,
  features: FEATURE_NAMES,
  classifier: {
    bias: -2.2,
    weights: FEATURE_NAMES.map((n) => ({
      log_distance: 1.4, log_duration: 0.6, return_late_evening: 0.7, return_early_morning: 0.4, return_sunday: 0.8,
      return_monday: 0.3, depart_friday: 0.2, depart_evening: 0.1, dest_home: 0.1, past_delay_rate: 2.6,
      cat_family_event: 0.5, cat_home_visit: 0.3, cat_personal: 0.2, cat_shopping: -0.2, cat_academic: -0.5, cat_medical: -0.1,
    }[n] ?? 0)),
  },
  delay_regressor: { bias: Math.log1p(30), weights: FEATURE_NAMES.map((n) => (n === 'log_distance' ? 0.8 : 0)) },
  feature_means: FEATURE_NAMES.map((n) => ({ log_distance: 0.5, log_duration: 0.4, past_delay_rate: 0.25, dest_home: 0.4 }[n] ?? 0.1)),
  metrics: { base_late_rate: 0.25 },
};

class NodeModelProvider {
  constructor(modelPath) {
    this.modelPath = modelPath;
    this.load();
  }
  load() {
    try {
      this.mtime = fs.statSync(this.modelPath).mtimeMs;
      this.model = JSON.parse(fs.readFileSync(this.modelPath, 'utf8'));
      // Feature set changed since training -> retrain needed; use fallback meanwhile.
      if (JSON.stringify(this.model.features) !== JSON.stringify(FEATURE_NAMES)) this.model = FALLBACK_MODEL;
    } catch {
      this.model = FALLBACK_MODEL;
    }
  }
  /** Pick up a model retrained by another process (scripts/retrain.js). */
  refresh() {
    try {
      if (fs.statSync(this.modelPath).mtimeMs !== this.mtime) this.load();
    } catch {
      /* no model file yet: keep current */
    }
  }
  info() {
    this.refresh();
    const { version, provider, trained_at, metrics } = this.model;
    return { version, provider, trained_at, metrics };
  }
  async predict(features) {
    this.refresh();
    const x = toVector(features);
    const { classifier, delay_regressor } = this.model;
    const z = x.reduce((s, v, i) => s + v * classifier.weights[i], classifier.bias);
    const p = sigmoid(z);
    const logDelay = x.reduce((s, v, i) => s + v * delay_regressor.weights[i], delay_regressor.bias);
    const means = this.model.feature_means || FEATURE_NAMES.map(() => 0);
    // impact = change in log-odds versus an average trip (positive = raises delay risk)
    const contributions = FEATURE_NAMES.map((f, i) => ({ feature: f, value: x[i], impact: Number(((x[i] - means[i]) * classifier.weights[i]).toFixed(4)) }));
    const baseRate = this.model.metrics?.base_late_rate ?? 0.25;
    return { delay_probability: p, delay_if_late_min: Math.max(5, Math.expm1(logDelay)), contributions, base_rate: baseRate };
  }
}

class HttpModelProvider {
  constructor(baseUrl) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.meta = { version: 'remote', provider: 'http', trained_at: null, metrics: null };
  }
  info() {
    return this.meta;
  }
  async predict(features, raw) {
    const res = await fetch(`${this.baseUrl}/predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ features, raw }),
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) throw new Error(`AI service responded ${res.status}`);
    const json = await res.json();
    if (json.version) this.meta.version = json.version;
    return {
      delay_probability: Number(json.delay_probability),
      delay_if_late_min: Number(json.delay_if_late_min ?? json.expected_delay_min ?? 30),
      contributions: json.contributions || [],
      base_rate: Number(json.base_rate ?? 0.25),
    };
  }
}

let provider;
function getProvider() {
  if (!provider) provider = config.ai.provider === 'http' ? new HttpModelProvider(config.ai.serviceUrl) : new NodeModelProvider(config.ai.modelPath);
  return provider;
}

function reload() {
  if (provider instanceof NodeModelProvider) provider.load();
}

module.exports = { getProvider, reload, NodeModelProvider, HttpModelProvider, FALLBACK_MODEL };
