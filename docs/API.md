# SmartOutpass REST API

Base URL: `http://<host>:4000/api` · Interactive docs: `GET /api/docs` (Swagger UI), raw spec `GET /api/docs.json`.

## Conventions

| Item | Rule |
|---|---|
| Auth | `Authorization: Bearer <accessToken>` on every route except `/auth/login`, `/auth/refresh`, `/health` |
| Success body | `{ "data": <payload>, "meta"?: { "page": 1, "pageSize": 20, "total": 134 } }` |
| Error body | `{ "error": { "code": "VALIDATION_ERROR", "message": "Human readable", "details"?: any } }` |
| IDs | integers |
| Dates | ISO-8601 UTC strings (`2026-10-20T08:30:00.000Z`) in and out |
| Pagination | `?page=1&pageSize=20` (max 100) on list endpoints → `meta` |
| Access token | JWT, 15 min. On `401` with code `TOKEN_EXPIRED` call `/auth/refresh` and retry once |
| Refresh token | opaque, 30 days, **rotated on every refresh** (old one becomes invalid; reuse revokes the whole session family) |

### Roles
`student`, `warden`, `faculty`, `security`, `parent`, `admin`. "Staff" = `warden` + `faculty` (+ `admin` wherever staff is allowed).

### Enums
- `reason_category`: `HOME_VISIT`, `MEDICAL`, `FAMILY_EVENT`, `ACADEMIC`, `PERSONAL`, `SHOPPING`, `OTHER`
- `destination_type`: `HOME`, `OTHER`
- Outpass `status`: `PENDING`, `APPROVED`, `REJECTED`, `CANCELLED`, `ACTIVE`, `OVERDUE`, `COMPLETED`, `EXPIRED`
- Trip `status`: `APPROVED` (not yet exited), `ACTIVE`, `OVERDUE`, `COMPLETED`, `CANCELLED`
- `risk_level`: `LOW` (<35), `MEDIUM` (35–64), `HIGH` (≥65) — derived from `risk_score` 0–100, where `risk_score = 100·p / (p + base_late_rate)` (p = predicted probability of returning >15 min late; 50 = an average trip)
- Gate `type`: `EXIT`, `ENTRY`
- Notification `type`: `REQUEST_SUBMITTED`, `REQUEST_APPROVED`, `REQUEST_REJECTED`, `DEPARTED`, `REACHED_DESTINATION`, `RETURNED_CAMPUS`, `TRIP_COMPLETED`, `OVERDUE`, `SIGNAL_LOST`, `CONSENT_GRANTED`, `CONSENT_REVOKED`, `MANUAL_NOTICE`

Suggested status badge colours: PENDING amber, APPROVED blue, ACTIVE indigo, COMPLETED green, OVERDUE red, REJECTED gray-red, CANCELLED/EXPIRED gray.

### Error codes (`error.code`)
`VALIDATION_ERROR` 400 · `UNAUTHORIZED` 401 · `TOKEN_EXPIRED` 401 · `INVALID_CREDENTIALS` 401 · `FORBIDDEN` 403 · `NOT_FOUND` 404 · `CONFLICT` 409 · `RATE_LIMITED` 429 · `TRACKING_NOT_ALLOWED` 403 (details.reason: `TRIP_NOT_ACTIVE` | `NO_CONSENT` | `OUTSIDE_TRIP_WINDOW`) · `OUTSIDE_CAMPUS` 422 (details.distance_m) · QR errors 422: `QR_INVALID`, `QR_EXPIRED`, `QR_REVOKED`, `QR_ALREADY_USED`, `PASS_NOT_APPROVED`, `OUTSIDE_TIME_WINDOW`, `TRIP_CLOSED` (details may include `student` and `trip` so the guard sees who it was) · `ACCOUNT_PENDING` 403 (login, correct password, registration awaiting admin approval) · `ACCOUNT_REJECTED` 403 (login, registration rejected; message includes the reason) · `REGISTRATION_CONFLICT` 409 (email, phone or roll number already in use — deliberately does not say which) · `PASSWORD_CHANGE_REQUIRED` 403 (account still on a temporary password: only `GET /auth/me`, `POST /auth/change-password`, `PUT /auth/push-token` are allowed until it is changed; admins are exempt) · `INTERNAL_ERROR` 500.

---

## Shared objects

