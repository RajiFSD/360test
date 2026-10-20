export const ROLES = ['student', 'warden', 'faculty', 'security', 'parent', 'admin'];
export const STAFF_ROLES = ['warden', 'faculty', 'admin'];

export const ROLE_LABELS = {
  student: 'Student',
  warden: 'Warden',
  faculty: 'Faculty',
  security: 'Security',
  parent: 'Parent',
  admin: 'Admin',
};

export const ROLE_HOME = {
  student: '/student',
  warden: '/staff',
  faculty: '/staff',
  security: '/security/scan',
  parent: '/parent',
  admin: '/admin',
};

export const REASON_CATEGORIES = [
  'HOME_VISIT',
  'MEDICAL',
  'FAMILY_EVENT',
  'ACADEMIC',
  'PERSONAL',
  'SHOPPING',
  'OTHER',
];

export const DESTINATION_TYPES = ['HOME', 'OTHER'];

export const OUTPASS_STATUSES = [
  'PENDING',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
  'ACTIVE',
  'OVERDUE',
  'COMPLETED',
  'EXPIRED',
];

export const TRIP_STATUSES = ['APPROVED', 'ACTIVE', 'OVERDUE', 'COMPLETED', 'CANCELLED'];

export const RISK_LEVELS = ['LOW', 'MEDIUM', 'HIGH'];

export const GEOFENCE_TYPES = ['CAMPUS', 'DESTINATION', 'CUSTOM'];
export const GEOFENCE_SHAPES = ['CIRCLE', 'POLYGON'];

export const REPORT_TYPES = [
  { value: 'outpasses', label: 'Outpasses' },
  { value: 'trips', label: 'Trips' },
  { value: 'gate_logs', label: 'Gate logs' },
];

export function humanize(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Trip statuses where the student QR / consent are relevant. */
export const QR_TRIP_STATUSES = ['APPROVED', 'ACTIVE', 'OVERDUE'];
export const LIVE_TRIP_STATUSES = ['ACTIVE', 'OVERDUE'];

export const TRACKING_DENIED_TEXT = {
  TRIP_NOT_ACTIVE: 'Tracking starts only after you exit through the gate.',
  NO_CONSENT: 'Location consent is not active for this trip.',
  OUTSIDE_TRIP_WINDOW: 'The tracking window for this trip has ended.',
};
