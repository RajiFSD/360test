import { Link } from 'react-router-dom';
import { CheckCircle2, ClipboardList, Clock, FilePlus2, Plane } from 'lucide-react';
import { useStudentDashboard } from '../../api/hooks';
import { useAuth } from '../../auth/AuthContext';
import { Card, LinkButton, PageHeader, StatCard } from '../../components/ui';
import { EmptyState, ErrorState } from '../../components/States';
import { SkeletonCards, SkeletonList } from '../../components/Spinner';
import { RiskBadge, StatusBadge } from '../../components/Badges';
import { DestinationLine, OutpassListItem, TripProgress } from '../../components/domain';
import { DateTime } from '../../components/DateTime';
import { humanize } from '../../lib/constants';

export default function StudentDashboard() {
  const { user } = useAuth();
  const q = useStudentDashboard();

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Hi, ${user?.name?.split(' ')[0] || 'there'}`}
        subtitle="Your outpasses at a glance."
        actions={
          <LinkButton to={"/student/requests/new"} icon={FilePlus2}>
              New request
            </LinkButton>
        }
      />

      {q.isPending ? (
        <>
          <SkeletonCards count={3} />
          <Card className="p-5">
            <SkeletonList rows={3} />
          </Card>
        </>
      ) : q.isError ? (
        <Card>
          <ErrorState error={q.error} onRetry={q.refetch} />
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard label="Total requests" value={q.data.stats?.total ?? 0} icon={ClipboardList} tone="indigo" />
            <StatCard label="Completed trips" value={q.data.stats?.completed ?? 0} icon={CheckCircle2} tone="green" />
            <StatCard label="Late returns" value={q.data.stats?.late ?? 0} icon={Clock} tone={q.data.stats?.late ? 'red' : 'slate'} />
          </div>

          {q.data.active_outpass ? (
            <Card className="overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 bg-indigo-600 px-4 py-3 text-white sm:px-5">
                <p className="flex items-center gap-2 font-semibold">
                  <Plane className="h-5 w-5" aria-hidden="true" /> Current outpass
                </p>
                <StatusBadge status={q.data.active_outpass.status} className="bg-white" />
              </div>
              <div className="space-y-3 p-4 sm:p-5">
                <div>
                  <p className="text-lg font-semibold text-slate-900">{q.data.active_outpass.reason}</p>
                  <p className="text-sm text-slate-500">{humanize(q.data.active_outpass.reason_category)}</p>
                </div>
                <DestinationLine item={q.data.active_outpass} />
                <div className="grid gap-2 text-sm sm:grid-cols-2">
                  <p>
                    <span className="text-slate-500">Depart: </span>
                    <DateTime value={q.data.active_outpass.depart_at} />
                  </p>
                  <p>
                    <span className="text-slate-500">Return by: </span>
                    <span className="font-semibold">
                      <DateTime value={q.data.active_outpass.expected_return_at} />
                    </span>
                  </p>
                </div>
                {q.data.active_outpass.trip && <TripProgress trip={q.data.active_outpass.trip} />}
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <LinkButton to={`/student/requests/${q.data.active_outpass.id}`}>{q.data.active_outpass.trip ? 'Show QR & tracking' : 'View request'}</LinkButton>
                  {q.data.active_outpass.risk_level && (
                    <RiskBadge
                      level={q.data.active_outpass.risk_level}
                      score={q.data.active_outpass.risk_score}
                      reasons={q.data.active_outpass.risk_reasons}
                    />
                  )}
                </div>
              </div>
            </Card>
          ) : (
            <Card>
              <EmptyState
                icon={Plane}
                title="No active outpass"
                message="Planning to leave campus? Submit a request and track its approval here."
                action={
                  <LinkButton to={"/student/requests/new"} icon={FilePlus2}>
                      Request an outpass
                    </LinkButton>
                }
              />
            </Card>
          )}

          <Card>
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 sm:px-5">
              <h2 className="text-base font-semibold text-slate-900">Recent requests</h2>
              <Link to="/student/requests" className="text-sm font-medium text-indigo-700 hover:underline">
                View all
              </Link>
            </div>
            {q.data.recent?.length ? (
              <div className="divide-y divide-slate-100">
                {q.data.recent.map((o) => (
                  <OutpassListItem key={o.id} outpass={o} to={`/student/requests/${o.id}`} />
                ))}
              </div>
            ) : (
              <EmptyState title="No requests yet" message="Your outpass requests will appear here." />
            )}
          </Card>
        </>
      )}
    </div>
  );
}
