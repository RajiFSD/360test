import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, ClipboardList, Clock, Percent, Timer } from 'lucide-react';
import { useUserHistory } from '../../api/hooks';
import { Button, Card, KeyValue, PageHeader, StatCard } from '../../components/ui';
import { EmptyState, ErrorState } from '../../components/States';
import { SkeletonCards, SkeletonList } from '../../components/Spinner';
import { OutpassListItem, StudentInline, StudentPhone } from '../../components/domain';
import { formatMinutes, formatPercent } from '../../lib/format';

export default function StudentHistoryPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const q = useUserHistory(id);
  const back = (
    <Button variant="ghost" size="sm" icon={ArrowLeft} className="-ml-2 mb-2" onClick={() => navigate(-1)}>
      Back
    </Button>
  );

  if (q.isPending)
    return (
      <div className="space-y-6">
        <PageHeader back={back} title="Student history" />
        <SkeletonCards count={5} className="lg:grid-cols-5" />
        <Card className="p-5">
          <SkeletonList rows={5} />
        </Card>
      </div>
    );
  if (q.isError)
    return (
      <div>
        <PageHeader back={back} title="Student history" />
        <Card>
          <ErrorState error={q.error} onRetry={q.refetch} />
        </Card>
      </div>
    );

  const { student, stats = {}, outpasses = [] } = q.data;

  return (
    <div className="space-y-6">
      <PageHeader back={back} title={student?.name || 'Student'} subtitle="Outpass history and punctuality." />
      <Card className="p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-6">
          <StudentInline student={student} size={64} />
          <dl className="grid flex-1 grid-cols-2 gap-4 sm:grid-cols-4">
            <KeyValue label="Roll no">{student?.roll_no}</KeyValue>
            <KeyValue label="Department">{student?.department}</KeyValue>
            <KeyValue label="Hostel">{student?.hostel}</KeyValue>
            <KeyValue label="Phone">
              <StudentPhone phone={student?.phone} />
            </KeyValue>
          </dl>
        </div>
      </Card>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Total requests" value={stats.total ?? 0} icon={ClipboardList} tone="indigo" />
        <StatCard label="Completed" value={stats.completed ?? 0} icon={CheckCircle2} tone="green" />
        <StatCard label="Late returns" value={stats.late ?? 0} icon={Clock} tone={stats.late ? 'red' : 'slate'} />
        <StatCard label="Late rate" value={formatPercent(stats.late_rate)} icon={Percent} tone={stats.late_rate > 0.3 ? 'red' : 'amber'} />
        <StatCard label="Avg delay" value={formatMinutes(stats.avg_delay_min)} icon={Timer} tone="slate" />
      </div>
      <Card>
        <div className="border-b border-slate-100 px-4 py-3 sm:px-5">
          <h2 className="text-base font-semibold text-slate-900">Outpasses</h2>
        </div>
        {outpasses.length ? (
          <div className="divide-y divide-slate-100">
            {outpasses.map((o) => (
              <OutpassListItem key={o.id} outpass={o} to={`/staff/requests/${o.id}`} showRisk />
            ))}
          </div>
        ) : (
          <EmptyState title="No outpasses yet" />
        )}
      </Card>
    </div>
  );
}
