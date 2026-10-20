import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCheck, ClipboardList, Search } from 'lucide-react';
import { useBulkApprove, useOutpasses } from '../../api/hooks';
import { getErrorMessage } from '../../api/client';
import { Button, Card, Field, Input, PageHeader, Select, Table, Td, Textarea, Th } from '../../components/ui';
import { EmptyState, ErrorState } from '../../components/States';
import { SkeletonList } from '../../components/Spinner';
import { Pagination } from '../../components/Pagination';
import { RiskBadge, StatusBadge } from '../../components/Badges';
import { StudentInline } from '../../components/domain';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { OUTPASS_STATUSES, PASS_TYPES, RISK_LEVELS, humanize } from '../../lib/constants';
import { DailyBadge, dayLabels } from '../../components/DailyPass';
import { formatDateTime } from '../../lib/format';

export default function StaffRequestsPage() {
  const [sp, setSp] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const status = sp.get('status') ?? 'PENDING';
  const risk = sp.get('risk_level') || '';
  const passType = sp.get('pass_type') || '';
  const page = Number(sp.get('page') || 1);
  const [q, setQ] = useState(sp.get('q') || '');
  const [selected, setSelected] = useState(() => new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkRemarks, setBulkRemarks] = useState('');
  const bulk = useBulkApprove();

  // Debounce the search box into the URL.
  useEffect(() => {
    const t = setTimeout(() => {
      if ((sp.get('q') || '') !== q) update({ q, page: 1 });
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  function update(patch) {
    const next = new URLSearchParams(sp);
    Object.entries(patch).forEach(([k, v]) => {
      if (v === '' || v === null || v === undefined) {
        if (k === 'status') next.set('status', '');
        else next.delete(k);
      } else next.set(k, String(v));
    });
    setSp(next, { replace: true });
    setSelected(new Set());
  }

  const params = { status, risk_level: risk, pass_type: passType, q: sp.get('q') || '', page, pageSize: 20 };
  const query = useOutpasses(params);
  const items = useMemo(() => query.data?.items || [], [query.data]);
  const selectable = items.filter((o) => o.status === 'PENDING');
  const allSelected = selectable.length > 0 && selectable.every((o) => selected.has(o.id));

  const toggle = (id) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const doBulk = () => {
    const ids = [...selected];
    bulk.mutate(
      { ids, remarks: bulkRemarks.trim() || undefined },
      {
        onSuccess: (r) => {
          const ok = r?.approved?.length ?? 0;
          const failed = r?.failed || [];
          if (failed.length) {
            toast.warning(
              `Approved ${ok}, ${failed.length} failed`,
              failed.map((f) => `#${f.id}: ${f.reason}`).join('; '),
              { duration: 10000 },
            );
          } else toast.success(`Approved ${ok} request${ok === 1 ? '' : 's'}`);
          setSelected(new Set());
          setBulkOpen(false);
          setBulkRemarks('');
        },
        onError: (err) => toast.error('Bulk approve failed', getErrorMessage(err)),
      },
    );
  };

  return (
    <div>
      <PageHeader
        title="Outpass requests"
        subtitle="Review, approve or reject student requests. AI risk helps you prioritise."
        actions={
          <Button icon={CheckCheck} disabled={!selected.size} onClick={() => setBulkOpen(true)}>
            Approve selected{selected.size ? ` (${selected.size})` : ''}
          </Button>
        }
      />

      <Card className="mb-4 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Search" htmlFor="rq-q">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" aria-hidden="true" />
              <Input id="rq-q" className="pl-9" placeholder="Name, roll no, reason…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          </Field>
          <Field label="Status" htmlFor="rq-status">
            <Select id="rq-status" value={status} onChange={(e) => update({ status: e.target.value, page: 1 })}>
              <option value="">All statuses</option>
              {OUTPASS_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {humanize(s)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Pass type" htmlFor="rq-type">
            <Select id="rq-type" value={passType} onChange={(e) => update({ pass_type: e.target.value, page: 1 })}>
              <option value="">All pass types</option>
              {PASS_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="AI risk" htmlFor="rq-risk">
            <Select id="rq-risk" value={risk} onChange={(e) => update({ risk_level: e.target.value, page: 1 })}>
              <option value="">Any risk</option>
              {RISK_LEVELS.map((r) => (
                <option key={r} value={r}>
                  {humanize(r)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Card>

      <Card>
        {query.isPending ? (
          <div className="p-5">
            <SkeletonList rows={6} />
          </div>
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={query.refetch} />
        ) : !items.length ? (
          <EmptyState icon={ClipboardList} title="No requests match these filters" />
        ) : (
          <>
            {/* Desktop table */}
            <Table className="hidden md:block">
              <thead>
                <tr>
                  <Th className="w-10">
                    <input
                      type="checkbox"
                      aria-label="Select all pending requests on this page"
                      className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      checked={allSelected}
                      disabled={!selectable.length}
                      onChange={() =>
                        setSelected(allSelected ? new Set() : new Set(selectable.map((o) => o.id)))
                      }
                    />
                  </Th>
                  <Th>Student</Th>
                  <Th>Reason</Th>
                  <Th>Pass type</Th>
                  <Th>Departure → Return</Th>
                  <Th>Risk</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {items.map((o) => (
                  <tr
                    key={o.id}
                    className="cursor-pointer hover:bg-slate-50"
                    onClick={() => navigate(`/staff/requests/${o.id}`)}
                  >
                    <Td onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        aria-label={`Select request ${o.id} from ${o.student?.name}`}
                        className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 disabled:opacity-30"
                        disabled={o.status !== 'PENDING'}
                        checked={selected.has(o.id)}
                        onChange={() => toggle(o.id)}
                      />
                    </Td>
                    <Td>
                      <StudentInline student={o.student} size={32} />
                    </Td>
                    <Td className="max-w-xs">
                      <a
                        href={`/staff/requests/${o.id}`}
                        onClick={(e) => {
                          e.preventDefault();
                          navigate(`/staff/requests/${o.id}`);
                        }}
                        className="block truncate font-medium text-slate-900 hover:text-indigo-700 focus:outline-none focus-visible:underline"
                      >
                        {o.reason}
                      </a>
                      <span className="text-xs text-slate-500">
                        {humanize(o.reason_category)} · {humanize(o.destination_type)}
                      </span>
                    </Td>
                    <Td>{o.pass_type === 'DAILY' ? <DailyBadge /> : <span className="text-xs text-slate-500">One-time</span>}</Td>
                    <Td className="whitespace-nowrap text-xs">
                      {o.pass_type === 'DAILY' && o.schedule ? (
                        <>
                          {dayLabels(o.schedule.days_of_week)} · {o.schedule.depart_time}–{o.schedule.return_time}
                          <br />
                          {o.schedule.start_date} → {o.schedule.end_date}
                        </>
                      ) : (
                        <>
                          {formatDateTime(o.depart_at)}
                          <br />
                          {formatDateTime(o.expected_return_at)}
                        </>
                      )}
                    </Td>
                    <Td>
                      <RiskBadge level={o.risk_level} score={o.risk_score} reasons={o.risk_reasons} />
                    </Td>
                    <Td>
                      <StatusBadge status={o.status} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>

            {/* Mobile list */}
            <ul className="divide-y divide-slate-100 md:hidden">
              {items.map((o) => (
                <li key={o.id} className="flex items-start gap-3 px-4 py-3">
                  <input
                    type="checkbox"
                    aria-label={`Select request ${o.id}`}
                    className="mt-2 h-5 w-5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 disabled:opacity-30"
                    disabled={o.status !== 'PENDING'}
                    checked={selected.has(o.id)}
                    onChange={() => toggle(o.id)}
                  />
                  <button type="button" className="min-w-0 flex-1 text-left focus:outline-none" onClick={() => navigate(`/staff/requests/${o.id}`)}>
                    <StudentInline student={o.student} size={32} />
                    <p className="mt-1.5 truncate text-sm font-medium text-slate-900">{o.reason}</p>
                    <p className="text-xs text-slate-500">
                      {o.pass_type === 'DAILY' && o.schedule
                        ? `${dayLabels(o.schedule.days_of_week)} ${o.schedule.depart_time}–${o.schedule.return_time}, ${o.schedule.start_date} → ${o.schedule.end_date}`
                        : `${formatDateTime(o.depart_at)} → ${formatDateTime(o.expected_return_at)}`}
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-2">
                      {o.pass_type === 'DAILY' && <DailyBadge />}
                      <RiskBadge level={o.risk_level} score={o.risk_score} reasons={o.risk_reasons} />
                      <StatusBadge status={o.status} />
                    </div>
                  </button>
                </li>
              ))}
            </ul>
            <Pagination meta={query.data.meta} page={page} onPageChange={(p) => update({ page: p })} />
          </>
        )}
      </Card>

      <Modal
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        title={`Approve ${selected.size} request${selected.size === 1 ? '' : 's'}?`}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setBulkOpen(false)}>
              Cancel
            </Button>
            <Button variant="success" icon={CheckCheck} loading={bulk.isPending} onClick={doBulk}>
              Approve
            </Button>
          </>
        }
      >
        <Field label="Remarks (optional)" htmlFor="bulk-remarks">
          <Textarea id="bulk-remarks" value={bulkRemarks} onChange={(e) => setBulkRemarks(e.target.value)} placeholder="Approved. Return on time." />
        </Field>
      </Modal>
    </div>
  );
}
