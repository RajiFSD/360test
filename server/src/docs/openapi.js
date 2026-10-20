/**
 * OpenAPI 3 document served at /api/docs. Human-readable companion: docs/API.md.
 */
const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const arr = (schema) => ({ type: 'array', items: schema });
const envelope = (schema) => ({ type: 'object', properties: { data: schema, meta: ref('PageMeta') } });
const str = { type: 'string' };
const num = { type: 'number' };
const int = { type: 'integer' };
const bool = { type: 'boolean' };
const date = { type: 'string', format: 'date-time' };
const obj = (properties, required) => ({ type: 'object', properties, ...(required ? { required } : {}) });

const schemas = {
  PageMeta: obj({ page: int, pageSize: int, total: int }),
  Error: obj({ error: obj({ code: str, message: str, details: {} }) }),
  User: obj({
    id: int, role: { type: 'string', enum: ['student', 'warden', 'faculty', 'security', 'parent', 'admin'] }, name: str, email: str,
    phone: str, roll_no: str, department_id: int, department: str, hostel_id: int, hostel: str, photo_url: str, is_active: bool, created_at: date,
  }),
  StudentSummary: obj({ id: int, name: str, roll_no: str, photo_url: str, phone: str, department: str, hostel: str }),
  Location: obj({ lat: num, lng: num, accuracy: num, speed: num, battery: num, recorded_at: date }),
  Trip: obj({
    id: int, request_id: int, status: { type: 'string', enum: ['APPROVED', 'ACTIVE', 'OVERDUE', 'COMPLETED', 'CANCELLED'] },
    exit_at: date, entry_at: date, left_campus_at: date, reached_destination_at: date, returned_at: date, completed_at: date,
    escalation_level: int, last_ping_at: date, tracking_active: bool, student: ref('StudentSummary'), dest_address: str,
    dest_lat: num, dest_lng: num, depart_at: date, expected_return_at: date, last_location: ref('Location'),
  }),
  Outpass: obj({
    id: int, student_id: int, student: ref('StudentSummary'), reason: str,
    reason_category: { type: 'string', enum: ['HOME_VISIT', 'MEDICAL', 'FAMILY_EVENT', 'ACADEMIC', 'PERSONAL', 'SHOPPING', 'OTHER'] },
    destination_type: { type: 'string', enum: ['HOME', 'OTHER'] }, dest_address: str, dest_lat: num, dest_lng: num,
    depart_at: date, expected_return_at: date, attachment_url: str,
    status: { type: 'string', enum: ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'ACTIVE', 'OVERDUE', 'COMPLETED', 'EXPIRED'] },
    reviewed_by: int, reviewed_at: date, remarks: str, risk_score: int, risk_level: str, risk_reasons: arr(str),
    predicted_delay_min: int, delay_probability: num, created_at: date, trip: ref('Trip'),
  }),
  OutpassCreate: obj(
    { reason: str, reason_category: str, destination_type: str, dest_address: str, dest_lat: num, dest_lng: num, depart_at: date, expected_return_at: date, attachment_url: str },
    ['reason', 'reason_category', 'destination_type', 'dest_address', 'dest_lat', 'dest_lng', 'depart_at', 'expected_return_at'],
  ),
  Ping: obj({ lat: num, lng: num, accuracy: num, speed: num, battery: num, timestamp: date }, ['lat', 'lng']),
  Consent: obj({ id: int, trip_id: int, student_id: int, scope: str, granted_at: date, revoked_at: date, revoke_reason: str, active: bool }),
  Geofence: obj({
    id: int, name: str, type: { type: 'string', enum: ['CAMPUS', 'DESTINATION', 'CUSTOM'] }, shape: { type: 'string', enum: ['CIRCLE', 'POLYGON'] },
    center_lat: num, center_lng: num, radius_m: int, polygon: arr(arr(num)), trip_id: int, is_active: bool,
  }),
  Notification: obj({ id: int, type: str, title: str, body: str, trip_id: int, data: { type: 'object' }, read_at: date, created_at: date }),
  GateResult: obj({ action: { type: 'string', enum: ['EXIT', 'ENTRY'] }, gate_log: { type: 'object' }, student: ref('StudentSummary'), trip: ref('Trip'), outpass: ref('Outpass') }),
  Prediction: obj({
    delay_probability: num, expected_delay_min: int, risk_score: int, risk_level: str, reasons: arr(str),
    contributions: arr(obj({ feature: str, value: num, impact: num })), model_version: str,
  }),
};

