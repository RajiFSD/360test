/** Promise wrapper for navigator.geolocation.getCurrentPosition. */
export function getCurrentPosition(options = {}) {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error('Location is not supported by this browser.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(pos),
      (err) => reject(new Error(geoErrorMessage(err))),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 10000, ...options },
    );
  });
}

export function geoErrorMessage(err) {
  if (!err) return 'Could not get your location.';
  switch (err.code) {
    case 1:
      return 'Location permission was denied. Allow location access in your browser settings.';
    case 2:
      return 'Your location is currently unavailable.';
    case 3:
      return 'Timed out while getting your location. Try again.';
    default:
      return err.message || 'Could not get your location.';
  }
}

export async function getBatteryLevel() {
  try {
    if (typeof navigator !== 'undefined' && navigator.getBattery) {
      const b = await navigator.getBattery();
      return typeof b.level === 'number' ? Number(b.level.toFixed(2)) : undefined;
    }
  } catch {
    /* not supported */
  }
  return undefined;
}

/** Haversine distance in metres. */
export function distanceMeters(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
