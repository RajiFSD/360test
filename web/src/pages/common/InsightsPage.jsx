import { useState } from 'react';
import { Link } from 'react-router-dom';
import { BrainCircuit, RefreshCcw, Timer } from 'lucide-react';
import { useInsights, useRetrain } from '../../api/hooks';
import { getErrorMessage } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { Button, Card, PageHeader, StatCard, Table, Td, Th } from '../../components/ui';
import { EmptyState, ErrorState } from '../../components/States';
import { SkeletonCards } from '../../components/Spinner';
import { ChartCard, SimpleBarChart } from '../../components/charts';
import { ConfirmDialog } from '../../components/Modal';
import { DateTime } from '../../components/DateTime';
import { useToast } from '../../components/Toast';
import { formatMinutes, formatNumber, formatPercent } from '../../lib/format';
import { humanize } from '../../lib/constants';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const hourLabel = (h) => {
  const n = Number(h);
  if (Number.isNaN(n)) return h;
  const suffix = n < 12 ? 'am' : 'pm';
  const hr = n % 12 === 0 ? 12 : n % 12;
  return `${hr}${suffix}`;
};
const dayLabel = (d) => (typeof d === 'number' ? DAY_NAMES[d]?.slice(0, 3) : String(d).slice(0, 3));

export default function InsightsPage() {
  const { user } = useAuth();
  const toast = useToast();
  const q = useInsights();
  const retrain = useRetrain();
  const [confirm, setConfirm] = useState(false);
  const d = q.data;
  const m = d?.model;

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI insights"
        subtitle="Patterns learned from past outpasses and the delay-risk model."
        actions={
          user?.role === 'admin' && (
            <Button icon={RefreshCcw} onClick={() => setConfirm(true)} loading={retrain.isPending}>
              Retrain model
            </Button>
          )
        }
      />

      {q.isPending ? (
        <SkeletonCards count={4} />
      ) : q.isError ? (
        <Card>
          <ErrorState error={q.error} onRetry={q.refetch} />
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Model version" value={m?.version || '—'} icon={BrainCircuit} tone="indigo" hint={m?.provider ? `Provider: ${m.provider}` : undefined} />
            <StatCard label="Accuracy" value={formatPercent(m?.metrics?.accuracy, 1)} icon={BrainCircuit} tone="green" hint={m?.metrics?.auc != null ? `AUC ${Number(m.metrics.auc).toFixed(3)}` : undefined} />
            <StatCard label="Delay MAE" value={m?.metrics?.mae_minutes != null ? formatMinutes(m.metrics.mae_minutes) : '—'} icon={Timer} tone="amber" hint={m?.metrics?.samples != null ? `${formatNumber(m.metrics.samples)} training samples` : undefined} />
            <StatCard label="Avg approval time" value={formatMinutes(d.avg_approval_minutes)} icon={Timer} tone="slate" />
          </div>
          {m?.trained_at && (
            <p className="-mt-3 text-xs text-slate-500">
              Last trained <DateTime value={m.trained_at} />
              {m.metrics?.logloss != null && ` · log-loss ${Number(m.metrics.logloss).toFixed(3)}`}
            </p>
          )}

          <div className="grid gap-6 lg:grid-cols-2">
            <ChartCard title="Peak departure hours" subtitle="Number of outpasses by hour of departure" empty={!d.peak_hours?.length}>
              <SimpleBarChart data={d.peak_hours || []} xKey="hour" yKey="count" name="Outpasses" xFormatter={hourLabel} />
            </ChartCard>
            <ChartCard title="Peak days" subtitle="Number of outpasses by weekday" empty={!d.peak_days?.length}>
              <SimpleBarChart data={d.peak_days || []} xKey="day" yKey="count" name="Outpasses" xFormatter={dayLabel} color="#1baf7a" />
            </ChartCard>
          </div>

          <ChartCard title="Late-return rate by category" empty={!d.late_rate_by_category?.length} height={300}>
            <SimpleBarChart
              data={(d.late_rate_by_category || []).map((c) => ({ ...c, label: humanize(c.category) }))}
              xKey="label"
              yKey="late_rate"
              name="Late rate"
              layout="vertical"
              color="#eb6834"
              valueFormatter={(v) => formatPercent(v)}
              yDomain={[0, (max) => Math.max(max, 0.1)]}
            />
          </ChartCard>

          <Card>
            <div className="border-b border-slate-100 px-4 py-3 sm:px-5">
              <h2 className="text-base font-semibold text-slate-900">Frequent late returners</h2>
            </div>
            {d.frequent_late_returners?.length ? (
              <Table>
                <thead>
                  <tr>
                    <Th>Student</Th>
                    <Th className="text-right">Trips</Th>
                    <Th className="text-right">Late</Th>
                    <Th className="text-right">Late rate</Th>
                    <Th className="text-right">Avg delay</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {d.frequent_late_returners.map((s) => (
                    <tr key={s.student_id}>
                      <Td>
                        <Link to={`/staff/students/${s.student_id}`} className="font-medium text-slate-900 hover:text-indigo-700">
                          {s.name}
                        </Link>
                        <span className="block text-xs text-slate-500">{s.roll_no}</span>
                      </Td>
                      <Td className="text-right tabular-nums">{s.trips}</Td>
                      <Td className="text-right tabular-nums">{s.late_trips}</Td>
                      <Td className="text-right tabular-nums font-semibold text-red-700">{formatPercent(s.late_rate)}</Td>
                      <Td className="text-right tabular-nums">{formatMinutes(s.avg_delay_min)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <EmptyState title="No frequent late returners" message="Great punctuality across the board." />
            )}
          </Card>
        </>
      )}

      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        variant="primary"
        title="Retrain the delay-risk model?"
        message="The model will be retrained on all historical trips. This may take a minute; predictions keep working meanwhile."
        confirmLabel="Retrain"
        loading={retrain.isPending}
        onConfirm={() =>
          retrain.mutate(undefined, {
            onSuccess: (r) => {
              setConfirm(false);
              toast.success('Model retrained', r?.version ? `New version ${r.version}${r.metrics?.accuracy != null ? ` · accuracy ${formatPercent(r.metrics.accuracy, 1)}` : ''}` : undefined);
            },
            onError: (e) => toast.error('Retraining failed', getErrorMessage(e)),
          })
        }
      />
    </div>
  );
}
