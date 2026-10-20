import axios from 'axios';
import { API_URL } from '../lib/config';
import {
  emitSessionExpired,
  getAccessToken,
  getRefreshToken,
  setTokens,
} from '../auth/tokens';

export const api = axios.create({
  baseURL: API_URL,
  timeout: 30000,
});

// A bare instance (no interceptors) for the refresh call itself.
const bare = axios.create({ baseURL: API_URL, timeout: 30000 });

api.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

let refreshPromise = null;

/**
 * Single-flight refresh. The refresh token is rotated on every call, so concurrent
 * callers must share one in-flight request and everybody stores the NEW pair.
 */
export function refreshTokens() {
  if (refreshPromise) return refreshPromise;
  const refreshToken = getRefreshToken();
  if (!refreshToken) {
    return Promise.reject(new Error('NO_REFRESH_TOKEN'));
  }
  refreshPromise = bare
    .post('/auth/refresh', { refreshToken })
    .then((res) => {
      const payload = res.data?.data || {};
      if (!payload.accessToken) throw new Error('REFRESH_FAILED');
      setTokens({ accessToken: payload.accessToken, refreshToken: payload.refreshToken });
      return payload.accessToken;
    })
    .finally(() => {
      refreshPromise = null;
    });
  return refreshPromise;
}

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    const status = error.response?.status;
    const code = error.response?.data?.error?.code;
    const isAuthCall = original?.url && /\/auth\/(login|refresh)$/.test(original.url);

    if (status === 401 && code === 'TOKEN_EXPIRED' && original && !original._retried && !isAuthCall) {
      original._retried = true;
      try {
        const token = await refreshTokens();
        original.headers = original.headers || {};
        original.headers.Authorization = `Bearer ${token}`;
        return api(original);
      } catch (refreshError) {
        emitSessionExpired();
        return Promise.reject(error);
      }
    }

    if (status === 401 && !isAuthCall && getAccessToken() && (code === 'UNAUTHORIZED' || original?._retried)) {
      emitSessionExpired();
    }
    // Account still on a temporary password (e.g. flag set after this session started).
    if (status === 403 && code === 'PASSWORD_CHANGE_REQUIRED' && window.location.pathname !== '/change-password') {
      window.location.assign('/change-password');
    }
    return Promise.reject(error);
  },
);

/** Extracts the `{ error: { code, message, details } }` envelope (or a network fallback). */
export function getApiError(err) {
  const e = err?.response?.data?.error;
  if (e) return { code: e.code, message: e.message || 'Request failed', details: e.details, status: err.response.status };
  if (err?.response) {
    return { code: 'HTTP_' + err.response.status, message: `Request failed (${err.response.status})`, status: err.response.status };
  }
  if (err?.code === 'ECONNABORTED') return { code: 'TIMEOUT', message: 'The server took too long to respond.' };
  if (err?.message === 'Network Error' || err?.request) {
    return { code: 'NETWORK_ERROR', message: 'Cannot reach the server. Check your connection and try again.' };
  }
  return { code: 'UNKNOWN', message: err?.message || 'Something went wrong' };
}

export function getErrorMessage(err) {
  const e = getApiError(err);
  if (e.code === 'VALIDATION_ERROR' && e.details) {
    const parts = Array.isArray(e.details)
      ? e.details.map((d) => (typeof d === 'string' ? d : d.message || d.msg)).filter(Boolean)
      : typeof e.details === 'object'
        ? Object.entries(e.details).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : typeof v === 'string' ? v : JSON.stringify(v)}`)
        : [];
    if (parts.length) return `${e.message} — ${parts.join('; ')}`;
  }
  return e.message;
}

/** GET returning `data` from the envelope. */
export async function getData(url, params) {
  const res = await api.get(url, { params: cleanParams(params) });
  return res.data?.data;
}

/** GET returning `{ items, meta }` for paginated lists. */
export async function getList(url, params) {
  const res = await api.get(url, { params: cleanParams(params) });
  const items = res.data?.data ?? [];
  return { items: Array.isArray(items) ? items : [], meta: res.data?.meta || null };
}

export async function send(method, url, body, config) {
  const res = await api.request({ method, url, data: body, ...config });
  return res.data?.data;
}

export function cleanParams(params) {
  if (!params) return undefined;
  const out = {};
  Object.entries(params).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '') return;
    out[k] = Array.isArray(v) ? v.join(',') : v;
  });
  return out;
}
