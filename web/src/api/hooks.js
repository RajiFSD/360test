import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  adminApi,
  aiApi,
  authApi,
  dashboardApi,
  gateApi,
  geofenceApi,
  metaApi,
  notificationApi,
  outpassApi,
  parentApi,
  reportsApi,
  tripApi,
  usersApi,
} from './endpoints';

export const qk = {
  me: ['me'],
  departments: ['meta', 'departments'],
  hostels: ['meta', 'hostels'],
  publicSettings: ['meta', 'public-settings'],
  campus: ['geofences', 'campus'],
  notifications: (params) => ['notifications', 'list', params],
  unreadCount: ['notifications', 'unread-count'],
  outpasses: (params) => ['outpasses', params],
  outpass: (id) => ['outpass', String(id)],
  trips: (params) => ['trips', 'list', params],
  liveTrips: ['trips', 'live'],
  overdueTrips: ['trips', 'overdue'],
  trip: (id) => ['trip', String(id)],
  tripQr: (id) => ['trip', String(id), 'qr'],
  tripLocations: (id) => ['trip', String(id), 'locations'],
  dashboard: (kind) => ['dashboard', kind],
  users: (params) => ['users', 'list', params],
  userHistory: (id) => ['users', 'history', String(id)],
  parentStudents: ['parent', 'students'],
  gateLogs: (params) => ['gate', 'logs', params],
  geofences: (params) => ['geofences', 'list', params],
  reports: (params) => ['reports', params],
  insights: ['ai', 'insights'],
  adminDepartments: ['admin', 'departments'],
  adminHostels: ['admin', 'hostels'],
  adminLinks: (params) => ['admin', 'links', params],
  adminSettings: ['admin', 'settings'],
  auditLogs: (params) => ['admin', 'audit-logs', params],
};

// ---------- Meta ----------
export const useDepartments = () =>
  useQuery({ queryKey: qk.departments, queryFn: metaApi.departments, staleTime: 5 * 60_000 });
export const useHostels = () => useQuery({ queryKey: qk.hostels, queryFn: metaApi.hostels, staleTime: 5 * 60_000 });
export const usePublicSettings = () =>
  useQuery({ queryKey: qk.publicSettings, queryFn: metaApi.publicSettings, staleTime: 5 * 60_000 });
export const useCampus = () =>
  useQuery({ queryKey: qk.campus, queryFn: metaApi.campus, staleTime: 5 * 60_000, retry: 1 });

// ---------- Notifications ----------
export const useNotifications = (params, options = {}) =>
  useQuery({
    queryKey: qk.notifications(params),
    queryFn: () => notificationApi.list(params),
    placeholderData: keepPreviousData,
    ...options,
  });
export const useUnreadCount = () =>
  useQuery({ queryKey: qk.unreadCount, queryFn: notificationApi.unreadCount, refetchInterval: 60_000 });

export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: notificationApi.markRead,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
}
export function useMarkAllRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: notificationApi.readAll,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
}

// ---------- Dashboards ----------
export const useStudentDashboard = () => useQuery({ queryKey: qk.dashboard('student'), queryFn: dashboardApi.student });
export const useStaffDashboard = () => useQuery({ queryKey: qk.dashboard('staff'), queryFn: dashboardApi.staff });
export const useAdminDashboard = () => useQuery({ queryKey: qk.dashboard('admin'), queryFn: dashboardApi.admin });

// ---------- Outpasses ----------
export const useOutpasses = (params, options = {}) =>
  useQuery({
    queryKey: qk.outpasses(params),
    queryFn: () => outpassApi.list(params),
    placeholderData: keepPreviousData,
    ...options,
  });
export const useOutpass = (id) =>
  useQuery({ queryKey: qk.outpass(id), queryFn: () => outpassApi.get(id), enabled: !!id });