```jsonc
// User
{ "id": 7, "role": "student", "name": "Aarav Sharma", "email": "student1@smartoutpass.edu", "phone": "+919800000001",
  "roll_no": "S2024001", "department_id": 1, "department": "Computer Science", "hostel_id": 2, "hostel": "Boys Hostel A",
  "photo_url": "https://i.pravatar.cc/300?u=S2024001", "is_active": true, "created_at": "..." }

// StudentSummary (embedded)
{ "id": 7, "name": "...", "roll_no": "S2024001", "photo_url": "...", "phone": "...", "department": "...", "hostel": "..." }

// Outpass
{ "id": 120, "student_id": 7, "student": StudentSummary,
  "reason": "Sister's wedding", "reason_category": "FAMILY_EVENT", "destination_type": "HOME",
  "dest_address": "12 MG Road, Mysuru", "dest_lat": 12.2958, "dest_lng": 76.6394,
  "depart_at": "...", "expected_return_at": "...", "attachment_url": null,
  "status": "PENDING", "reviewed_by": null, "reviewer": { "id": 3, "name": "Dr. Meera Iyer" } | null,
  "reviewed_at": null, "remarks": null,
  "risk_score": 42, "risk_level": "MEDIUM", "risk_reasons": ["Past late-return rate 38%", "Long-distance destination (140 km)"],
  "predicted_delay_min": 25, "delay_probability": 0.42,
  "created_at": "...", "trip": Trip | null }

// Trip
{ "id": 55, "request_id": 120, "status": "ACTIVE",
  "exit_at": "...", "exit_guard_id": 4, "entry_at": null, "entry_guard_id": null,
  "left_campus_at": "...", "reached_destination_at": null, "returned_at": null, "completed_at": null,
  "escalation_level": 0, "last_ping_at": "...", "tracking_active": true,
  "student": StudentSummary, "reason": "...", "reason_category": "...", "destination_type": "HOME",
  "dest_address": "...", "dest_lat": 12.29, "dest_lng": 76.63, "depart_at": "...", "expected_return_at": "...",
  "last_location": { "lat": 12.5, "lng": 77.0, "accuracy": 12, "speed": 14.2, "battery": 0.71, "recorded_at": "..." } | null }

// Consent
{ "id": 9, "trip_id": 55, "student_id": 7, "scope": "TRIP_LOCATION", "granted_at": "...", "revoked_at": null,
  "revoke_reason": null /* USER | TRIP_COMPLETED | TRIP_CANCELLED */, "active": true }

// Geofence
{ "id": 1, "name": "Main Campus", "type": "CAMPUS" /* CAMPUS|DESTINATION|CUSTOM */, "shape": "POLYGON" /* CIRCLE|POLYGON */,
  "center_lat": 12.97, "center_lng": 77.59, "radius_m": 450, "polygon": [[12.97,77.59], ...] | null, "trip_id": null, "is_active": true }

// Notification
{ "id": 301, "type": "REACHED_DESTINATION", "title": "Aarav reached home", "body": "...", "trip_id": 55,
  "data": { "tripId": 55 }, "read_at": null, "created_at": "..." }
```

---

## Auth
| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/auth/login` | `{ identifier, password }` — identifier = email **or** roll_no | `{ accessToken, refreshToken, user }` (rate-limited: 10 / 15 min / IP+identifier) |
| POST | `/auth/refresh` | `{ refreshToken }` | `{ accessToken, refreshToken }` |
| POST | `/auth/logout` | `{ refreshToken }` | `{ ok: true }` |
| GET | `/auth/me` | – | `User` |
| PUT | `/auth/me` | `{ name?, phone?, photo_url? }` | `User` |
| POST | `/auth/change-password` | `{ currentPassword, newPassword }` (min 8, must differ) | `{ ok, accessToken, refreshToken, user }` — all sessions are revoked and this device gets a fresh pair; clears `must_change_password` |
| PUT | `/auth/push-token` | `{ pushToken }` (Expo token or `null`) | `{ ok: true }` |

## Self-registration (public)
Only **students and parents** can register; any other `role` is rejected (400) and no account is created. Staff accounts are created by an admin.

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/auth/register/options` | – | `{ departments: [{ id, name, code }], hostels: [{ id, name }], relations: ["Father","Mother","Guardian"] }` |
| POST | `/auth/register` | student: `{ role: "student", name, roll_no, email, phone, department_id, hostel_id, password, confirm_password }` · parent: `{ role: "parent", name, email, phone, children: [{ roll_no, relation }] (1–5), password, confirm_password }` | 201 `{ ok, status: "PENDING", message }` |

