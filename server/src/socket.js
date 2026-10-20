/**
 * Socket.IO server. Contract: docs/SOCKET_EVENTS.md
 */
const { Server } = require('socket.io');
const config = require('./config');
const db = require('./db');
const repo = require('./services/repo');
const { verifyAccessToken } = require('./utils/tokens');
const { setIo, rooms } = require('./realtime');

const STAFF = ['warden', 'faculty', 'admin'];

/** Can this user join trip:{id}? Returns null if yes, else an error code. */
async function tripRoomDenial(user, tripId) {
  const trip = await repo.getTripRaw(tripId);
  if (!trip) return 'NOT_FOUND';
  if (STAFF.includes(user.role)) return null;
  if (user.role === 'student') return trip.student_id === user.id ? null : 'FORBIDDEN';
  if (user.role === 'parent') {
    const linked = (await repo.linkedStudentIds(user.id)).includes(trip.student_id);
    if (!linked) return 'FORBIDDEN';
    if (!['ACTIVE', 'OVERDUE'].includes(trip.status)) return 'NO_CONSENT';
    return (await repo.getActiveConsent(tripId)) ? null : 'NO_CONSENT';
  }
  return 'FORBIDDEN';
}

function attachSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: config.corsOrigins, credentials: true },
    pingInterval: 25000,
    pingTimeout: 20000,
  });

  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token || String(socket.handshake.headers.authorization || '').replace(/^Bearer /, '');
    const r = verifyAccessToken(token || '');
    if (!r.ok) return next(new Error(r.code));
    const user = await db.one('SELECT id, role, name, is_active FROM users WHERE id = ?', [r.payload.sub]).catch(() => null);
    if (!user || !user.is_active) return next(new Error('UNAUTHORIZED'));
    socket.data.user = user;
    next();
  });

  io.on('connection', (socket) => {
    const user = socket.data.user;
    socket.join([rooms.user(user.id), `role:${user.role}`]);
    if (STAFF.includes(user.role)) socket.join(rooms.staff);
    if (user.role === 'security') socket.join(rooms.security);

    const ack = (cb, payload) => typeof cb === 'function' && cb(payload);

    socket.on('trip:subscribe', async (payload, cb) => {
      const tripId = Number(payload?.tripId);
      if (!Number.isInteger(tripId)) return ack(cb, { ok: false, error: 'NOT_FOUND' });
      try {
        const denial = await tripRoomDenial(user, tripId);
        if (denial) return ack(cb, { ok: false, error: denial });
        socket.join(rooms.trip(tripId));
        ack(cb, { ok: true });
      } catch {
        ack(cb, { ok: false, error: 'INTERNAL_ERROR' });
      }
    });

    socket.on('trip:unsubscribe', (payload, cb) => {
      socket.leave(rooms.trip(Number(payload?.tripId)));
      ack(cb, { ok: true });
    });

    socket.on('tracking:subscribe_all', (payload, cb) => {
      if (!STAFF.includes(user.role)) return ack(cb, { ok: false, error: 'FORBIDDEN' });
      socket.join(rooms.trackingAll);
      ack(cb, { ok: true });
    });

    socket.on('tracking:unsubscribe_all', (payload, cb) => {
      socket.leave(rooms.trackingAll);
      ack(cb, { ok: true });
    });
  });

  setIo(io);
  return io;
}

module.exports = { attachSocket, tripRoomDenial };
