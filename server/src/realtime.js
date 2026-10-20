/**
 * Thin holder for the Socket.IO server so services can emit without importing the HTTP layer.
 * All emit helpers are no-ops when no server is attached (scripts, tests).
 */
let io = null;

const setIo = (instance) => {
  io = instance;
};
const getIo = () => io;

function emitTo(rooms, event, payload) {
  if (!io) return;
  const list = (Array.isArray(rooms) ? rooms : [rooms]).filter(Boolean);
  if (!list.length) return;
  io.to(list).emit(event, payload);
}

const rooms = {
  user: (id) => `user:${id}`,
  trip: (id) => `trip:${id}`,
  staff: 'staff',
  security: 'security',
  trackingAll: 'tracking:all',
};

/** Remove parent sockets from a trip room (consent revoked / trip finished). */
async function evictParentsFromTrip(tripId) {
  if (!io) return;
  const sockets = await io.in(rooms.trip(tripId)).fetchSockets();
  for (const s of sockets) if (s.data?.user?.role === 'parent') s.leave(rooms.trip(tripId));
}

module.exports = { setIo, getIo, emitTo, rooms, evictParentsFromTrip };
