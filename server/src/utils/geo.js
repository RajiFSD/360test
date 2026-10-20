const EARTH_RADIUS_M = 6371008.8;
const toRad = (deg) => (deg * Math.PI) / 180;

/** Great-circle distance in metres between two lat/lng points (Haversine). */
function haversine(lat1, lng1, lat2, lng2) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Ray-casting point-in-polygon. polygon: [[lat, lng], ...] */
function pointInPolygon(lat, lng, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [yi, xi] = polygon[i];
    const [yj, xj] = polygon[j];
    const intersects = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** Whether a point is inside a geofence ({ shape, center_lat, center_lng, radius_m, polygon }). */
function isInsideFence(lat, lng, fence) {
  if (!fence) return false;
  if (fence.shape === 'POLYGON' && Array.isArray(fence.polygon) && fence.polygon.length >= 3) {
    return pointInPolygon(lat, lng, fence.polygon);
  }
  return haversine(lat, lng, Number(fence.center_lat), Number(fence.center_lng)) <= Number(fence.radius_m || 0);
}

/** Approximate distance from a point to a fence boundary (0 if inside). */
function distanceToFence(lat, lng, fence) {
  if (isInsideFence(lat, lng, fence)) return 0;
  if (fence.shape === 'POLYGON' && Array.isArray(fence.polygon) && fence.polygon.length >= 3) {
    // Project to a local equirectangular plane (metres) and take the nearest edge.
    const kx = EARTH_RADIUS_M * Math.cos(toRad(lat));
    const proj = ([plat, plng]) => [toRad(plng - lng) * kx, toRad(plat - lat) * EARTH_RADIUS_M];
    const pts = fence.polygon.map(proj);
    let best = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const [ax, ay] = pts[i];
      const [bx, by] = pts[(i + 1) % pts.length];
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
      best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
    }
    return best;
  }
  const d = haversine(lat, lng, Number(fence.center_lat), Number(fence.center_lng)) - Number(fence.radius_m || 0);
  return Math.max(0, d);
}

module.exports = { haversine, pointInPolygon, isInsideFence, distanceToFence };
