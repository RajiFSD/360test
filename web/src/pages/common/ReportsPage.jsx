import { useState } from 'react';
import { CalendarDays, CheckCircle2, ClipboardList, Download, FileText, Timer } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useReportSummary } from '../../api/hooks';
import { reportsApi } from '../../api/endpoints';
import { Button, Card, Field, Input, PageHeader, Select, StatCard, Table, Td, Th } from '../../components/ui';
import { ErrorState } from '../../components/States';
import { SkeletonCards } from '../../components/Spinner';
import { ChartCard, LineSeriesChart, SimpleBarChart } from '../../components/charts';
import { STATUS_HEX } from '../../components/Badges';
import { REPORT_TYPES, humanize } from '../../lib/constants';
import { dayEndIso, dayStartIso, daysAgoLocal, formatMinutes, formatPercent, todayLocal } from '../../lib/format';
import { format, parseISO, isValid } from 'date-fns';

const shortDate = (d) => {
  const p = typeof d === 'string' ? parseISO(d) : d;
  return p && isValid(p) ? format(p, 'dd MMM') : d;
};

export default function ReportsPage() {
  const [from, setFrom] = useState(daysAgoLocal(29));
  const [to, setTo] = useState(todayLocal());
  const [exportType, setExportType] = useState('outpasses');
  const range = { from: dayStartIso(from), to: dayEndIso(to) };
  const q = useReportSummary(range);
  const invalidRange = from && to && from > to;

  const openExport = (fmt) => {
    window.open(reportsApi.exportUrl({ type: exportType, format: fmt, ...range }), '_blank', 'noopener');
  };

  const d = q.data;
  const byStatus = (d?.by_status || []).filter((s) => s.count > 0);
  const byCategory = (d?.by_category || []).map((c) => ({ ...c, label: humanize(c.category) }));

  return (
    <div className="space-y-6">
      <PageHeader title="Reports" subtitle="Outpass volumes, punctuality and approval speed." />

      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="From" htmlFor="r-from">
            <Input id="r-from" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="To" htmlFor="r-to">
            <Input id="r-to" type="date" value={to} min={from} max={todayLocal()} onChange={(e) => setTo(e.target.value)} />
          </Field>
          <div className="flex flex-wrap gap-1">
            {[7, 30, 90].map((n) => (
              <Button
                key={n}
                size="sm"
                variant="ghost"
                onClick={() => {
                  setFrom(daysAgoLocal(n - 1));
                  setTo(todayLocal());
                }}
              >
                Last {n} days
              </Button>
            ))}
          </div>
          <div className="ml-auto flex flex-wrap items-end gap-2">
            <Field label="Export" htmlFor="r-type">
              <Select id="r-type" value={exportType} onChange={(e) => setExportType(e.target.value)}>
                {REPORT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Button variant="secondary" icon={Download} onClick={() => openExport('csv')} disabled={invalidRange}>
              CSV
            </Button>
            <Button variant="secondary" icon={FileText} onClick={() => openExport('pdf')} disabled={invalidRange}>
              PDF
            </Button>
          </div>
        </div>
        {invalidRange && <p className="mt-2 text-sm text-red-600">“From” must be before “To”.</p>}
      </Card>

      {q.isPending ? (
        <SkeletonCards count={3} className="lg:grid-cols-3" />
      ) : q.isError ? (
        <Card>
          <ErrorState error={q.error} onRetry={q.refetch} />
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard label="Total requests" value={d.total ?? 0} icon={ClipboardList} tone="indigo" />
            <StatCard label="Avg. approval time" value={formatMinutes(d.avg_approval_minutes)} icon={Timer} tone="amber" />
            <StatCard label="On-time return rate" value={formatPercent(d.on_time_rate, 1)} icon={CheckCircle2} tone="green" />
          </div>

          <ChartCard title="Requests per day" subtitle="Submitted, approved and late returns" empty={!d.by_day?.length} height={300}>
            <LineSeriesChart
              data={d.by_day || []}
              xKey="date"
              xFormatter={shortDate}
              series={[
                { key: 'requests', name: 'Requests' },
                { key: 'approved', name: 'Approved' },
                { key: 'late', name: 'Late returns' },
              ]}
            />
          </ChartCard>

          <div className="grid gap-6 lg:grid-cols-2">
            <ChartCard title="By status" empty={!byStatus.length}>
              <SimpleBarChart
                data={byStatus}
                xKey="status"
                yKey="count"
                name="Requests"
                xFormatter={humanize}
                colorFor={(r) => STATUS_HEX[r.status] || '#64748b'}
              />
            </ChartCard>
            <ChartCard title="Late-return rate by category" empty={!byCategory.length}>
              <SimpleBarChart
                data={byCategory}
                xKey="label"
                yKey="late_rate"
                name="Late rate"
                layout="vertical"
                color="#eb6834"
                valueFormatter={(v) => formatPercent(v)}
                yDomain={[0, (max) => Math.max(max, 0.1)]}
              />
            </ChartCard>
          </div>

          <Card>
            <div className="border-b border-slate-100 px-4 py-3 sm:px-5">
              <h2 className="text-base font-semibold text-slate-900">Category breakdown</h2>
            </div>
            <Table>
              <thead>
                <tr>
                  <Th>Category</Th>
                  <Th className="text-right">Requests</Th>
                  <Th className="text-right">Late rate</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {byCategory.length ? (
                  byCategory.map((c) => (
                    <tr key={c.category}>
                      <Td>{c.label}</Td>
                      <Td className="text-right tabular-nums">{c.count}</Td>
                      <Td className="text-right tabular-nums">{formatPercent(c.late_rate, 1)}</Td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <Td colSpan={3} className="text-center text-slate-500">
                      No data
                    </Td>
                  </tr>
                )}
              </tbody>
            </Table>
          </Card>
        </>
      )}

      {!invalidRange && <DailyPassReport range={range} />}
    </div>
  );
}

/** Daily passes: counts, attendance (days used vs scheduled) and late / no-show rate per pass. */
function DailyPassReport({ range }) {
  const q = useQuery({ queryKey: ['reports', 'daily-passes', range], queryFn: () => reportsApi.dailyPasses(range) });
  if (q.isPending) return <SkeletonCards count={4} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} title="Could not load daily pass report" />;
  const d = q.data;
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-slate-900">Daily passes</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Daily passes" value={d.passes_total} icon={CalendarDays} tone="indigo" />
        <StatCard label="Days used / scheduled" value={`${d.days_used} / ${d.days_scheduled_to_date}`} hint={formatPercent(d.attendance_rate, 0)} icon={CheckCircle2} tone="green" />
        <StatCard label="Late days" value={d.days_late} hint={formatPercent(d.late_rate, 1)} icon={Timer} tone={d.days_late ? 'red' : 'slate'} />
        <StatCard label="No-show days" value={d.days_no_show} hint={formatPercent(d.no_show_rate, 1)} icon={ClipboardList} tone={d.days_no_show ? 'amber' : 'slate'} />
      </div>
      <Card>
        <Table>
          <thead>
            <tr>
              <Th>Student</Th>
              <Th>Place</Th>
              <Th>Status</Th>
              <Th className="text-right">Used / scheduled</Th>
              <Th className="text-right">Late</Th>
              <Th className="text-right">No-show</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {d.per_pass.length ? (
              d.per_pass.map((p) => (
                <tr key={p.id}>
                  <Td>
                    {p.student?.name} <span className="text-xs text-slate-500">{p.student?.roll_no}</span>
                  </Td>
                  <Td>{p.dest_name}</Td>
                  <Td>{humanize(p.status)}</Td>
                  <Td className="text-right tabular-nums">
                    {p.completed} / {p.scheduled_to_date} <span className="text-xs text-slate-500">({formatPercent(p.attendance_rate, 0)})</span>
                  </Td>
                  <Td className="text-right tabular-nums">
                    {p.late} <span className="text-xs text-slate-500">({formatPercent(p.late_rate, 0)})</span>
                  </Td>
                  <Td className="text-right tabular-nums">
                    {p.no_show} <span className="text-xs text-slate-500">({formatPercent(p.no_show_rate, 0)})</span>
                  </Td>
                </tr>
              ))
            ) : (
              <tr>
                <Td colSpan={6} className="text-center text-slate-500">
                  No daily passes in this period
                </Td>
              </tr>
            )}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