Rules: phone = Indian 10-digit mobile, optional +91 (stored as `+91XXXXXXXXXX`); roll number 3–20 letters/digits with at least one digit; password ≥ 8 chars with a letter and a number. Rate limit 5 / hour / IP. Accounts are created **inactive** with `registration_status = PENDING` (no login, no notifications). Parent children: a link with `verified = 0` is created for each roll number that matches a student; unknown roll numbers are accepted silently (the response is identical). No auto-login.

## Meta / settings (any authenticated user)
| GET | `/meta/departments` | `[{ id, name, code }]` |
|---|---|---|
| GET | `/meta/hostels` | `[{ id, name, warden_id }]` |
| GET | `/settings/public` | `{ tracking_interval_moving_sec, tracking_interval_idle_sec, tracking_interval_low_battery_sec, destination_radius_m, geofence_max_accuracy_m, overdue_grace_min }` |
| GET | `/geofences/campus` | `Geofence` — the primary campus fence (lowest id): map default, distance reference |
| GET | `/geofences/campuses` | `Geofence[]` — every active campus fence (e.g. college + off-site hostel). Leaving = outside all of them; returned / check-in = inside any of them |

## Uploads
`POST /uploads` multipart field `file` (jpg/png/pdf, ≤ 5 MB) → `{ url }` (served from `/uploads/...`, prefix with server origin).

## Users (admin; staff may list/read students)
| Method | Path | Notes |
|---|---|---|
| GET | `/users?role=&q=&hostel_id=&department_id=&is_active=&page=&pageSize=` | staff only get `role=student` |
| POST | `/users` | `{ role, name, email, phone?, password, roll_no?, department_id?, hostel_id?, photo_url? }` |
| GET | `/users/:id` | `User` |
| PUT | `/users/:id` | any subset of POST fields + `is_active` (password optional) |
| DELETE | `/users/:id` | soft-deactivates → `{ ok: true }` |
| POST | `/users/import` | multipart `file` (CSV header: `role,name,email,phone,roll_no,department,hostel,password`) → `{ created, skipped, errors: [{ line, message }] }` |
| GET | `/users/:id/history` | staff/admin: `{ student: User, stats: { total, completed, late, late_rate, avg_delay_min }, outpasses: Outpass[] }` |

## Parent
| GET | `/parent/students` | `[{ student: StudentSummary, relation, current_trip: Trip \| null, tracking_visible: bool }]` |
|---|---|---|

## Outpass requests
| Method | Path | Role | Body / Query | Returns |
|---|---|---|---|---|
| POST | `/outpasses` | student | `{ reason, reason_category, destination_type, dest_address, dest_lat, dest_lng, depart_at, expected_return_at, attachment_url? }` (depart ≥ now-15min, return > depart, max 30 days) | `Outpass` (with AI risk fields) |
| GET | `/outpasses` | all* | `?status=PENDING,OVERDUE&student_id=&q=&from=&to=&risk_level=&page=&pageSize=` | `Outpass[]` + meta. Student: own. Parent: verified linked students. Staff/admin: all. |
| GET | `/outpasses/:id` | all* | – | `Outpass` + `gate_logs: [...]`, `events: [{ type, at }]` |
| POST | `/outpasses/:id/cancel` | student (owner) | – | `Outpass` (only PENDING / APPROVED-before-exit) |
| POST | `/outpasses/:id/approve` | staff | `{ remarks? }` | `Outpass` (trip created, destination geofence created) |
| POST | `/outpasses/:id/reject` | staff | `{ remarks }` (required) | `Outpass` |
| POST | `/outpasses/bulk-approve` | staff | `{ ids: number[], remarks? }` | `{ approved: number[], failed: [{ id, reason }] }` |

