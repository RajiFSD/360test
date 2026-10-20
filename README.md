# SmartOutpass

AI-powered digital outpasses and consent-based live tracking for colleges. It replaces handwritten outpasses and gate registers with:

- **Digital outpass requests**: students apply from the app, wardens approve or reject with remarks, and every request gets an AI delay-risk score.
- **QR gate verification**: the pass is a signed, short-lived QR code. It is single-use per direction: the first scan records EXIT, the second records ENTRY, and any further scan is rejected.
- **Consent-based live tracking**: tracking needs an explicit opt-in for each trip, can be revoked at any time, and is enforced on the server. It is allowed only after the gate exit and inside the trip window.
- **Automatic notifications**: parents and wardens are told when the student has *departed*, *reached home*, *reached college*, or is *overdue*. Overdue alerts escalate in levels.
- **Admin, reports and AI insights**: CSV/PDF exports, peak hours, frequent late returners, and average approval time.

```
/server   Node.js · Express · MariaDB (mysql2) · Socket.IO · node-cron · JWT (access + rotating refresh) · Zod
/web      React 18 · Vite · React Router · TanStack Query · Tailwind · Leaflet · Recharts
/mobile   React Native (Expo) · expo-location (fg + bg) · expo-notifications · expo-camera · react-native-maps
/docs     API.md (REST contract) · SOCKET_EVENTS.md (realtime contract)
```

---

## 1. Prerequisites

| Tool | Version |
|---|---|
| Node.js | 20+ (tested on 24) |
| MariaDB | 10.6+ (MySQL 8+ also works; the schema avoids vendor-specific features) |
| Expo | Expo Go app on a phone, or Android Studio / Xcode for a development build |

### MariaDB
Pick one of these:

**Docker** (simplest):
```bash
docker compose up -d          # MariaDB 11.4 on :3306, user/pass smartoutpass/smartoutpass
```

**Local install**: create a database and a user:
```sql
CREATE DATABASE smartoutpass CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'smartoutpass'@'localhost' IDENTIFIED BY 'smartoutpass';
GRANT ALL PRIVILEGES ON smartoutpass.* TO 'smartoutpass'@'localhost';
```
`npm run db:migrate` creates the database itself if the user is allowed to. If you would rather install the schema by hand, use `server/db/schema.sql`.

## 2. Server

```bash
cd server
cp .env.example .env          # set DB_* and generate the two secrets (command is in the file)
npm install
npm run db:migrate            # applies db/migrations/*.sql
npm run db:seed               # demo users, campus geofence, 2,000 historical trips, trains the AI model
npm run dev                   # http://localhost:4000  ·  Swagger: http://localhost:4000/api/docs
```

| Script | What it does |
|---|---|
| `npm run db:reset` | Drops all tables, re-migrates and re-seeds. Use it to restore a clean demo state |
| `npm run db:schema` | Regenerates `db/schema.sql` from the migrations |
| `npm run ai:retrain` | Pulls newly completed trips into `ai_trip_samples`, retrains, and writes `models/delay-model.json`. The running API hot-reloads it |
| `npm run simulate` | Replays a full trip against the running API (see §6) |
| `npm test` | Unit tests: geofence engine, QR verification and tracking rules, overdue/escalation cron |

