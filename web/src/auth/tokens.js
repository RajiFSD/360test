const ACCESS_KEY = 'so_access_token';
const REFRESH_KEY = 'so_refresh_token';
const USER_KEY = 'so_user';

const listeners = new Set();

function safeGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function safeSet(key, value) {
  try {
    if (value === null || value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}

export function getAccessToken() {
  return safeGet(ACCESS_KEY);
}
export function getRefreshToken() {
  return safeGet(REFRESH_KEY);
}

export function setTokens({ accessToken, refreshToken }) {
  if (accessToken !== undefined) safeSet(ACCESS_KEY, accessToken);
  if (refreshToken !== undefined) safeSet(REFRESH_KEY, refreshToken);
  listeners.forEach((fn) => fn({ type: 'tokens', accessToken: getAccessToken() }));
}

export function clearTokens() {
  safeSet(ACCESS_KEY, null);
  safeSet(REFRESH_KEY, null);
  safeSet(USER_KEY, null);
}

export function getStoredUser() {
  const raw = safeGet(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
export function setStoredUser(user) {
  safeSet(USER_KEY, user ? JSON.stringify(user) : null);
}

/** Fired when the session can no longer be recovered (refresh failed). */
export function emitSessionExpired() {
  clearTokens();
  listeners.forEach((fn) => fn({ type: 'expired' }));
}

export function subscribeAuth(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
