import { Eye, EyeOff, History, MapPin, Users } from 'lucide-react';
import { useParentStudents } from '../../api/hooks';
import { Card, LinkButton, PageHeader } from '../../components/ui';
import { EmptyState, ErrorState } from '../../components/States';
import { SkeletonCards } from '../../components/Spinner';
import { StatusBadge } from '../../components/Badges';
import { DestinationLine, StudentInline, TripProgress } from '../../components/domain';
import { DateTime } from '../../components/DateTime';
import { humanize } from '../../lib/constants';

export default function ParentStudentsPage() {
  const q = useParentStudents();

  return (
    <div>
      <PageHeader title="My students" subtitle="Current outpass status for the students linked to your account." />
      {q.isPending ? (
        <SkeletonCards count={2} className="lg:grid-cols-2" />
      ) : q.isError ? (
        <Card>
          <ErrorState error={q.error} onRetry={q.refetch} />
        </Card>
      ) : !q.data?.length ? (
        <Card>
          <EmptyState
            icon={Users}
            title="No linked students yet"
            message="Ask the college administration to link your account to your child. Links must be verified before you see updates."
          />
        </Card>
      ) : (
        <ul className="grid gap-4 lg:grid-cols-2">
          {q.data.map(({ student, relation, current_trip: trip, tracking_visible: visible }) => (
            <li key={student.id}>
              <Card className="flex h-full flex-col p-4 sm:p-5">
                <div className="flex items-start justify-between gap-3">
                  <StudentInline student={student} size={52} />
                  {relation && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{humanize(relation)}</span>}
                </div>
                <div className="mt-4 flex-1">
                  {trip ? (
                    <div className="space-y-3 rounded-xl bg-slate-50 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-slate-900">{trip.reason || 'Current trip'}</p>
                        <StatusBadge status={trip.status} />
                      </div>
                      <DestinationLine item={trip} />
                      <p className="text-sm text-slate-600">
                        Expected back: <span className="font-medium text-slate-900"><DateTime value={trip.expected_return_at} /></span>
                      </p>
                      <TripProgress trip={trip} />
                      <p className={`flex items-center gap-1.5 text-xs font-medium ${visible ? 'text-emerald-700' : 'text-slate-500'}`}>
                        {visible ? <Eye className="h-4 w-4" aria-hidden="true" /> : <EyeOff className="h-4 w-4" aria-hidden="true" />}
                        {visible ? 'Live location is being shared' : 'Live location not shared for this trip'}
                      </p>
                    </div>
                  ) : (
                    <p className="rounded-xl bg-emerald-50 px-3 py-3 text-sm text-emerald-800">On campus — no active outpass.</p>
                  )}
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {trip && (
                    <LinkButton to={`/trips/${trip.id}`} icon={MapPin} size="sm" state={{ trackingVisible: visible }}>
                      {visible ? 'View live trip' : 'Trip details'}
                    </LinkButton>
                  )}
                  <LinkButton to={`/parent/students/${student.id}`} variant="secondary" icon={History} size="sm">
                    Trip history
                  </LinkButton>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
