import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { HomeRedirect, RequireAuth, RequireRole } from './auth/guards';
import AppLayout from './layouts/AppLayout';
import { FullPageSpinner } from './components/Spinner';
import LoginPage from './pages/common/LoginPage';

const NotFoundPage = lazy(() => import('./pages/common/NotFoundPage'));
const NotificationsPage = lazy(() => import('./pages/common/NotificationsPage'));
const ProfilePage = lazy(() => import('./pages/common/ProfilePage'));
const ChangePasswordPage = lazy(() => import('./pages/common/ChangePasswordPage'));
const TripDetailPage = lazy(() => import('./pages/common/TripDetailPage'));
const ReportsPage = lazy(() => import('./pages/common/ReportsPage'));
const InsightsPage = lazy(() => import('./pages/common/InsightsPage'));

const StudentDashboard = lazy(() => import('./pages/student/StudentDashboard'));
const NewRequestPage = lazy(() => import('./pages/student/NewRequestPage'));
const MyRequestsPage = lazy(() => import('./pages/student/MyRequestsPage'));
const StudentRequestDetail = lazy(() => import('./pages/student/StudentRequestDetail'));

const StaffDashboard = lazy(() => import('./pages/staff/StaffDashboard'));
const StaffRequestsPage = lazy(() => import('./pages/staff/StaffRequestsPage'));
const StaffRequestDetail = lazy(() => import('./pages/staff/StaffRequestDetail'));
const LiveMapPage = lazy(() => import('./pages/staff/LiveMapPage'));
const OverduePage = lazy(() => import('./pages/staff/OverduePage'));
const StudentsPage = lazy(() => import('./pages/staff/StudentsPage'));
const StudentHistoryPage = lazy(() => import('./pages/staff/StudentHistoryPage'));

const ScanPage = lazy(() => import('./pages/security/ScanPage'));
const ManualLookupPage = lazy(() => import('./pages/security/ManualLookupPage'));
const GateLogsPage = lazy(() => import('./pages/security/GateLogsPage'));

const ParentStudentsPage = lazy(() => import('./pages/parent/ParentStudentsPage'));
const ParentStudentHistory = lazy(() => import('./pages/parent/ParentStudentHistory'));

const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard'));
const UsersPage = lazy(() => import('./pages/admin/UsersPage'));
const LinksPage = lazy(() => import('./pages/admin/LinksPage'));
const OrgPage = lazy(() => import('./pages/admin/OrgPage'));
const GeofencesPage = lazy(() => import('./pages/admin/GeofencesPage'));
const SettingsPage = lazy(() => import('./pages/admin/SettingsPage'));
const AuditLogsPage = lazy(() => import('./pages/admin/AuditLogsPage'));
const ImportPage = lazy(() => import('./pages/admin/ImportPage'));

const STAFF = ['warden', 'faculty', 'admin'];

export default function App() {
  return (
    <Suspense fallback={<FullPageSpinner />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<HomeRedirect />} />
        <Route element={<RequireAuth />}>
          <Route path="/change-password" element={<ChangePasswordPage />} />
          <Route element={<AppLayout />}>
            <Route path="/notifications" element={<NotificationsPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/trips/:id" element={<TripDetailPage />} />

            <Route element={<RequireRole roles={['student']} />}>
              <Route path="/student" element={<StudentDashboard />} />
              <Route path="/student/requests" element={<MyRequestsPage />} />
              <Route path="/student/requests/new" element={<NewRequestPage />} />
              <Route path="/student/requests/:id" element={<StudentRequestDetail />} />
            </Route>

            <Route element={<RequireRole roles={STAFF} />}>
              <Route path="/staff" element={<StaffDashboard />} />
              <Route path="/staff/requests" element={<StaffRequestsPage />} />
              <Route path="/staff/requests/:id" element={<StaffRequestDetail />} />
              <Route path="/staff/live" element={<LiveMapPage />} />
              <Route path="/staff/overdue" element={<OverduePage />} />
              <Route path="/staff/students" element={<StudentsPage />} />
              <Route path="/staff/students/:id" element={<StudentHistoryPage />} />
              <Route path="/reports" element={<ReportsPage />} />
              <Route path="/insights" element={<InsightsPage />} />
            </Route>

            <Route element={<RequireRole roles={['security', 'admin']} />}>
              <Route path="/security/scan" element={<ScanPage />} />
              <Route path="/security/manual" element={<ManualLookupPage />} />
              <Route path="/security/logs" element={<GateLogsPage />} />
            </Route>

            <Route element={<RequireRole roles={['parent']} />}>
              <Route path="/parent" element={<ParentStudentsPage />} />
              <Route path="/parent/students/:id" element={<ParentStudentHistory />} />
            </Route>

            <Route element={<RequireRole roles={['admin']} />}>
              <Route path="/admin" element={<AdminDashboard />} />
              <Route path="/admin/users" element={<UsersPage />} />
              <Route path="/admin/import" element={<ImportPage />} />
              <Route path="/admin/links" element={<LinksPage />} />
              <Route path="/admin/org" element={<OrgPage />} />
              <Route path="/admin/geofences" element={<GeofencesPage />} />
              <Route path="/admin/settings" element={<SettingsPage />} />
              <Route path="/admin/audit-logs" element={<AuditLogsPage />} />
            </Route>

            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Route>
      </Routes>
    </Suspense>
  );
}