// [method, path, tag, summary, roles, requestSchema?, responseSchema?, params?]
const routes = [
  ['post', '/auth/login', 'Auth', 'Login with email or roll number', 'public', obj({ identifier: str, password: str }, ['identifier', 'password']), obj({ accessToken: str, refreshToken: str, user: ref('User') })],
  ['post', '/auth/refresh', 'Auth', 'Rotate refresh token', 'public', obj({ refreshToken: str }, ['refreshToken']), obj({ accessToken: str, refreshToken: str })],
  ['post', '/auth/logout', 'Auth', 'Revoke the session family', 'public', obj({ refreshToken: str })],
  ['get', '/auth/register/options', 'Registration', 'Departments, hostels and relations for the sign-up form', 'public'],
  ['post', '/auth/register', 'Registration', 'Self-register a student or parent (pending admin approval)', 'public', obj({ role: { type: 'string', enum: ['student', 'parent'] }, name: str, email: str, phone: str, roll_no: str, department_id: int, hostel_id: int, children: arr(obj({ roll_no: str, relation: { type: 'string', enum: ['Father', 'Mother', 'Guardian'] } })), password: str, confirm_password: str }, ['role', 'name', 'email', 'phone', 'password', 'confirm_password']), obj({ ok: bool, status: str, message: str })],
  ['get', '/auth/me', 'Auth', 'Current user', 'any', null, ref('User')],
  ['put', '/auth/me', 'Auth', 'Update own profile', 'any', obj({ name: str, phone: str, photo_url: str }), ref('User')],
  ['post', '/auth/change-password', 'Auth', 'Change password', 'any', obj({ currentPassword: str, newPassword: str })],
  ['put', '/auth/push-token', 'Auth', 'Register Expo push token', 'any', obj({ pushToken: str })],
  ['get', '/users', 'Users', 'List users (staff: students only)', 'admin, warden, faculty, security', null, arr(ref('User')), ['role', 'q', 'hostel_id', 'department_id', 'is_active', 'page', 'pageSize']],
  ['post', '/users', 'Users', 'Create user', 'admin', ref('User'), ref('User')],
  ['post', '/users/import', 'Users', 'Bulk import CSV (multipart field "file")', 'admin', null, obj({ created: int, skipped: int, errors: arr({ type: 'object' }) })],
  ['get', '/users/{id}', 'Users', 'Get user', 'scoped', null, ref('User')],
  ['put', '/users/{id}', 'Users', 'Update user', 'admin', ref('User'), ref('User')],
  ['delete', '/users/{id}', 'Users', 'Deactivate user', 'admin'],
  ['get', '/users/{id}/history', 'Users', 'Student history + stats', 'staff', null, { type: 'object' }],
  ['get', '/parent/students', 'Parent', 'Linked students with current trip', 'parent'],
  ['post', '/outpasses', 'Outpasses', 'Request an outpass (AI risk computed)', 'student', ref('OutpassCreate'), ref('Outpass')],
  ['get', '/outpasses', 'Outpasses', 'List (scoped by role)', 'student, parent, staff', null, arr(ref('Outpass')), ['status', 'student_id', 'q', 'from', 'to', 'risk_level', 'page', 'pageSize']],
  ['get', '/outpasses/{id}', 'Outpasses', 'Detail with gate logs and events', 'scoped', null, ref('Outpass')],
  ['post', '/outpasses/{id}/cancel', 'Outpasses', 'Cancel own pending/unused outpass', 'student', null, ref('Outpass')],
  ['post', '/outpasses/{id}/approve', 'Outpasses', 'Approve (creates trip + QR + destination geofence)', 'staff', obj({ remarks: str }), ref('Outpass')],
  ['post', '/outpasses/{id}/reject', 'Outpasses', 'Reject with remarks', 'staff', obj({ remarks: str }, ['remarks']), ref('Outpass')],
  ['post', '/outpasses/bulk-approve', 'Outpasses', 'Bulk approve', 'staff', obj({ ids: arr(int), remarks: str }, ['ids'])],
  ['get', '/trips', 'Trips', 'List trips (scoped)', 'any', null, arr(ref('Trip')), ['status', 'student_id', 'page']],
  ['get', '/trips/live', 'Trips', 'Active consented trips with last location', 'staff', null, arr(ref('Trip'))],
  ['get', '/trips/overdue', 'Trips', 'Overdue trips with parents', 'staff', null, arr(ref('Trip'))],
  ['get', '/trips/{id}', 'Trips', 'Trip detail', 'scoped', null, ref('Trip')],
  ['get', '/trips/{id}/qr', 'Trips', 'Signed QR token for the gate', 'student (owner)', null, obj({ token: str, expires_at: date })],
  ['get', '/trips/{id}/locations', 'Tracking', 'Location history (parents: only while consented)', 'scoped', null, arr(ref('Location')), ['since', 'limit']],
  ['post', '/trips/{id}/location', 'Tracking', 'Submit ping(s); server enforces status+consent+window', 'student (owner)', { oneOf: [ref('Ping'), obj({ pings: arr(ref('Ping')) })] }, obj({ accepted: int, events: arr(str), next_interval_sec: int })],
  ['get', '/trips/{id}/consent', 'Tracking', 'Current consent + history', 'owner, staff', null, obj({ current: ref('Consent'), history: arr(ref('Consent')) })],
  ['post', '/trips/{id}/consent', 'Tracking', 'Grant consent for this trip', 'student (owner)', obj({ accept: bool, scope: str }, ['accept']), ref('Consent')],
  ['delete', '/trips/{id}/consent', 'Tracking', 'Revoke consent (stops tracking)', 'student (owner)', null, ref('Consent')],
  ['post', '/trips/{id}/checkin', 'Tracking', '"I\'ve reached" campus check-in (geofence validated)', 'student (owner)', obj({ lat: num, lng: num, accuracy: num }, ['lat', 'lng']), ref('Trip')],
  ['post', '/trips/{id}/notify', 'Trips', 'One-tap notify student/parent', 'staff', obj({ target: { type: 'string', enum: ['student', 'parent', 'both'] }, message: str }, ['target'])],
  ['post', '/gate/verify', 'Gate', 'Verify QR (no recording)', 'security, admin', obj({ token: str }, ['token']), ref('GateResult')],
  ['post', '/gate/scan', 'Gate', 'Verify and record EXIT/ENTRY', 'security, admin', obj({ token: str }, ['token']), ref('GateResult')],
  ['get', '/gate/lookup', 'Gate', 'Manual lookup by roll number', 'security, admin', null, ref('GateResult'), ['roll_no']],
  ['post', '/gate/manual', 'Gate', 'Manually record EXIT/ENTRY', 'security, admin', obj({ trip_id: int, action: str, note: str }, ['trip_id', 'action']), ref('GateResult')],
  ['get', '/gate/logs', 'Gate', 'Gate logs', 'security, staff', null, arr({ type: 'object' }), ['date', 'page']],
  ['get', '/geofences/campus', 'Geofences', 'Active campus fence', 'any', null, ref('Geofence')],
  ['get', '/geofences', 'Geofences', 'List geofences', 'staff', null, arr(ref('Geofence')), ['type']],
  ['post', '/geofences', 'Geofences', 'Create geofence', 'admin', ref('Geofence'), ref('Geofence')],
  ['put', '/geofences/{id}', 'Geofences', 'Update geofence', 'admin', ref('Geofence'), ref('Geofence')],
  ['delete', '/geofences/{id}', 'Geofences', 'Delete geofence', 'admin'],
  ['get', '/notifications', 'Notifications', 'Own inbox', 'any', null, arr(ref('Notification')), ['unread', 'page']],
  ['get', '/notifications/unread-count', 'Notifications', 'Unread count', 'any', null, obj({ count: int })],
  ['post', '/notifications/{id}/read', 'Notifications', 'Mark read', 'any'],
  ['post', '/notifications/read-all', 'Notifications', 'Mark all read', 'any'],
  ['get', '/dashboard/staff', 'Dashboards', 'Warden dashboard', 'staff'],
  ['get', '/dashboard/student', 'Dashboards', 'Student dashboard', 'student'],
  ['get', '/dashboard/admin', 'Dashboards', 'Admin dashboard', 'admin'],
  ['get', '/reports/summary', 'Reports', 'Aggregates for charts', 'staff', null, { type: 'object' }, ['from', 'to']],
  ['get', '/reports/export', 'Reports', 'CSV/PDF export (accepts ?access_token=)', 'staff', null, null, ['type', 'format', 'from', 'to', 'access_token']],
  ['get', '/admin/departments', 'Admin', 'List departments', 'admin'],
  ['post', '/admin/departments', 'Admin', 'Create department', 'admin', obj({ name: str, code: str })],
  ['put', '/admin/departments/{id}', 'Admin', 'Update department', 'admin', obj({ name: str, code: str })],
  ['delete', '/admin/departments/{id}', 'Admin', 'Delete department', 'admin'],
  ['get', '/admin/hostels', 'Admin', 'List hostels', 'admin'],
  ['post', '/admin/hostels', 'Admin', 'Create hostel', 'admin', obj({ name: str, warden_id: int })],
  ['put', '/admin/hostels/{id}', 'Admin', 'Update hostel', 'admin', obj({ name: str, warden_id: int })],
  ['delete', '/admin/hostels/{id}', 'Admin', 'Delete hostel', 'admin'],
  ['get', '/admin/links', 'Admin', 'Parent-student links', 'admin', null, null, ['q', 'verified']],
  ['post', '/admin/links', 'Admin', 'Create link', 'admin', obj({ parent_id: int, student_id: int, relation: str, verified: bool }, ['parent_id', 'student_id'])],
  ['patch', '/admin/links/{id}', 'Admin', 'Verify / update link', 'admin', obj({ verified: bool, relation: str })],
  ['delete', '/admin/links/{id}', 'Admin', 'Delete link', 'admin'],
  ['get', '/admin/registrations', 'Registration', 'Self-registrations by status', 'admin', null, null, ['status']],
  ['get', '/admin/registrations/count', 'Registration', 'Pending count', 'admin', null, obj({ pending: int })],
  ['post', '/admin/registrations/{id}/approve', 'Registration', 'Approve (activates the account)', 'admin'],
  ['post', '/admin/registrations/{id}/reject', 'Registration', 'Reject with optional reason', 'admin', obj({ reason: str })],
  ['post', '/admin/registrations/bulk-approve', 'Registration', 'Bulk approve', 'admin', obj({ ids: arr(int) }, ['ids'])],
  ['get', '/admin/settings', 'Admin', 'System settings', 'admin'],
  ['put', '/admin/settings', 'Admin', 'Update settings', 'admin', { type: 'object', additionalProperties: true }],
  ['get', '/admin/audit-logs', 'Admin', 'Audit log', 'admin', null, null, ['action', 'actor_id', 'entity', 'page']],
  ['post', '/ai/predict', 'AI', 'Delay probability + risk for a prospective trip', 'student, staff', obj({ student_id: int, reason_category: str, destination_type: str, dest_lat: num, dest_lng: num, depart_at: date, expected_return_at: date }), ref('Prediction')],
  ['get', '/ai/insights', 'AI', 'Peak hours, late returners, approval time', 'staff'],
  ['get', '/ai/model', 'AI', 'Model metadata', 'staff'],
  ['post', '/ai/retrain', 'AI', 'Retrain model from samples', 'admin'],
  ['get', '/meta/departments', 'Meta', 'Departments', 'any'],
  ['get', '/meta/hostels', 'Meta', 'Hostels', 'any'],
  ['get', '/settings/public', 'Meta', 'Client-relevant settings', 'any'],
  ['post', '/uploads', 'Meta', 'Upload attachment (multipart "file")', 'any', null, obj({ url: str })],
  ['get', '/health', 'Meta', 'Health check', 'public'],
];

