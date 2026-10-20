import { STAFF_ROLES } from './constants';

/** Where clicking a notification should navigate to (role-aware), or null. */
export function notificationTarget(n, role) {
  if (!n) return null;
  const tripId = n.trip_id ?? n.data?.tripId ?? n.data?.trip_id;
  const requestId = n.data?.requestId ?? n.data?.request_id ?? n.data?.outpassId;
  if (role === 'student') {
    if (requestId) return `/student/requests/${requestId}`;
    if (tripId) return `/trips/${tripId}`;
    return '/student/requests';
  }
  if (STAFF_ROLES.includes(role)) {
    if (n.type === 'REQUEST_SUBMITTED' && requestId) return `/staff/requests/${requestId}`;
    if (n.type === 'OVERDUE') return '/staff/overdue';
    if (tripId) return `/trips/${tripId}`;
    if (requestId) return `/staff/requests/${requestId}`;
    return null;
  }
  if (role === 'parent') {
    if (tripId) return `/trips/${tripId}`;
    return '/parent';
  }
  return null;
}
