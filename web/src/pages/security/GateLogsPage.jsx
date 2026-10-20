import { useState } from 'react';
import clsx from 'clsx';
import { DoorClosed, DoorOpen, History } from 'lucide-react';
import { useGateLogs } from '../../api/hooks';
import { Card, Field, Input, PageHeader, Table, Td, Th } from '../../components/ui';
import { EmptyState, QueryState } from '../../components/States';
import { Pagination } from '../../components/Pagination';
import { StudentInline } from '../../components/domain';
import { humanize } from '../../lib/constants';
import { formatTime, todayLocal } from '../../lib/format';

export default function GateLogsPage() {
  const [date, setDate] = useState(todayLocal());
  const [page, setPage] = useState(1);
  const query = useGateLogs({ date, page, pageSize: 30 });
  const ok = (r) => !r || ['OK', 'SUCCESS', 'VALID', 'ALLOWED'].includes(String(r).toUpperCase());

  return (
    <div>
      <PageHeader title="Gate logs" subtitle="Every exit and entry recorded at the gate." />
      <Card className="mb-4 p-4">
        <Field label="Date" htmlFor="log-date" className="max-w-xs">
          <Input
            id="log-date"
            type="date"
            value={date}
            max={todayLocal()}
            onChange={(e) => {
              setDate(e.target.value);
              setPage(1);
            }}
          />
        </Field>
      </Card>
      <Card>
        <QueryState query={query} empty={<EmptyState icon={History} title="No gate activity on this day" />}>
          {(data) => (
            <>
              <Table>
                <thead>
                  <tr>
                    <Th>Time</Th>
                    <Th>Type</Th>
                    <Th>Student</Th>
                    <Th>Result</Th>
                    <Th>Guard</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {data.items.map((l) => (
                    <tr key={l.id}>
                      <Td className="whitespace-nowrap font-medium">{formatTime(l.scanned_at)}</Td>
                      <Td>
                        <span
                          className={clsx(
                            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold',
                            l.type === 'EXIT' ? 'bg-indigo-50 text-indigo-700' : 'bg-sky-50 text-sky-700',
                          )}
                        >
                          {l.type === 'EXIT' ? <DoorOpen className="h-3 w-3" aria-hidden="true" /> : <DoorClosed className="h-3 w-3" aria-hidden="true" />}
                          {l.type}
                        </span>
                      </Td>
                      <Td>{l.student ? <StudentInline student={l.student} size={28} /> : <span className="text-slate-400">Unknown</span>}</Td>
                      <Td>
                        <span className={clsx('text-xs font-semibold', ok(l.result) ? 'text-emerald-700' : 'text-red-700')}>
                          {humanize(l.result || 'OK')}
                        </span>
                      </Td>
                      <Td className="whitespace-nowrap">{l.guard?.name || '—'}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              <Pagination meta={data.meta} page={page} onPageChange={setPage} />
            </>
          )}
        </QueryState>
      </Card>
    </div>
  );
}
