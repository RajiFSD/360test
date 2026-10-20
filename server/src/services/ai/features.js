/**
 * Feature engineering for the delay model. Shared by training, inference and any external
 * (e.g. Python) provider, which receives the same named feature object.
 */
const CATEGORIES = ['HOME_VISIT', 'MEDICAL', 'FAMILY_EVENT', 'ACADEMIC', 'PERSONAL', 'SHOPPING', 'OTHER'];

// Local wall-clock (campus timezone) is what drives behaviour, not UTC.
const TZ_OFFSET_MIN = 330; // Asia/Kolkata
const local = (d) => new Date(new Date(d).getTime() + TZ_OFFSET_MIN * 60_000);

/**
 * Raw inputs -> named numeric features.
 * input: { reason_category, destination_type, distance_km, depart_at, expected_return_at, past_delay_rate }
 */
function buildFeatures(input) {
  const depart = local(input.depart_at);
  const ret = local(input.expected_return_at);
  const returnDow = ret.getUTCDay(); // 0 = Sunday
  const returnHour = ret.getUTCHours() + ret.getUTCMinutes() / 60;
  const departHour = depart.getUTCHours();
  const durationH = Math.max(0.25, (new Date(input.expected_return_at) - new Date(input.depart_at)) / 3_600_000);
  const distance = Math.max(0, Number(input.distance_km) || 0);

  const f = {
    log_distance: Math.log1p(distance) / Math.log1p(500),
    log_duration: Math.log1p(durationH) / Math.log1p(24 * 7),
    return_late_evening: returnHour >= 20 ? 1 : 0,
    return_early_morning: returnHour < 8 ? 1 : 0,
    return_sunday: returnDow === 0 ? 1 : 0,
    return_monday: returnDow === 1 ? 1 : 0,
    depart_friday: depart.getUTCDay() === 5 ? 1 : 0,
    depart_evening: departHour >= 17 ? 1 : 0,
    dest_home: input.destination_type === 'HOME' ? 1 : 0,
    past_delay_rate: Math.min(1, Math.max(0, Number(input.past_delay_rate) || 0)),
  };
  for (const c of CATEGORIES) f[`cat_${c.toLowerCase()}`] = input.reason_category === c ? 1 : 0;
  return f;
}

const FEATURE_NAMES = Object.keys(
  buildFeatures({ reason_category: 'OTHER', destination_type: 'HOME', distance_km: 1, depart_at: new Date(), expected_return_at: new Date(Date.now() + 3600e3), past_delay_rate: 0 }),
);

const toVector = (f) => FEATURE_NAMES.map((n) => f[n] ?? 0);

const LABELS = {
  log_distance: (v, raw) => `Long-distance destination (${Math.round(raw.distance_km)} km)`,
  log_duration: () => 'Long trip duration',
  return_late_evening: () => 'Expected return late in the evening (after 8 PM)',
  return_early_morning: () => 'Expected return early morning (before 8 AM)',
  return_sunday: () => 'Return on a Sunday (historically busy, late returns)',
  return_monday: () => 'Return on a Monday morning',
  depart_friday: () => 'Friday departure (weekend trip)',
  depart_evening: () => 'Evening departure',
  dest_home: () => 'Home visit',
  past_delay_rate: (v) => `Past late-return rate ${Math.round(v * 100)}%`,
  cat_home_visit: () => 'Reason: home visit',
  cat_medical: () => 'Reason: medical',
  cat_family_event: () => 'Reason: family event',
  cat_academic: () => 'Reason: academic',
  cat_personal: () => 'Reason: personal',
  cat_shopping: () => 'Reason: shopping',
  cat_other: () => 'Reason: other',
};

function describe(feature, value, raw) {
  const fn = LABELS[feature];
  return fn ? fn(value, raw) : feature;
}

module.exports = { buildFeatures, toVector, FEATURE_NAMES, CATEGORIES, describe, local };
