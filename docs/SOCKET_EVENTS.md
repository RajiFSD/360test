# SmartOutpass Socket.IO contract

Server: same origin/port as the REST API (`http://<host>:4000`, path `/socket.io`).

```js
import { io } from 'socket.io-client';
const socket = io(API_ORIGIN, { auth: { token: accessToken }, transports: ['websocket'] });
```

The handshake is rejected (`connect_error` with `message: "UNAUTHORIZED"` or `"TOKEN_EXPIRED"`) if the access token is invalid. On `TOKEN_EXPIRED`, refresh the token, set `socket.auth.token = newToken` and call `socket.connect()`.

## Rooms (joined by the server)

| Room | Who | Joined |
|---|---|---|
| `user:{userId}` | every socket | automatically on connect |
| `role:{role}` | every socket | automatically |
| `staff` | warden, faculty, admin | automatically |
| `security` | security | automatically |
| `trip:{tripId}` | owner student, staff, admin, verified-linked parent **only while consent is active and trip ACTIVE/OVERDUE** | on `trip:subscribe` (authorised server-side) |
| `tracking:all` | staff, admin (live map) | on `tracking:subscribe_all` |

When consent is revoked or the trip completes, the server emits `tracking:stop` to `trip:{id}` and removes every **parent** socket from that room.

## Client → server

| Event | Payload | Ack |
|---|---|---|
| `trip:subscribe` | `{ tripId }` | `{ ok: true }` or `{ ok: false, error: "FORBIDDEN" \| "NOT_FOUND" \| "NO_CONSENT" }` |
| `trip:unsubscribe` | `{ tripId }` | `{ ok: true }` |
| `tracking:subscribe_all` | `{}` | `{ ok: true }` / `{ ok: false, error: "FORBIDDEN" }` |
| `tracking:unsubscribe_all` | `{}` | `{ ok: true }` |

## Server → client

| Event | Rooms | Payload |
|---|---|---|
| `notification` | `user:{id}` | `Notification` (`{ id, type, title, body, trip_id, data, created_at, read_at: null }`) |
| `trip:location` | `trip:{id}`, `tracking:all` | `{ tripId, studentId, studentName, rollNo, lat, lng, accuracy, speed, battery, recorded_at, status }` |
| `trip:event` | `trip:{id}`, `tracking:all`, `staff`, `user:{studentId}` | `{ tripId, studentId, type, at, data }` — `type`: `DEPARTED`, `LEFT_CAMPUS`, `REACHED_DESTINATION`, `RETURNED_CAMPUS`, `ENTERED`, `COMPLETED`, `OVERDUE`, `ESCALATED`, `SIGNAL_LOST`, `CONSENT_GRANTED`, `CONSENT_REVOKED` |
| `trip:status` | `trip:{id}`, `staff`, `user:{studentId}` | `{ tripId, requestId, status, requestStatus }` |
| `request:new` | `staff` | `Outpass` |
| `request:updated` | `staff`, `user:{studentId}` | `{ id, status, remarks, reviewed_by, tripId }` |
| `tracking:stop` | `trip:{id}`, `user:{studentId}` | `{ tripId, reason: "CONSENT_REVOKED" \| "TRIP_COMPLETED" \| "TRIP_CANCELLED" }` — student app must stop background location updates |
| `dashboard:refresh` | `staff` | `{ reason }` — hint to invalidate dashboard queries |

Parents receive `notification` events only for: `REQUEST_APPROVED`, `DEPARTED`, `REACHED_DESTINATION`, `RETURNED_CAMPUS`, `OVERDUE` (enforced server-side).