const paths = {};
for (const [method, path, tag, summary, roles, body, response, query] of routes) {
  const params = [];
  for (const m of path.matchAll(/\{(\w+)\}/g)) params.push({ name: m[1], in: 'path', required: true, schema: int });
  for (const q of query || []) params.push({ name: q, in: 'query', required: false, schema: str });
  const op = {
    tags: [tag],
    summary,
    description: `Roles: ${roles}`,
    parameters: params,
    responses: {
      200: { description: 'OK', content: { 'application/json': { schema: envelope(response || { type: 'object' }) } } },
      400: { description: 'Validation error', content: { 'application/json': { schema: ref('Error') } } },
      401: { description: 'Unauthenticated' },
      403: { description: 'Forbidden' },
    },
  };
  if (roles === 'public') op.security = [];
  if (body) op.requestBody = { required: true, content: { 'application/json': { schema: body } } };
  if (path.endsWith('/import') || path === '/uploads') {
    op.requestBody = { required: true, content: { 'multipart/form-data': { schema: obj({ file: { type: 'string', format: 'binary' } }) } } };
  }
  paths[path] = paths[path] || {};
  paths[path][method] = op;
}

module.exports = {
  openapi: '3.0.3',
  info: {
    title: 'SmartOutpass API',
    version: '1.0.0',
    description:
      'Digital outpasses, QR gate verification, consent-based live tracking and AI delay prediction. ' +
      'Responses are wrapped as `{ data, meta? }`; errors as `{ error: { code, message, details? } }`. ' +
      'Realtime events are documented in docs/SOCKET_EVENTS.md.',
  },
  servers: [{ url: '/api' }],
  components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } }, schemas },
  security: [{ bearer: [] }],
  paths,
};