### Environment variables (`server/.env`)
| Var | Purpose |
|---|---|
| `PORT`, `PUBLIC_URL`, `CORS_ORIGINS` | HTTP server and allowed web origins (comma-separated) |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_POOL_SIZE` | MariaDB connection |
| `JWT_ACCESS_SECRET`, `JWT_ACCESS_TTL` | Access-token signing key and lifetime (default 15m) |
| `REFRESH_TOKEN_TTL_DAYS` | Refresh-token lifetime. Refresh tokens rotate on every use, and reusing an old one revokes the whole session |
| `QR_SIGNING_SECRET` | A separate key that signs outpass QR codes |
| `ENABLE_JOBS` | Turns the cron jobs on or off. Enable them on exactly one instance |
| `EXPO_ACCESS_TOKEN` | Optional Expo push access token |
| `SMS_PROVIDER` | `console` (logs messages), `twilio` (needs `TWILIO_*`) or `none`. SMS is also gated by the `sms_enabled` admin setting |
| `AI_PROVIDER`, `AI_SERVICE_URL`, `AI_MODEL_PATH` | `node` uses the built-in model. `http` calls an external model service (for example Python), see §8 |

## 3. Web app

```bash
cd web
cp .env.example .env          # defaults proxy /api, /uploads and /socket.io to localhost:4000
npm install
npm run dev                   # http://localhost:5173
npm run build                 # production build in web/dist
```

## 4. Mobile app (Expo)

```bash
cd mobile
cp .env.example .env
# Set EXPO_PUBLIC_API_URL to your computer's LAN IP, e.g. http://192.168.1.10:4000 (not localhost: the phone must reach it)
npm install
npx expo start                # scan the QR code with Expo Go, or press a for Android / i for iOS
```

- **Background location** and reliable push need a **development build**, because Expo Go cannot run background location tasks on iOS and has limits on Android. Build one with `npx expo run:android` or `npx expo run:ios`, or use EAS (`eas build --profile development`). Foreground tracking, QR scanning, maps and in-app notifications all work in Expo Go.
- QR scanning uses `expo-camera`'s `CameraView` barcode scanner. `expo-barcode-scanner` is deprecated in recent Expo SDKs, so it is not used.
- If you are on Windows, allow Node through the firewall on port 4000 so the phone can reach the API.

## 5. Test credentials

Every account's password is **`Password@123`**.

| Role | Login | Notes |
|---|---|---|
| Admin | `admin@smartoutpass.edu` | Full admin console |
| Warden | `warden@smartoutpass.edu` | Boys Hostel A. Also `warden2@…` (Hostel B) and `warden3@…` (Girls Hostel C) |
| Faculty | `faculty@smartoutpass.edu` | Has the same approval rights as wardens |
| Security | `security@smartoutpass.edu` | Also `security2@…` |
| Student | `student1@smartoutpass.edu` or roll **`S2024001`** | Aarav Sharma, home in Mysuru. Students run `student1` … `student60` (`S2024001` … `S2024060`) |
| Parent | `parent1@smartoutpass.edu` | Linked to S2024001 and S2024002. `parentN` is linked to `studentN`. Parents 44 and 45 are unverified, for the link-verification demo |

The seed also creates a live demo state:
- 4 **pending** requests with different AI risk levels.
- An **approved** pass waiting at the gate for `S2024010`.
- 2 **active, tracked** trips (`S2024007`, `S2024008`) on the live map.
- 1 **overdue** trip (`S2024009`; its parent is `parent9`).

## 6. Demo walkthrough

1. **Student requests.** In the web or mobile app, log in as `S2024001`, choose **New request**, pick *Home visit*, and tap the destination on the map. The AI risk preview appears before you submit.
2. **Warden reviews.** In another browser profile, log in as `warden@…`. The request shows on the dashboard in real time with its risk badge and reasons. Approve it with remarks, or tick several requests and **Bulk approve**.
3. **QR and consent.** The student's request page now shows the signed QR code and a consent card. Tick the consent box and tap **Share location**. The server stores a timestamped consent record.
4. **Gate exit.** Log in as `security@…` (the mobile scanner, or the web Scan page with a camera or a pasted token). Scan the code; the guard sees the student's photo, reason and expected return, and taps **Confirm EXIT**. The parent is notified that the student *Departed*.
5. **Live tracking.** The student app shows a pulsing **Sharing location** indicator. The warden's **Live map** and the parent's trip view move in real time. Each ping runs the server's geofence engine; when the student reaches home, parents and the warden are notified *Reached home*.
6. **Return.** Entering the campus geofence, or tapping **I've reached campus** (checked against the geofence), notifies parents and the warden *Reached college*. Security scans the **same QR** again, which records ENTRY and completes the trip, and tracking stops on its own. A third scan is rejected as *already used*.
7. **Overdue.** Open **Overdue** as the warden: `S2024009` is listed with how late they are, the parent's phone number, and one-tap *Notify student / Notify parent* buttons. The cron job escalates at +15 min (student), +30 min (warden) and +60 min (parents and security).
8. **Admin.** Log in as `admin@…` for users (with CSV import), parent links, hostels and departments, the geofence editor, settings, audit logs, reports (CSV/PDF), and **AI insights** (including **Retrain model**).

### No need to leave your desk: the simulator
With the API running (`npm run dev`), open a second terminal:
```bash
cd server
npm run simulate                          # S2024001: approve → consent → EXIT → travel → home → return → ENTRY
npm run simulate -- --scenario=overdue    # also jumps past the return time and runs the overdue job
npm run simulate -- --student=S2024002 --dest=12.9141,74.8560 --steps=20 --delay=1000
```
It connects Socket.IO clients as the parent, the warden and the student, and prints every notification each of them receives. It also checks the server-side rules: no tracking before EXIT, no tracking after completion, and rejection of a third QR scan. Keep the web app open as `warden@…` (Live map) or `parent1@…` to watch it happen. If a run is interrupted while the student is still out, finish the trip with a security ENTRY scan or run `npm run db:reset`.

## 7. How it works

### Trip lifecycle
```
PENDING ──approve──▶ APPROVED ──gate EXIT──▶ ACTIVE ──(+grace, cron)──▶ OVERDUE
   │                    │                     │  geofence: REACHED_DESTINATION   │
   └─reject─▶ REJECTED  └─cancel/expire       │  geofence/check-in: RETURNED     │
                                              └──────── gate ENTRY ──────────────┴──▶ COMPLETED (tracking + consent closed)
