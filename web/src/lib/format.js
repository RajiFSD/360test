import { format, formatDistanceToNowStrict, isValid, parseISO } from 'date-fns';

function toDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : parseISO(String(value));
  return isValid(d) ? d : null;
}

export function formatDateTime(value, fallback = '—') {
  const d = toDate(value);
  return d ? format(d, 'dd MMM yyyy, hh:mm a') : fallback;
}

export function formatDate(value, fallback = '—') {
  const d = toDate(value);
  return d ? format(d, 'dd MMM yyyy') : fallback;
}

export function formatTime(value, fallback = '—') {
  const d = toDate(value);
  return d ? format(d, 'hh:mm a') : fallback;
}

export function formatRelative(value, fallback = '—') {
  const d = toDate(value);
  return d ? formatDistanceToNowStrict(d, { addSuffix: true }) : fallback;
}

/** ISO (UTC) -> value for <input type="datetime-local"> in local time. */
export function isoToLocalInput(value) {
  const d = toDate(value);
  return d ? format(d, "yyyy-MM-dd'T'HH:mm") : '';
}

/** <input type="datetime-local"> value (local) -> ISO UTC string. */
export function localInputToIso(value) {
  if (!value) return null;
  const d = new Date(value);
  return isValid(d) ? d.toISOString() : null;
}

/** yyyy-MM-dd (local) -> ISO start/end of that local day. */
export function dayStartIso(day) {
  if (!day) return undefined;
  const d = new Date(`${day}T00:00:00`);
  return isValid(d) ? d.toISOString() : undefined;
}
export function dayEndIso(day) {
  if (!day) return undefined;
  const d = new Date(`${day}T23:59:59.999`);
  return isValid(d) ? d.toISOString() : undefined;
}

export function todayLocal() {
  return format(new Date(), 'yyyy-MM-dd');
}
export function daysAgoLocal(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return format(d, 'yyyy-MM-dd');
}

export function formatPercent(value, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  const n = Number(value);
  const pct = n <= 1 ? n * 100 : n;
  return `${pct.toFixed(digits)}%`;
}

export function formatNumber(value, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: digits });
}

export function formatMinutes(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  const m = Math.round(Number(value));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

export function formatBattery(value) {
  if (value === null || value === undefined) return '—';
  const n = Number(value);
  return `${Math.round(n <= 1 ? n * 100 : n)}%`;
}

export function formatDistance(meters) {
  if (meters === null || meters === undefined) return '—';
  const m = Number(meters);
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}