## Trips
| Method | Path | Role | Body / Query | Returns |
|---|---|---|---|---|
| GET | `/trips` | all* | `?status=ACTIVE,OVERDUE&student_id=&page=` | `Trip[]` |
| GET | `/trips/live` | staff | – | `Trip[]` for ACTIVE/OVERDUE trips **with active consent**, each with `last_location` |
| GET | `/trips/overdue` | staff | – | `Trip[]` (OVERDUE) with `minutes_late`, `parents: [{ id, name, phone }]` |
| GET | `/trips/:id` | all* | – | `Trip` + `consent: Consent \| null`, `gate_logs`, `events` |
| GET | `/trips/:id/qr` | student (owner) | – | `{ token, expires_at }` — JWT to render as QR. 409 if trip closed |
| GET | `/trips/:id/locations` | staff / owner / parent† | `?since=ISO&limit=500` | `[{ lat, lng, accuracy, speed, battery, recorded_at }]` ascending |
| POST | `/trips/:id/location` | student (owner) | `{ lat, lng, accuracy?, speed?, battery?, timestamp? }` **or** `{ pings: [same, ≤ 50] }` | `{ accepted: n, events: ["REACHED_DESTINATION"...], next_interval_sec }` · 403 `TRACKING_NOT_ALLOWED` |
| GET | `/trips/:id/consent` | owner / staff | – | `{ current: Consent \| null, history: Consent[] }` |
| POST | `/trips/:id/consent` | student (owner) | `{ scope?: "TRIP_LOCATION", accept: true }` | `Consent` (trip must be APPROVED/ACTIVE/OVERDUE) |
| DELETE | `/trips/:id/consent` | student (owner) | – | `Consent` (revoked) |
| POST | `/trips/:id/checkin` | student (owner) | `{ lat, lng, accuracy? }` | `Trip` (sets `returned_at`) · 422 `OUTSIDE_CAMPUS` |
| POST | `/trips/:id/notify` | staff | `{ target: "student" \| "parent" \| "both", message? }` | `{ sent: n }` |

\* scoped by role. † parent: only verified-linked student, only while trip is ACTIVE/OVERDUE **and** consent is active.

Tracking is accepted **only** when trip status is ACTIVE/OVERDUE (after gate exit), consent is active, and now is within `[exit_at, expected_return_at + tracking_overrun_max_min]`. Tracking (and consent) ends automatically when the trip is COMPLETED.

## Gate (security; admin also allowed)
| Method | Path | Body / Query | Returns |
|---|---|---|---|
| POST | `/gate/verify` | `{ token }` | `{ valid: true, action: "EXIT" \| "ENTRY", student: StudentSummary, outpass: Outpass, trip: Trip }` — does **not** record. 422 QR_* errors |
| POST | `/gate/scan` | `{ token }` | `{ action, gate_log: { id, trip_id, guard_id, type, scanned_at, result }, student, trip }` — re-verifies and records |
| GET | `/gate/lookup?roll_no=` | – | `{ student: StudentSummary, trip: Trip \| null, action: "EXIT" \| "ENTRY" \| null, outpass: Outpass \| null }` |
| POST | `/gate/manual` | `{ trip_id, action: "EXIT" \| "ENTRY", note? }` | same as `/gate/scan` |
| GET | `/gate/logs?date=YYYY-MM-DD&page=` | – | `[{ id, trip_id, type, scanned_at, result, guard: {id,name}, student: StudentSummary \| null }]` |

## Geofences
| GET | `/geofences?type=` | staff/admin | `Geofence[]` |
|---|---|---|---|
| POST | `/geofences` | admin | `{ name, type, shape, center_lat, center_lng, radius_m?, polygon?, is_active? }` |
| PUT | `/geofences/:id` | admin | subset |
| DELETE | `/geofences/:id` | admin | `{ ok: true }` |

## Notifications (own)
| GET | `/notifications?unread=true&page=` | `Notification[]` |
|---|---|---|
| GET | `/notifications/unread-count` | `{ count }` |
| POST | `/notifications/:id/read` | `{ ok: true }` |
| POST | `/notifications/read-all` | `{ ok: true }` |

## Dashboards
- `GET /dashboard/staff` (staff/admin) → `{ pending_count, active_count, overdue_count, returned_today, high_risk_pending, pending: Outpass[≤10], overdue: Trip[≤10] }`
- `GET /dashboard/student` → `{ active_outpass: Outpass | null, recent: Outpass[≤5], stats: { total, completed, late } }`
- `GET /dashboard/admin` → `{ users_by_role: { student: n, ... }, outpasses_today, active_trips, overdue_trips, notifications_today }`

## Reports (staff/admin)
- `GET /reports/summary?from=&to=` → `{ by_status: [{ status, count }], by_day: [{ date, requests, approved, late }], by_category: [{ category, count, late_rate }], avg_approval_minutes, on_time_rate, total }`
- `GET /reports/export?type=outpasses|trips|gate_logs&format=csv|pdf&from=&to=` → file download (`Content-Disposition: attachment`). Accepts `?access_token=` as an alternative to the header so it can be opened as a link.

