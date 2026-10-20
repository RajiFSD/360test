import { Link } from 'react-router-dom';
import clsx from 'clsx';
import {
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Circle,
  DoorClosed,
  DoorOpen,
  Home,
  MapPin,
  Phone,
} from 'lucide-react';
import { Avatar, Card } from './ui';
import { RiskBadge, StatusBadge } from './Badges';
import { DateTime } from './DateTime';
import { humanize } from '../lib/constants';
import { formatDateTime } from '../lib/format';

export function StudentInline({ student, size = 36, subtitle, className }) {
  if (!student) return <span className="text-slate-400">—</span>;
  return (
    <div className={clsx('flex min-w-0 items-center gap-3', className)}>
      <Avatar src={student.photo_url} name={student.name} size={size} />
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-slate-900">{student.name}</p>
        <p className="truncate text-xs text-slate-500">
          {subtitle ?? [student.roll_no, student.hostel || student.department].filter(Boolean).join(' · ')}
        </p>
      </div>
    </div>
  );
}

export function StudentPhone({ phone }) {
  if (!phone) return null;
  return (
    <a
      href={`tel:${phone}`}
      className="inline-flex items-center gap-1 text-sm font-medium text-indigo-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
    >
      <Phone className="h-3.5 w-3.5" aria-hidden="true" /> {phone}
    </a>
  );
}

/** Compact clickable card for an outpass in lists. */
export function OutpassListItem({ outpass, to, showStudent = false, showRisk = false }) {
  return (
    <Link
      to={to}
      className="flex flex-col gap-2 px-4 py-3 transition hover:bg-slate-50 focus:bg-slate-50 focus:outline-none sm:flex-row sm:items-center sm:gap-4 sm:px-5"
    >
      <div className="min-w-0 flex-1">
        {showStudent && outpass.student && <StudentInline student={outpass.student} size={32} className="mb-1.5" />}
        <p className="truncate text-sm font-medium text-slate-900">{outpass.reason}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-500">
          <span>{humanize(outpass.reason_category)}</span>
          <span className="inline-flex items-center gap-1">
            <CalendarClock className="h-3 w-3" aria-hidden="true" />
            {formatDateTime(outpass.depart_at)} → {formatDateTime(outpass.expected_return_at)}
          </span>
        </p>
      </div>
      <div className="flex items-center gap-2">
        {showRisk && <RiskBadge level={outpass.risk_level} score={outpass.risk_score} reasons={outpass.risk_reasons} />}
        <StatusBadge status={outpass.status} />
        <ArrowRight className="hidden h-4 w-4 text-slate-300 sm:block" aria-hidden="true" />
      </div>
    </Link>
  );
}

const EVENT_LABELS = {
  CREATED: 'Request submitted',
  SUBMITTED: 'Request submitted',
  REQUEST_SUBMITTED: 'Request submitted',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
  DEPARTED: 'Exited via gate',
  EXIT: 'Exited via gate',
  LEFT_CAMPUS: 'Left campus area',
  REACHED_DESTINATION: 'Reached destination',
  RETURNED_CAMPUS: 'Returned to campus area',
  ENTERED: 'Entered via gate',
  ENTRY: 'Entered via gate',
  COMPLETED: 'Trip completed',
  OVERDUE: 'Marked overdue',
  ESCALATED: 'Escalated',
  SIGNAL_LOST: 'Location signal lost',
  CONSENT_GRANTED: 'Location sharing started',
  CONSENT_REVOKED: 'Location sharing stopped',
  EXPIRED: 'Expired',
};

function eventTone(type) {
  if (['OVERDUE', 'ESCALATED', 'SIGNAL_LOST', 'REJECTED'].includes(type)) return 'bg-red-500';
  if (['COMPLETED', 'ENTERED', 'ENTRY', 'RETURNED_CAMPUS', 'REACHED_DESTINATION'].includes(type)) return 'bg-emerald-500';
  if (['APPROVED', 'DEPARTED', 'EXIT', 'LEFT_CAMPUS'].includes(type)) return 'bg-indigo-500';
  if (['CONSENT_GRANTED', 'CONSENT_REVOKED'].includes(type)) return 'bg-sky-500';
  return 'bg-slate-400';
}

