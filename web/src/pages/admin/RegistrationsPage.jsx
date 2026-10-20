import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, CheckCheck, Link2, UserPlus, X } from 'lucide-react';
import { registrationApi } from '../../api/endpoints';
import { getErrorMessage } from '../../api/client';
import { Badge, Button, Card, Checkbox, Field, PageHeader, Table, Tabs, Td, Textarea, Th } from '../../components/ui';
import { RoleBadge } from '../../components/Badges';
import { EmptyState, QueryState } from '../../components/States';
import { DateTime } from '../../components/DateTime';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';

const TABS = [
  { value: 'PENDING', label: 'Pending' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
];

function Children({ items }) {
  if (!items?.length) return <span className="text-slate-400">—</span>;
  return (
    <ul className="space-y-1">
      {items.map((c) => (
        <li key={c.roll_no} className="text-xs">
          <span className="font-medium text-slate-800">{c.roll_no}</span> <span className="text-slate-500">({c.relation})</span>{' '}
          {c.student ? (
            <span className="text-emerald-700">· {c.student.name}</span>
          ) : (
            <Badge className="bg-amber-50 text-amber-800 ring-amber-600/20">no matching student</Badge>
          )}
        </li>
      ))}
    </ul>
  );
}

export default function RegistrationsPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState('PENDING');
  const [selected, setSelected] = useState(new Set());
  const [rejecting, setRejecting] = useState(null); // registration row
  const [reason, setReason] = useState('');

  const query = useQuery({ queryKey: ['registrations', 'list', status], queryFn: () => registrationApi.list(status) });
  const rows = useMemo(() => query.data || [], [query.data]);
  const pending = status === 'PENDING';

  const refresh = () => {
    setSelected(new Set());
    queryClient.invalidateQueries({ queryKey: ['registrations'] });
    queryClient.invalidateQueries({ queryKey: ['users'] });
  };

  const approve = useMutation({
    mutationFn: (id) => registrationApi.approve(id),
    onSuccess: () => {
      toast.success('Registration approved', 'The user can now sign in.');
      refresh();
    },
    onError: (err) => toast.error('Could not approve', getErrorMessage(err)),
  });
  const reject = useMutation({
    mutationFn: ({ id, reason: r }) => registrationApi.reject(id, r),
    onSuccess: () => {
      toast.success('Registration rejected');
      setRejecting(null);
      setReason('');
      refresh();
    },
    onError: (err) => toast.error('Could not reject', getErrorMessage(err)),
  });
  const bulk = useMutation({
    mutationFn: (ids) => registrationApi.bulkApprove(ids),
    onSuccess: (r) => {
      toast.success(`Approved ${r.approved.length}`, r.failed.length ? `${r.failed.length} could not be approved` : undefined);
      refresh();
    },
    onError: (err) => toast.error('Bulk approve failed', getErrorMessage(err)),
  });

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggle = (id) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const busyId = approve.isPending ? approve.variables : null;
  const hasParents = rows.some((r) => r.role === 'parent');

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pending registrations"
        subtitle="Students and parents who registered themselves. Approve to activate the account; parent–child links are verified separately."
        actions={
          pending &&
          selected.size > 0 && (
            <Button icon={CheckCheck} loading={bulk.isPending} onClick={() => bulk.mutate([...selected])}>
              Approve {selected.size} selected
            </Button>
          )
        }
      />

      <Tabs
        tabs={TABS}
        value={status}
        onChange={(v) => {
          setStatus(v);
          setSelected(new Set());
        }}
      />

      {pending && hasParents && (
        <p className="flex items-center gap-2 rounded-lg bg-indigo-50 px-3 py-2 text-sm text-indigo-800">
          <Link2 className="h-4 w-4 shrink-0" aria-hidden="true" />
          After approving a parent, verify their child link on the{' '}
          <Link to="/admin/links" className="font-semibold underline">
            Parent links
          </Link>{' '}
          page. Until then the parent sees no student data.
        </p>
      )}

      <Card>
        <QueryState
          query={query}
          isEmpty={(d) => !d?.length}
          empty={
            <EmptyState
              icon={UserPlus}
              title={pending ? 'No pending registrations' : `No ${status.toLowerCase()} registrations`}
              message={pending ? 'New student and parent sign-ups will appear here.' : undefined}
            />
          }
        >
          {() => (
          <Table>
            <thead>
              <tr>
                {pending && (
                  <Th className="w-10">
                    <Checkbox
                      aria-label="Select all"
                      checked={allSelected}
                      onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))}
                    />
                  </Th>
                )}
                <Th>Name</Th>
                <Th>Role</Th>
                <Th>Roll no / children</Th>
                <Th>Email</Th>
                <Th>Phone</Th>
                <Th>Registered</Th>
                {!pending && <Th>{status === 'REJECTED' ? 'Reason' : 'Reviewed'}</Th>}
                {pending && <Th className="text-right">Actions</Th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {rows.map((r) => (
                <tr key={r.id} className={selected.has(r.id) ? 'bg-indigo-50/40' : undefined}>
                  {pending && (
                    <Td>
                      <Checkbox aria-label={`Select ${r.name}`} checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                    </Td>
                  )}
                  <Td className="font-medium text-slate-900">
                    {r.name}
                    {r.role === 'student' && (r.department || r.hostel) && (
                      <div className="text-xs font-normal text-slate-500">{[r.department, r.hostel].filter(Boolean).join(' · ')}</div>
                    )}
                  </Td>
                  <Td>
                    <RoleBadge role={r.role} />
                  </Td>
                  <Td>{r.role === 'student' ? <span className="font-medium">{r.roll_no}</span> : <Children items={r.children} />}</Td>
                  <Td className="break-all">{r.email}</Td>
                  <Td className="whitespace-nowrap">{r.phone || '—'}</Td>
                  <Td className="whitespace-nowrap">
                    <DateTime value={r.created_at} />
                  </Td>
                  {!pending && (
                    <Td className="text-xs text-slate-600">
                      {status === 'REJECTED' ? r.registration_note || '—' : <DateTime value={r.reviewed_at} />}
                      {r.reviewer && <div className="text-slate-400">by {r.reviewer}</div>}
                    </Td>
                  )}
                  {pending && (
                    <Td className="whitespace-nowrap text-right">
                      <div className="inline-flex gap-2">
                        <Button size="sm" variant="success" icon={Check} loading={busyId === r.id} onClick={() => approve.mutate(r.id)}>
                          Approve
                        </Button>
                        <Button size="sm" variant="secondary" icon={X} onClick={() => setRejecting(r)}>
                          Reject
                        </Button>
                      </div>
                    </Td>
                  )}
                </tr>
              ))}
            </tbody>
          </Table>
          )}
        </QueryState>
      </Card>

      <Modal
        open={!!rejecting}
        onClose={() => {
          setRejecting(null);
          setReason('');
        }}
        title={`Reject ${rejecting?.name || ''}?`}
        description="The account stays inactive. The reason (optional) is shown to the user when they try to sign in."
        footer={
          <>
            <Button variant="secondary" onClick={() => setRejecting(null)}>
              Cancel
            </Button>
            <Button variant="danger" icon={X} loading={reject.isPending} onClick={() => reject.mutate({ id: rejecting.id, reason: reason.trim() })}>
              Reject registration
            </Button>
          </>
        }
      >
        <Field label="Reason (optional)" htmlFor="reject-reason" hint="Max 500 characters.">
          <Textarea id="reject-reason" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Roll number does not match our records" />
        </Field>
      </Modal>
    </div>
  );
}
