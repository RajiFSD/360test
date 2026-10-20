import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, ClipboardList, Home, Map, ShieldAlert, TimerOff } from 'lucide-react';
import { useStaffDashboard } from '../../api/hooks';
import { Card, LinkButton, PageHeader, StatCard } from '../../components/ui';
import { EmptyState, ErrorState } from '../../components/States';
import { SkeletonCards, SkeletonList } from '../../components/Spinner';
import { OutpassListItem, StudentInline } from '../../components/domain';
import { DateTime } from '../../components/DateTime';
import { StatusBadge } from '../../components/Badges';

export default function StaffDashboard() {
  const q = useStaffDashboard();
  const navigate = useNavigate();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Staff dashboard"
        subtitle="Pending approvals, trips in progress and overdue students."
        actions={
          <LinkButton to="/staff/live" icon={Map} variant="secondary">
            Live map
          </LinkButton>
        }
      />
      {q.isPending ? (
        <>
          <SkeletonCards count={5} className="lg:grid-cols-5" />
          <Card className="p-5">
            <SkeletonList rows={4} />
          </Card>
        </>
      ) : q.isError ? (
        <Card>
          <ErrorState error={q.error} onRetry={q.refetch} />
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <StatCard label="Pending" value={q.data.pending_count} icon={ClipboardList} tone="amber" onClick={() => navigate('/staff/requests?status=PENDING')} />
            <StatCard label="High-risk pending" value={q.data.high_risk_pending} icon={ShieldAlert} tone="red" onClick={() => navigate('/staff/requests?status=PENDING&risk_level=HIGH')} />
            <StatCard label="Active trips" value={q.data.active_count} icon={Map} tone="indigo" onClick={() => navigate('/staff/live')} />
            <StatCard label="Overdue" value={q.data.overdue_count} icon={TimerOff} tone="red" onClick={() => navigate('/staff/overdue')} />
            <StatCard label="Returned today" value={q.data.returned_today} icon={Home} tone="green" />
          </div>

          <div className="grid gap-6 xl:grid-cols-5">
            <Card className="xl:col-span-3">
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 sm:px-5">
                <h2 className="text-base font-semibold text-slate-900">Pending approvals</h2>
                <Link to="/staff/requests?status=PENDING" className="text-sm font-medium text-indigo-700 hover:underline">
                  Review all
                </Link>
              </div>
              {q.data.pending?.length ? (
                <div className="divide-y divide-slate-100">
                  {q.data.pending.map((o) => (
                    <OutpassListItem key={o.id} outpass={o} to={`/staff/requests/${o.id}`} showStudent showRisk />
                  ))}
                </div>
              ) : (
                <EmptyState icon={ClipboardList} title="No pending requests" message="All caught up — nice work." />
              )}
            </Card>

            <Card className="xl:col-span-2">
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 sm:px-5">
                <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
                  <AlertTriangle className="h-4 w-4 text-red-600" aria-hidden="true" /> Overdue
                </h2>
                <Link to="/staff/overdue" className="text-sm font-medium text-indigo-700 hover:underline">
                  Manage
                </Link>
              </div>
              {q.data.overdue?.length ? (
                <ul className="divide-y divide-slate-100">
                  {q.data.overdue.map((t) => (
                    <li key={t.id}>
                      <Link to={`/trips/${t.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 focus:bg-slate-50 focus:outline-none sm:px-5">
                        <StudentInline student={t.student} size={32} className="flex-1" />
                        <div className="text-right">
                          <StatusBadge status={t.status} />
                          <p className="mt-1 text-xs text-slate-500">
                            due <DateTime value={t.expected_return_at} relative />
                          </p>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState icon={TimerOff} title="No overdue students" />
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