function useInvalidateOutpassData() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['outpasses'] });
    qc.invalidateQueries({ queryKey: ['outpass'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
    qc.invalidateQueries({ queryKey: ['trips'] });
    qc.invalidateQueries({ queryKey: ['trip'] });
  };
}

export function useCreateOutpass() {
  const inv = useInvalidateOutpassData();
  return useMutation({ mutationFn: outpassApi.create, onSuccess: inv });
}
export function useCancelOutpass() {
  const inv = useInvalidateOutpassData();
  return useMutation({ mutationFn: outpassApi.cancel, onSuccess: inv });
}
export function useApproveOutpass() {
  const inv = useInvalidateOutpassData();
  return useMutation({ mutationFn: ({ id, remarks }) => outpassApi.approve(id, remarks), onSuccess: inv });
}
export function useRejectOutpass() {
  const inv = useInvalidateOutpassData();
  return useMutation({ mutationFn: ({ id, remarks }) => outpassApi.reject(id, remarks), onSuccess: inv });
}
export function useBulkApprove() {
  const inv = useInvalidateOutpassData();
  return useMutation({ mutationFn: ({ ids, remarks }) => outpassApi.bulkApprove(ids, remarks), onSuccess: inv });
}

// ---------- AI ----------
export function usePredict() {
  return useMutation({ mutationFn: aiApi.predict });
}
export const useInsights = () => useQuery({ queryKey: qk.insights, queryFn: aiApi.insights });
export function useRetrain() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: aiApi.retrain,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ai'] }),
  });
}

// ---------- Trips ----------
export const useTrips = (params, options = {}) =>
  useQuery({ queryKey: qk.trips(params), queryFn: () => tripApi.list(params), ...options });
export const useLiveTrips = () => useQuery({ queryKey: qk.liveTrips, queryFn: tripApi.live, refetchInterval: 60_000 });
export const useOverdueTrips = () =>
  useQuery({ queryKey: qk.overdueTrips, queryFn: tripApi.overdue, refetchInterval: 60_000 });
export const useTrip = (id, options = {}) =>
  useQuery({ queryKey: qk.trip(id), queryFn: () => tripApi.get(id), enabled: !!id, ...options });
export const useTripQr = (id, enabled) =>
  useQuery({
    queryKey: qk.tripQr(id),
    queryFn: () => tripApi.qr(id),
    enabled: !!id && enabled,
    refetchInterval: 60_000,
    staleTime: 0,
  });
export const useTripLocations = (id, enabled = true) =>
  useQuery({
    queryKey: qk.tripLocations(id),
    queryFn: () => tripApi.locations(id, { limit: 500 }),
    enabled: !!id && enabled,
  });

function useInvalidateTrip() {
  const qc = useQueryClient();
  return (id) => {
    qc.invalidateQueries({ queryKey: ['trip', String(id)] });
    qc.invalidateQueries({ queryKey: ['outpass'] });
    qc.invalidateQueries({ queryKey: ['trips'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  };
}

export function useGrantConsent() {
  const inv = useInvalidateTrip();
  return useMutation({ mutationFn: tripApi.grantConsent, onSuccess: (_d, id) => inv(id) });
}
export function useRevokeConsent() {
  const inv = useInvalidateTrip();
  return useMutation({ mutationFn: tripApi.revokeConsent, onSuccess: (_d, id) => inv(id) });
}
export function useCheckin() {
  const inv = useInvalidateTrip();
  return useMutation({
    mutationFn: ({ id, ...body }) => tripApi.checkin(id, body),
    onSuccess: (_d, vars) => inv(vars.id),
  });
}
export function useNotifyTrip() {
  return useMutation({ mutationFn: ({ id, target, message }) => tripApi.notify(id, target, message) });
}

// ---------- Users ----------
export const useUsers = (params, options = {}) =>
  useQuery({
    queryKey: qk.users(params),
    queryFn: () => usersApi.list(params),
    placeholderData: keepPreviousData,
    ...options,
  });
export const useUserHistory = (id) =>
  useQuery({ queryKey: qk.userHistory(id), queryFn: () => usersApi.history(id), enabled: !!id });

function useInvalidateUsers() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['users'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  };
}
export function useCreateUser() {
  const inv = useInvalidateUsers();
  return useMutation({ mutationFn: usersApi.create, onSuccess: inv });
}
export function useUpdateUser() {
  const inv = useInvalidateUsers();
  return useMutation({ mutationFn: ({ id, body }) => usersApi.update(id, body), onSuccess: inv });
}
export function useDeactivateUser() {
  const inv = useInvalidateUsers();
  return useMutation({ mutationFn: usersApi.deactivate, onSuccess: inv });
}
export function useImportUsers() {
  const inv = useInvalidateUsers();
  return useMutation({ mutationFn: usersApi.import, onSuccess: inv });
}

// ---------- Profile ----------
export function useUpdateMe() {
  return useMutation({ mutationFn: authApi.updateMe });
}
export function useChangePassword() {
  return useMutation({
    mutationFn: ({ currentPassword, newPassword }) => authApi.changePassword(currentPassword, newPassword),
  });
}

// ---------- Parent ----------
export const useParentStudents = (options = {}) =>
  useQuery({ queryKey: qk.parentStudents, queryFn: parentApi.students, ...options });

// ---------- Gate ----------
export const useGateLogs = (params) =>
  useQuery({
    queryKey: qk.gateLogs(params),
    queryFn: () => gateApi.logs(params),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });

// ---------- Geofences ----------
export const useGeofences = (params) =>
  useQuery({ queryKey: qk.geofences(params), queryFn: () => geofenceApi.list(params) });
function useInvalidateGeofences() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['geofences'] });
}
export function useCreateGeofence() {
  const inv = useInvalidateGeofences();
  return useMutation({ mutationFn: geofenceApi.create, onSuccess: inv });
}
export function useUpdateGeofence() {
  const inv = useInvalidateGeofences();
  return useMutation({ mutationFn: ({ id, body }) => geofenceApi.update(id, body), onSuccess: inv });
}
export function useDeleteGeofence() {
  const inv = useInvalidateGeofences();
  return useMutation({ mutationFn: geofenceApi.remove, onSuccess: inv });
}

