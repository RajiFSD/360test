import { Link } from 'react-router-dom';
import { Phone, RefreshCw, TimerOff } from 'lucide-react';
import { useOverdueTrips } from '../../api/hooks';
import { Button, Card, PageHeader } from '../../components/ui';
import { EmptyState, ErrorState } from '../../components/States';
import { SkeletonList } from '../../components/Spinner';
import { StudentInline, StudentPhone } from '../../components/domain';
import { DateTime } from '../../components/DateTime';
import { NotifyButtons } from './NotifyButtons';
import { formatMinutes } from '../../lib/format';

export default function OverduePage() {
  const q = useOverdueTrips();

  return (
    <div>
      <PageHeader
        title="Overdue students"
        subtitle="Students who have not returned by their expected time."
        actions={
          <Button variant="secondary" size="sm" icon={RefreshCw} loading={q.isFetching} onClick={() => q.refetch()}>
            Refresh
          </Button>
        }
      />
      {q.isPending ? (
        <Card className="p-5">
          <SkeletonList rows={4} />
        </Card>
      ) : q.isError ? (
        <Card>
          <ErrorState error={q.error} onRetry={q.refetch} />
        </Card>
      ) : !q.data?.length ? (
        <Card>
          <EmptyState icon={TimerOff} title="Nobody is overdue" message="Every student on a trip is within their return window." />
        </Card>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {q.data
            .slice()
            .sort((a, b) => (b.minutes_late ?? 0) - (a.minutes_late ?? 0))
            .map((t) => (
              <li key={t.id}>
                <Card className="border-red-200 p-4 sm:p-5">
                  <div className="flex items-start justify-between gap-3">
                    <StudentInline student={t.student} size={44} />
                    <div className="shrink-0 rounded-xl bg-red-50 px-3 py-1.5 text-center">
                      <p className="text-lg font-bold leading-tight text-red-700">{formatMinutes(t.minutes_late)}</p>
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-red-600">late</p>
                    </div>
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <dt className="text-xs text-slate-500">Expected back</dt>
                      <dd>
                        <DateTime value={t.expected_return_at} />
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-500">Last location</dt>
                      <dd>
                        <DateTime value={t.last_location?.recorded_at || t.last_ping_at} relative fallback="Not shared" />
                      </dd>
                    </div>
                    <div className="col-span-2">
                      <dt className="text-xs text-slate-500">Student phone</dt>
                      <dd>{t.student?.phone ? <StudentPhone phone={t.student.phone} /> : '—'}</dd>
                    </div>
                    <div className="col-span-2">
                      <dt className="text-xs text-slate-500">Parents</dt>
                      <dd>
                        {t.parents?.length ? (
                          <ul className="mt-1 space-y-1">
                            {t.parents.map((p) => (
                              <li key={p.id} className="flex flex-wrap items-center gap-2">
                                <span className="font-medium text-slate-800">{p.name}</span>
                                {p.phone && (
                                  <a
                                    href={`tel:${p.phone}`}
                                    className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-indigo-700 hover:bg-indigo-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                                    aria-label={`Call ${p.name} at ${p.phone}`}
                                  >
                                    <Phone className="h-3 w-3" aria-hidden="true" /> {p.phone}
                                  </a>
                                )}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <span className="text-slate-500">No linked parents</span>
                        )}
                      </dd>
                    </div>
                  </dl>
                  <div className="mt-4 flex flex-wrap items-end justify-between gap-3 border-t border-slate-100 pt-3">
                    <NotifyButtons tripId={t.id} compact />
                    <Link to={`/trips/${t.id}`} className="text-sm font-medium text-indigo-700 hover:underline">
                      Trip details
                    </Link>
                  </div>
                </Card>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}