/**
 * Merges `events: [{type, at, ...}]` and `gate_logs: [{type, scanned_at, guard, result}]` into one sorted timeline.
 */
export function Timeline({ events = [], gateLogs = [], extra = [] }) {
  const items = [
    ...(events || []).map((e, i) => ({
      key: `e-${i}`,
      type: e.type,
      at: e.at || e.created_at,
      label: EVENT_LABELS[e.type] || humanize(e.type),
      detail: e.note || e.message || e.data?.message || null,
    })),
    ...(gateLogs || []).map((g) => ({
      key: `g-${g.id}`,
      type: g.type,
      at: g.scanned_at,
      label: `Gate ${g.type === 'EXIT' ? 'exit' : 'entry'} scan${g.result && g.result !== 'OK' && g.result !== 'SUCCESS' ? ` (${humanize(g.result)})` : ''}`,
      detail: g.guard?.name ? `By ${g.guard.name}` : null,
      gate: true,
    })),
    ...extra,
  ]
    .filter((i) => i.at)
    .sort((a, b) => new Date(a.at) - new Date(b.at));

  if (!items.length) return <p className="text-sm text-slate-500">No activity recorded yet.</p>;

  return (
    <ol className="relative space-y-4 border-l-2 border-slate-100 pl-5">
      {items.map((it) => (
        <li key={it.key} className="relative">
          <span
            className={clsx('absolute -left-[27px] top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full ring-4 ring-white', eventTone(it.type))}
            aria-hidden="true"
          />
          <p className="flex items-center gap-1.5 text-sm font-medium text-slate-900">
            {it.gate && (it.type === 'EXIT' ? <DoorOpen className="h-4 w-4 text-slate-400" aria-hidden="true" /> : <DoorClosed className="h-4 w-4 text-slate-400" aria-hidden="true" />)}
            {it.label}
          </p>
          <p className="text-xs text-slate-500">
            <DateTime value={it.at} />
            {it.detail ? ` · ${it.detail}` : ''}
          </p>
        </li>
      ))}
    </ol>
  );
}

/** Progress steps for a trip: Approved → Exited → Reached → Returned → Completed. */
export function TripProgress({ trip }) {
  if (!trip) return null;
  const steps = [
    { label: 'Approved', done: true },
    { label: 'Exited', done: !!trip.exit_at, at: trip.exit_at },
    { label: 'Reached', done: !!trip.reached_destination_at, at: trip.reached_destination_at },
    { label: 'Returned', done: !!trip.returned_at || !!trip.entry_at, at: trip.returned_at || trip.entry_at },
    { label: 'Completed', done: trip.status === 'COMPLETED', at: trip.completed_at },
  ];
  return (
    <ol className="grid grid-cols-5 gap-1" aria-label="Trip progress">
      {steps.map((s) => (
        <li key={s.label} className="flex flex-col items-center text-center">
          {s.done ? (
            <CheckCircle2 className="h-5 w-5 text-emerald-600" aria-hidden="true" />
          ) : (
            <Circle className="h-5 w-5 text-slate-300" aria-hidden="true" />
          )}
          <span className={clsx('mt-1 text-[11px] font-medium', s.done ? 'text-slate-800' : 'text-slate-400')}>
            {s.label}
            <span className="sr-only">{s.done ? ' (done)' : ' (pending)'}</span>
          </span>
          {s.at && <span className="hidden text-[10px] text-slate-400 sm:block">{formatDateTime(s.at)}</span>}
        </li>
      ))}
    </ol>
  );
}

export function DestinationLine({ item }) {
  if (!item) return null;
  return (
    <p className="flex items-start gap-1.5 text-sm text-slate-700">
      {item.destination_type === 'HOME' ? (
        <Home className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
      ) : (
        <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
      )}
      <span>
        <span className="font-medium">{humanize(item.destination_type)}</span>
        {item.dest_address ? ` — ${item.dest_address}` : ''}
      </span>
    </p>
  );
}

export function SectionCard({ title, actions, children, className }) {
  return (
    <Card className={className}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3 sm:px-5">
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        {actions}
      </div>
      <div className="p-4 sm:p-5">{children}</div>
    </Card>
  );
}