// ---------- Reports ----------
export const useReportSummary = (params) =>
  useQuery({
    queryKey: qk.reports(params),
    queryFn: () => reportsApi.summary(params),
    placeholderData: keepPreviousData,
  });

// ---------- Admin ----------
export const useAdminDepartments = () => useQuery({ queryKey: qk.adminDepartments, queryFn: adminApi.departments });
export const useAdminHostels = () => useQuery({ queryKey: qk.adminHostels, queryFn: adminApi.hostels });

function useInvalidateOrg() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['admin'] });
    qc.invalidateQueries({ queryKey: ['meta'] });
    qc.invalidateQueries({ queryKey: ['parent'] });
  };
}
export function useSaveDepartment() {
  const inv = useInvalidateOrg();
  return useMutation({
    mutationFn: ({ id, body }) => (id ? adminApi.updateDepartment(id, body) : adminApi.createDepartment(body)),
    onSuccess: inv,
  });
}
export function useDeleteDepartment() {
  const inv = useInvalidateOrg();
  return useMutation({ mutationFn: adminApi.deleteDepartment, onSuccess: inv });
}
export function useSaveHostel() {
  const inv = useInvalidateOrg();
  return useMutation({
    mutationFn: ({ id, body }) => (id ? adminApi.updateHostel(id, body) : adminApi.createHostel(body)),
    onSuccess: inv,
  });
}
export function useDeleteHostel() {
  const inv = useInvalidateOrg();
  return useMutation({ mutationFn: adminApi.deleteHostel, onSuccess: inv });
}

export const useAdminLinks = (params) =>
  useQuery({
    queryKey: qk.adminLinks(params),
    queryFn: () => adminApi.links(params),
    placeholderData: keepPreviousData,
  });
export function useCreateLink() {
  const inv = useInvalidateOrg();
  return useMutation({ mutationFn: adminApi.createLink, onSuccess: inv });
}
export function useUpdateLink() {
  const inv = useInvalidateOrg();
  return useMutation({ mutationFn: ({ id, body }) => adminApi.updateLink(id, body), onSuccess: inv });
}
export function useDeleteLink() {
  const inv = useInvalidateOrg();
  return useMutation({ mutationFn: adminApi.deleteLink, onSuccess: inv });
}

export const useAdminSettings = () => useQuery({ queryKey: qk.adminSettings, queryFn: adminApi.settings });
export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: adminApi.updateSettings,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.adminSettings });
      qc.invalidateQueries({ queryKey: qk.publicSettings });
    },
  });
}
export const useAuditLogs = (params) =>
  useQuery({
    queryKey: qk.auditLogs(params),
    queryFn: () => adminApi.auditLogs(params),
    placeholderData: keepPreviousData,
  });