```
- Approving a request creates a `trip` with a random QR `jti`, plus a **destination geofence** (a circle with a default radius of 200 m, configurable).
- **QR**: an HS256 JWT `{ typ:'outpass', tid, jti, exp }` signed with `QR_SIGNING_SECRET`, where `exp` is the expected return plus the tracking overrun window. On each scan the server checks:
  1. the signature, and then the expiry;
  2. that the `jti` matches the trip;
  3. the trip status;
  4. the time window (EXIT is accepted from 60 min before departure until the expected return).

  Single use per direction is enforced with conditional `UPDATE … WHERE exit_at IS NULL` statements, so two guards scanning at the same moment cannot both record the event. Every rejected scan is written to `gate_logs`.
- **Tracking** (`POST /trips/:id/location`) is accepted only when the trip is ACTIVE or OVERDUE, consent is active, and the time is within `[exit_at, expected_return + overrun]`. Otherwise the server returns `403 TRACKING_NOT_ALLOWED` with a reason.
- **Geofence engine** (`server/src/services/geofence.engine.js`, a pure function) runs on every ping:
  - It uses Haversine distance for circles and ray casting for polygons.
  - It ignores pings with accuracy ≥ 100 m.
  - It requires 2 consecutive pings inside a fence before firing an event.
  - Each event fires only once, guaranteed by the unique key `trip_events(trip_id, type)`.
  - "Returned" can only fire after the student has left campus.
- **Jobs** (node-cron):
  - overdue and escalation: every 5 min;
  - signal-lost alert: every 2 min, after 10 min without a ping, raised once per trip;
  - auto-complete after return: every 5 min, after 30 min with no ENTRY scan;
  - expiry of unused passes: every 10 min;
  - location-ping retention: daily, deletes pings older than 30 days.

  All thresholds are admin settings. Admins can also trigger a job immediately with `POST /api/admin/jobs/:name/run`.

### Notifications
`notification.service.js` sends every notification to three channels and logs each one in `notifications`:
- **IN_APP**: the inbox, delivered live over Socket.IO.
- **PUSH**: through the Expo push API.
- **SMS**: optional, through the provider interface. A Twilio adapter and a console stub are included.

Parents are restricted by an allow-list enforced inside the service: `REQUEST_APPROVED`, `DEPARTED`, `REACHED_DESTINATION`, `RETURNED_CAMPUS` and `OVERDUE` only.

### Privacy and security
- RBAC middleware on every route, plus row-level scoping: students see only their own data, and parents see only verified-linked students.
- Parents can see location **only while** consent is active and the trip is in progress, and only pings recorded since consent was granted. The server removes parent sockets from the trip room when consent is revoked or the trip ends.
- Consent is explicit, scoped to one trip and time-boxed. Revoking it stops tracking immediately, and every grant or revocation is audited with time, IP and user agent.
- Passwords are hashed with bcrypt (`bcryptjs`, the same algorithm with no native build step). The login endpoint has its own rate limit, and unknown users take the same time to reject as wrong passwords.
- Other safeguards: helmet, CORS allow-list, a global API rate limit, Zod validation on every input, parameterized SQL only, CSV-injection-safe exports, and secrets loaded from `.env`.
- Uploaded attachments are served from `/uploads` under random, unguessable names. If attachments may contain sensitive medical documents, put them behind authenticated download (or object storage with signed URLs) before going to production.

### AI module (`server/src/services/ai/`)
- **Features** (`features.js`):
  - distance from campus (log-scaled) and trip duration;
  - return day of week and time of day: Sunday, Monday, late evening, early morning;
  - Friday or evening departure;
  - destination type and reason category;
  - the student's **past late-return rate**, smoothed with a Beta prior.

  Weather is not used.
- **Model** (`logistic.js`, `trainer.js`): a dependency-free **logistic regression** predicts *P(return more than 15 min late)*, and a ridge regression on log minutes predicts the *delay size if late*. Training uses an 80/20 split and records accuracy, AUC, log loss and MAE. With the seed data, AUC is about 0.73.
- **Outputs**:
  - `expected_delay_min = p × delay_if_late`.
  - `risk_score = 100·p / (p + base_late_rate)`, so 50 is an average trip. LOW is below 35, MEDIUM is 35–64, HIGH is 65 or more.
  - Reasons are the features that raise the log-odds most compared with an average trip, which makes every score explainable.
- **Where it is used**: wardens see the score and reasons on every request. `GET /ai/insights` returns peak request hours and days, frequent late returners, average approval time, late rate by category, and model metrics.

## 8. Swapping in a Python model
Set `AI_PROVIDER=http` and `AI_SERVICE_URL=http://host:8000`. The API sends `POST /predict` with `{ "features": {…named features…}, "raw": {…request…} }` and expects `{ "delay_probability", "delay_if_late_min", "base_rate"?, "contributions"?, "version"? }`. Training data is in the `ai_trip_samples` table. If the remote service fails, predictions fall back to the built-in transparent model.

## 9. Project layout (server)
```
server/
  db/migrations/001_init.sql   schema (FKs, indexes incl. location_pings(trip_id, recorded_at))
  db/schema.sql                generated single-file schema
  models/delay-model.json      trained model (written by seed/retrain)
  scripts/                     migrate, build-schema, seed, retrain, simulate-trip
  src/
    app.js · index.js · socket.js · realtime.js · config.js · db.js
    middleware/                auth (JWT + RBAC), validate (zod), error
    routes/                    auth, users, outpass, trips, gate, geofence, dashboard, reports, admin, ai, misc
    services/                  repo, trip, tracking, geofence.engine, gate, notification, settings, sms/, ai/
    jobs/                      overdue.job (escalation), monitor.jobs (signal lost, auto-complete, expiry, retention)
    docs/openapi.js            Swagger spec served at /api/docs
  tests/                       geofence, qr (+ tracking rules), overdue
```

Further reading: [docs/API.md](docs/API.md) and [docs/SOCKET_EVENTS.md](docs/SOCKET_EVENTS.md).
"# 360test" 
