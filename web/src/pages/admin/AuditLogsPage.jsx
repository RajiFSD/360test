import { useEffect, useState } from 'react';
import { FileClock } from 'lucide-react';
import { useAuditLogs } from '../../api/hooks';
import { Card, Field, Input, PageHeader, Table, Td, Th } from '../../components/ui';
import { EmptyState, QueryState } from '../../components/States';
import { Pagination } from '../../components/Pagination';
import { RoleBadge } from '../../components/Badges';
import { DateTime } from '../../components/DateTime';

function useDebounced(value, ms = 350) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function DetailsCell({ details }) {
  if (details === null || details === undefined || details === '') return <span className="text-slate-400">—</span>;
  const text = typeof details === 'string' ? details : JSON.stringify(details);
  if (text.length <= 60) return <code className="break-all text-xs text-slate-600">{text}</code>;
  return (
    <details className="max-w-xs">
      <summary className="cursor-pointer text-xs font-medium text-indigo-700">View</summary>
      <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-slate-50 p-2 text-[11px] text-slate-700">
        {typeof details === 'string' ? details : JSON.stringify(details, null, 2)}
      </pre>
    </details>
  );
}

export default function AuditLogsPage() {
  const [action, setAction] = useState('');
  const [entity, setEntity] = useState('');
  const [actorId, setActorId] = useState('');
  const [page, setPage] = useState(1);
  const dAction = useDebounced(action.trim());
  const dEntity = useDebounced(entity.trim());
  const dActor = useDebounced(actorId.trim());

  useEffect(() => setPage(1), [dAction, dEntity, dActor]);

  const query = useAuditLogs({ action: dAction, entity: dEntity, actor_id: dActor, page, pageSize: 25 });

  return (
    <div>
      <PageHeader title="Audit logs" subtitle="Every sensitive action, who did it and when." />
      <Card className="mb-4 p-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Action" htmlFor="al-action">
            <Input id="al-action" placeholder="e.g. OUTPASS_APPROVED" value={action} onChange={(e) => setAction(e.target.value)} />
          </Field>
          <Field label="Entity" htmlFor="al-entity">
            <Input id="al-entity" placeholder="e.g. outpass, user, trip" value={entity} onChange={(e) => setEntity(e.target.value)} />
          </Field>
          <Field label="Actor ID" htmlFor="al-actor">
            <Input id="al-actor" type="number" min={1} placeholder="User ID" value={actorId} onChange={(e) => setActorId(e.target.value)} />
          </Field>
        </div>
      </Card>
      <Card>
        <QueryState query={query} empty={<EmptyState icon={FileClock} title="No audit entries match" />}>
          {(data) => (
            <>
              <Table>
                <thead>
                  <tr>
                    <Th>When</Th>
                    <Th>Actor</Th>
                    <Th>Action</Th>
                    <Th>Entity</Th>
                    <Th>Details</Th>
                    <Th className="hidden lg:table-cell">IP</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {data.items.map((l) => (
                    <tr key={l.id} className="align-top">
                      <Td className="whitespace-nowrap text-xs">
                        <DateTime value={l.created_at} />
                      </Td>
                      <Td>
                        {l.actor ? (
                          <div className="space-y-0.5">
                            <p className="text-sm font-medium text-slate-900">{l.actor.name}</p>
                            <RoleBadge role={l.actor.role} />
                          </div>
                        ) : (
                          <span className="text-xs text-slate-500">System</span>
                        )}
                      </Td>
                      <Td>
                        <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-800">{l.action}</code>
                      </Td>
                      <Td className="whitespace-nowrap text-xs">
                        {l.entity}
                        {l.entity_id != null && <span className="text-slate-500"> #{l.entity_id}</span>}
                      </Td>
                      <Td>
                        <DetailsCell details={l.details} />
                      </Td>
                      <Td className="hidden whitespace-nowrap text-xs text-slate-500 lg:table-cell">{l.ip || '—'}</Td>
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
