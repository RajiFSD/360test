import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, Search } from 'lucide-react';
import { outpassApi } from '../../api/endpoints';
import { Badge, Card, Field, Input, PageHeader, Table, Tabs, Td, Th } from '../../components/ui';
import { QueryState, EmptyState } from '../../components/States';
import { StatusBadge } from '../../components/Badges';
import { StudentInline } from '../../components/domain';
import { DailyPassControls, dayLabels } from '../../components/DailyPass';

const TABS = [
  { value: 'RUNNING', label: 'Running' },
  { value: 'PAUSED', label: 'Paused' },
  { value: 'CANCELLED', label: 'Revoked / cancelled' },
  { value: 'EXPIRED', label: 'Ended' },
];

function Attendance({ stats }) {
  if (!stats) return <span className="text-slate-400">—</span>;
  return (
    <div className="flex flex-wrap gap-1.5 text-xs">
      <Badge className="bg-emerald-50 text-emerald-800 ring-emerald-600/30" title="Days used">
        {stats.completed}/{stats.scheduled_to_date} used
      </Badge>
      {stats.late > 0 && <Badge className="bg-red-50 text-red-700 ring-red-600/30">{stats.late} late</Badge>}
      {stats.no_show > 0 && <Badge className="bg-slate-100 text-slate-600 ring-slate-400/40">{stats.no_show} no-show</Badge>}
      {stats.in_progress > 0 && <Badge className="bg-indigo-50 text-indigo-700 ring-indigo-600/30">out now</Badge>}
    </div>
  );
}

export default function DailyPassesPage() {
  const [status, setStatus] = useState('RUNNING');
  const [q, setQ] = useState('');
  const query = useQuery({ queryKey: ['outpasses', 'daily', status, q], queryFn: () => outpassApi.dailyList({ status, q, pageSize: 100 }) });

  return (
    <div className="space-y-6">
      <PageHeader title="Daily passes" subtitle="Recurring passes: pause, resume or revoke, and see how many days were used, late or missed." />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <Tabs tabs={TABS} value={status} onChange={setStatus} />
        <Field label="Search" htmlFor="dp-q" className="sm:w-72">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" aria-hidden="true" />
            <Input id="dp-q" className="pl-9" placeholder="Name, roll no, place…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </Field>
      </div>
      <Card>
        <QueryState
          query={query}
          isEmpty={(d) => !d?.items?.length}
          empty={<EmptyState icon={CalendarDays} title="No daily passes here" message="Approved daily passes appear in Running." />}
        >
          {(d) => (
            <Table>
              <thead>
                <tr>
                  <Th>Student</Th>
                  <Th>Place</Th>
                  <Th>Schedule</Th>
                  <Th>Status</Th>
                  <Th>Attendance</Th>
                  <Th className="text-right">Actions</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {d.items.map((o) => (
                  <tr key={o.id}>
                    <Td>
                      <StudentInline student={o.student} size={32} />
                    </Td>
                    <Td>
                      <Link to={`/staff/requests/${o.id}`} className="font-medium text-slate-900 hover:text-indigo-700">
                        {o.schedule?.dest_name}
                      </Link>
                      <div className="text-xs text-slate-500">{o.reason}</div>
                    </Td>
                    <Td className="whitespace-nowrap text-xs">
                      {dayLabels(o.schedule?.days_of_week)} · {o.schedule?.depart_time}–{o.schedule?.return_time}
                      <br />
                      {o.schedule?.start_date} → {o.schedule?.end_date}
                    </Td>
                    <Td>
                      <StatusBadge status={o.schedule?.status} />
                    </Td>
                    <Td>
                      <Attendance stats={o.schedule?.stats} />
                    </Td>
                    <Td className="text-right">
                      <DailyPassControls outpass={o} staff />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </QueryState>
      </Card>
    </div>
  );
}