## Admin
| Method | Path | Notes |
|---|---|---|
| GET/POST | `/admin/departments` | `{ name, code }` |
| PUT/DELETE | `/admin/departments/:id` | |
| GET/POST | `/admin/hostels` | `{ name, warden_id? }` |
| PUT/DELETE | `/admin/hostels/:id` | |
| GET | `/admin/links?q=&verified=` | `[{ id, parent: {id,name,email,phone}, student: StudentSummary, relation, verified, created_at }]` |
| POST | `/admin/links` | `{ parent_id, student_id, relation?, verified? }` |
| PATCH | `/admin/links/:id` | `{ verified?, relation? }` |
| DELETE | `/admin/links/:id` | |
| GET | `/admin/settings` | `{ key: value, ... }` |
| PUT | `/admin/settings` | `{ key: value, ... }` (known keys only; see `/settings/public` + `overdue_grace_min`, `escalation_student_min`, `escalation_warden_min`, `escalation_parent_min`, `return_autocomplete_grace_min`, `signal_lost_min`, `ping_retention_days`, `geofence_debounce_count`, `tracking_overrun_max_min`, `sms_enabled`) |
| GET | `/admin/audit-logs?action=&actor_id=&entity=&page=` | `[{ id, actor: {id,name,role} \| null, action, entity, entity_id, details, ip, created_at }]` |

## AI
| Method | Path | Role | Body | Returns |
|---|---|---|---|---|
| POST | `/ai/predict` | student/staff/admin | `{ student_id?, reason_category, destination_type, dest_lat, dest_lng, depart_at, expected_return_at }` (student_id defaults to caller for students) | `{ delay_probability, expected_delay_min, risk_score, risk_level, reasons: string[], contributions: [{ feature, value, impact }], model_version }` |
| GET | `/ai/insights` | staff/admin | – | `{ peak_hours: [{ hour, count }], peak_days: [{ day, count }], frequent_late_returners: [{ student_id, name, roll_no, trips, late_trips, late_rate, avg_delay_min }], avg_approval_minutes, late_rate_by_category: [{ category, late_rate, count }], model: { version, provider, trained_at, metrics: { accuracy, auc, logloss, samples, mae_minutes } } }` |
| GET | `/ai/model` | staff/admin | – | model metadata |
| POST | `/ai/retrain` | admin | – | `{ version, metrics }` |

## Registrations (admin)
| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/admin/registrations?status=PENDING|APPROVED|REJECTED` | – | `[{ id, role, name, email, phone, roll_no, department, hostel, created_at, registration_status, registration_note, reviewed_at, reviewer, children: [{ roll_no, relation, student: { id, name } | null }] }]` |
| GET | `/admin/registrations/count` | – | `{ pending }` (nav badge) |
| POST | `/admin/registrations/:id/approve` | – | `{ ok }` — sets `is_active = 1`, `APPROVED`; notifies the user. Parent links stay unverified |
| POST | `/admin/registrations/:id/reject` | `{ reason? }` | `{ ok }` — `REJECTED`, stays inactive; reason shown at login |
| POST | `/admin/registrations/bulk-approve` | `{ ids }` | `{ approved, failed: [{ id, reason }] }` |

## Bulk CSV import (admin)
| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/admin/import/:type/template` | – | CSV template (`type` = `students` · `parents` · `staff` · `links`) |
| POST | `/admin/import/:type/preview` | multipart `file` | `{ type, columns, summary: { total, ok, duplicate, error }, rows: [{ line, status: ok|duplicate|error, data, errors, warnings, message }] }` — writes nothing |
| POST | `/admin/import/:type/commit` | multipart `file`, optional `temp_password` (min 8) | `{ created, skipped, failed, summary, rows, credentials: [{ name, role, login, email, temporary_password }] }` — re-validates and inserts only `ok` rows in one transaction |

Columns — students: `name, roll_no, email, phone, department, hostel` · parents: `name, email, phone` · staff: `name, role (warden|faculty|security), email, phone, hostel (wardens only)` · links: `student_roll_no, parent_phone_or_email, relation, verified`. Department/hostel match existing names (department also by code); duplicates by email / roll_no (links: same parent+student) are skipped. Imported users get `must_change_password = 1`; without `temp_password` a random one is generated per user and returned once.

## Jobs (admin)
`POST /admin/jobs/:name/run` — run a scheduled job immediately (`overdue`, `signal-lost`, `auto-complete`, `expiry`, `ping-retention`) → `{ job, result }`. Used by the simulator and for demos.

## Health
`GET /health` → `{ ok: true, db: true, time }`
