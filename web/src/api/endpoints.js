import { api, getData, getList, send } from './client';
import { API_URL } from '../lib/config';
import { getAccessToken, setTokens } from '../auth/tokens';

// ---------- Auth ----------
export const authApi = {
  login: (identifier, password) => send('post', '/auth/login', { identifier, password }),
  logout: (refreshToken) => send('post', '/auth/logout', { refreshToken }),
  me: () => getData('/auth/me'),
  updateMe: (body) => send('put', '/auth/me', body),
  changePassword: async (currentPassword, newPassword) => {
    const result = await send('post', '/auth/change-password', { currentPassword, newPassword });
    // The server signs out every session and hands this device a fresh pair.
    if (result?.accessToken) setTokens({ accessToken: result.accessToken, refreshToken: result.refreshToken });
    return result;
  },
};

// ---------- Bulk CSV import (admin) ----------
const csvForm = (file, extra = {}) => {
  const fd = new FormData();
  fd.append('file', file);
  Object.entries(extra).forEach(([k, v]) => v != null && v !== '' && fd.append(k, v));
  return fd;
};
export const importApi = {
  template: async (type) => (await api.get(`/admin/import/${type}/template`, { responseType: 'text' })).data,
  preview: async (type, file) => (await api.post(`/admin/import/${type}/preview`, csvForm(file))).data?.data,
  // Hashing a password per imported user can take a while for large files: no client timeout.
  commit: async (type, file, tempPassword) =>
    (await api.post(`/admin/import/${type}/commit`, csvForm(file, { temp_password: tempPassword }), { timeout: 0 })).data?.data,
};

// ---------- Meta ----------
export const metaApi = {
  departments: () => getData('/meta/departments'),
  hostels: () => getData('/meta/hostels'),
  publicSettings: () => getData('/settings/public'),
  campus: () => getData('/geofences/campus'),
};

// ---------- Uploads ----------
export async function uploadFile(file) {
  const fd = new FormData();
  fd.append('file', file);
  const res = await api.post('/uploads', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
  return res.data?.data; // { url }
}

// ---------- Users ----------
export const usersApi = {
  list: (params) => getList('/users', params),
  get: (id) => getData(`/users/${id}`),
  create: (body) => send('post', '/users', body),
  update: (id, body) => send('put', `/users/${id}`, body),
  deactivate: (id) => send('delete', `/users/${id}`),
  history: (id) => getData(`/users/${id}/history`),
  import: async (file) => {
    const fd = new FormData();
    fd.append('file', file);
    const res = await api.post('/users/import', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
    return res.data?.data;
  },
};

// ---------- Parent ----------
export const parentApi = {
  students: () => getData('/parent/students'),
};

// ---------- Outpasses ----------
export const outpassApi = {
  list: (params) => getList('/outpasses', params),
  get: (id) => getData(`/outpasses/${id}`),
  create: (body) => send('post', '/outpasses', body),
  cancel: (id) => send('post', `/outpasses/${id}/cancel`),
  approve: (id, remarks) => send('post', `/outpasses/${id}/approve`, remarks ? { remarks } : {}),
  reject: (id, remarks) => send('post', `/outpasses/${id}/reject`, { remarks }),
  bulkApprove: (ids, remarks) => send('post', '/outpasses/bulk-approve', remarks ? { ids, remarks } : { ids }),
};

// ---------- Trips ----------
export const tripApi = {
  list: (params) => getList('/trips', params),
  live: () => getData('/trips/live'),
  overdue: () => getData('/trips/overdue'),
  get: (id) => getData(`/trips/${id}`),
  qr: (id) => getData(`/trips/${id}/qr`),
  locations: (id, params) => getData(`/trips/${id}/locations`, params),
  postLocation: (id, body) => send('post', `/trips/${id}/location`, body),
  consent: (id) => getData(`/trips/${id}/consent`),
  grantConsent: (id) => send('post', `/trips/${id}/consent`, { scope: 'TRIP_LOCATION', accept: true }),
  revokeConsent: (id) => send('delete', `/trips/${id}/consent`),
  checkin: (id, body) => send('post', `/trips/${id}/checkin`, body),
  notify: (id, target, message) => send('post', `/trips/${id}/notify`, message ? { target, message } : { target }),
};

// ---------- Gate ----------
export const gateApi = {
  verify: (token) => send('post', '/gate/verify', { token }),
  scan: (token) => send('post', '/gate/scan', { token }),
  lookup: (roll_no) => getData('/gate/lookup', { roll_no }),
  manual: (trip_id, action, note) => send('post', '/gate/manual', note ? { trip_id, action, note } : { trip_id, action }),
  logs: (params) => getList('/gate/logs', params),
};

// ---------- Geofences ----------
export const geofenceApi = {
  list: (params) => getData('/geofences', params),
  create: (body) => send('post', '/geofences', body),
  update: (id, body) => send('put', `/geofences/${id}`, body),
  remove: (id) => send('delete', `/geofences/${id}`),
};

// ---------- Notifications ----------
export const notificationApi = {
  list: (params) => getList('/notifications', params),
  unreadCount: () => getData('/notifications/unread-count'),
  markRead: (id) => send('post', `/notifications/${id}/read`),
  readAll: () => send('post', '/notifications/read-all'),
};

// ---------- Dashboards ----------
export const dashboardApi = {
  staff: () => getData('/dashboard/staff'),
  student: () => getData('/dashboard/student'),
  admin: () => getData('/dashboard/admin'),
};

// ---------- Reports ----------
export const reportsApi = {
  summary: (params) => getData('/reports/summary', params),
  exportUrl: ({ type, format, from, to }) => {
    const qs = new URLSearchParams();
    qs.set('type', type);
    qs.set('format', format);
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    const token = getAccessToken();
    if (token) qs.set('access_token', token);
    return `${API_URL}/reports/export?${qs.toString()}`;
  },
};

// ---------- Admin ----------
export const adminApi = {
  departments: () => getData('/admin/departments'),
  createDepartment: (body) => send('post', '/admin/departments', body),
  updateDepartment: (id, body) => send('put', `/admin/departments/${id}`, body),
  deleteDepartment: (id) => send('delete', `/admin/departments/${id}`),
  hostels: () => getData('/admin/hostels'),
  createHostel: (body) => send('post', '/admin/hostels', body),
  updateHostel: (id, body) => send('put', `/admin/hostels/${id}`, body),
  deleteHostel: (id) => send('delete', `/admin/hostels/${id}`),
  links: (params) => getData('/admin/links', params),
  createLink: (body) => send('post', '/admin/links', body),
  updateLink: (id, body) => send('patch', `/admin/links/${id}`, body),
  deleteLink: (id) => send('delete', `/admin/links/${id}`),
  settings: () => getData('/admin/settings'),
  updateSettings: (body) => send('put', '/admin/settings', body),
  auditLogs: (params) => getList('/admin/audit-logs', params),
};

// ---------- AI ----------
export const aiApi = {
  predict: (body) => send('post', '/ai/predict', body),
  insights: () => getData('/ai/insights'),
  model: () => getData('/ai/model'),
  retrain: () => send('post', '/ai/retrain', {}, { timeout: 120000 }),
};
