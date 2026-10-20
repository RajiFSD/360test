import { useNavigate } from 'react-router-dom';
import { Bell, ClipboardList, Map, TimerOff, Users } from 'lucide-react';
import { useAdminDashboard } from '../../api/hooks';
import { Card, LinkButton, PageHeader, StatCard } from '../../components/ui';
import { ErrorState } from '../../components/States';
import { SkeletonCards } from '../../components/Spinner';
import { ChartCard, SimpleBarChart } from '../../components/charts';
import { ROLES, ROLE_LABELS } from '../../lib/constants';

export default function AdminDashboard() {
  const q = useAdminDashboard();
  const navigate = useNavigate();
  const d = q.data;
  const roleData = d ? ROLES.map((r) => ({ role: ROLE_LABELS[r], count: d.users_by_role?.[r] ?? 0 })) : [];
  const totalUsers = roleData.reduce((s, r) => s + r.count, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Admin dashboard"
        subtitle="System-wide overview."
        actions={
          <>
            <LinkButton to="/admin/users" variant="secondary" icon={Users}>
              Manage users
            </LinkButton>
            <LinkButton to="/reports" icon={ClipboardList}>
              Reports
            </LinkButton>
          </>
        }
      />
      {q.isPending ? (
        <SkeletonCards count={5} className="lg:grid-cols-5" />
      ) : q.isError ? (
        <Card>
          <ErrorState error={q.error} onRetry={q.refetch} />
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <StatCard label="Users" value={totalUsers} icon={Users} tone="indigo" onClick={() => navigate('/admin/users')} />
            <StatCard label="Outpasses today" value={d.outpasses_today} icon={ClipboardList} tone="blue" onClick={() => navigate('/staff/requests?status=')} />
            <StatCard label="Active trips" value={d.active_trips} icon={Map} tone="green" onClick={() => navigate('/staff/live')} />
            <StatCard label="Overdue trips" value={d.overdue_trips} icon={TimerOff} tone="red" onClick={() => navigate('/staff/overdue')} />
            <StatCard label="Notifications today" value={d.notifications_today} icon={Bell} tone="amber" />
          </div>
          <ChartCard title="Users by role" empty={!totalUsers}>
            <SimpleBarChart data={roleData} xKey="role" yKey="count" name="Users" />
          </ChartCard>
        </>
      )}
    </div>
  );
}
