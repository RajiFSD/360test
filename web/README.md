# SmartOutpass — Web client

React 18 + Vite SPA for students, wardens/faculty, security, parents and admins.
Talks to the API described in `../docs/API.md` and the realtime contract in `../docs/SOCKET_EVENTS.md`.

## Quick start

```bash
cd web
npm install
cp .env.example .env   # optional
npm run dev            # http://localhost:5173
```

The dev server proxies `/api`, `/uploads` and `/socket.io` (WebSocket) to the backend
(default `http://localhost:4000`), so run the server in `../server` alongside it.

Students and parents can create an account at `/register`; an admin approves it under **Admin → Pending registrations**.

## Scripts

| Script            | Description                                      |
| ----------------- | ------------------------------------------------ |
| `npm run dev`     | Vite dev server on port 5173 with API proxy      |
| `npm run build`   | Production build into `dist/`                    |
| `npm run preview` | Serve the production build on port 4173 (proxied) |

## Environment variables

| Variable            | Default                  | Purpose                                                              |
| ------------------- | ------------------------ | -------------------------------------------------------------------- |
| `VITE_PROXY_TARGET` | `http://localhost:4000`  | Backend the dev/preview proxy forwards `/api`, `/uploads`, `/socket.io` to |
| `VITE_API_URL`      | `/api`                   | Axios base URL. Use a full URL (e.g. `http://localhost:4000/api`) to bypass the proxy |
| `VITE_SOCKET_URL`   | `window.location.origin` | Socket.IO origin (path `/socket.io`)                                |

## Notes

- Tokens live in `localStorage`; the Axios interceptor refreshes once on `401 TOKEN_EXPIRED`
  (single-flight, always storing the rotated refresh token) and logs out if refreshing fails.
- Browser location sharing works only while the trip page is open (foreground). Geolocation and the
  QR camera scanner require HTTPS or `localhost`.
- Map tiles come from OpenStreetMap.
