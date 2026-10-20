export const API_URL = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');

export const SOCKET_URL =
  import.meta.env.VITE_SOCKET_URL ||
  (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:4000');

/** Origin of the API server (used to prefix /uploads/... paths). Empty string = same origin (proxy). */
export const API_ORIGIN = (() => {
  if (/^https?:\/\//i.test(API_URL)) {
    try {
      return new URL(API_URL).origin;
    } catch {
      return '';
    }
  }
  return '';
})();

/** Turns a server-relative asset URL ("/uploads/x.png") into an absolute/proxied URL. */
export function assetUrl(url) {
  if (!url) return url;
  if (/^(https?:|data:|blob:)/i.test(url)) return url;
  return `${API_ORIGIN}${url.startsWith('/') ? '' : '/'}${url}`;
}

export const CAMPUS_CENTER = [11.0168, 76.9558];
