import clsx from 'clsx';
import { ShieldAlert, ShieldCheck, Shield } from 'lucide-react';
import { Badge } from './ui';
import { humanize } from '../lib/constants';

const STATUS_STYLES = {
  PENDING: 'bg-amber-50 text-amber-800 ring-amber-600/30',
  APPROVED: 'bg-sky-50 text-sky-800 ring-sky-600/30',
  ACTIVE: 'bg-indigo-50 text-indigo-800 ring-indigo-600/30',
  COMPLETED: 'bg-emerald-50 text-emerald-800 ring-emerald-600/30',
  OVERDUE: 'bg-red-100 text-red-800 ring-red-600/40',
  REJECTED: 'bg-rose-50 text-rose-800 ring-rose-400/40',
  CANCELLED: 'bg-slate-100 text-slate-600 ring-slate-400/40',
  EXPIRED: 'bg-slate-100 text-slate-600 ring-slate-400/40',
};

const STATUS_DOT = {
  PENDING: 'bg-amber-500',
  APPROVED: 'bg-sky-500',
  ACTIVE: 'bg-indigo-500',
  COMPLETED: 'bg-emerald-500',
  OVERDUE: 'bg-red-600',
  REJECTED: 'bg-rose-500',
  CANCELLED: 'bg-slate-400',
  EXPIRED: 'bg-slate-400',
};

/** Hex colours for maps/charts keyed by status. */
export const STATUS_HEX = {
  PENDING: '#d97706',
  APPROVED: '#0284c7',
  ACTIVE: '#4f46e5',
  COMPLETED: '#059669',
  OVERDUE: '#dc2626',
  REJECTED: '#e11d48',
  CANCELLED: '#94a3b8',
  EXPIRED: '#64748b',
};

export function StatusBadge({ status, className }) {
  if (!status) return null;
  return (
    <Badge className={clsx(STATUS_STYLES[status] || 'bg-slate-100 text-slate-700 ring-slate-300', className)}>
      <span className={clsx('h-1.5 w-1.5 rounded-full', STATUS_DOT[status] || 'bg-slate-400')} aria-hidden="true" />
      {humanize(status)}
    </Badge>
  );
}

const RISK_STYLES = {
  LOW: { cls: 'bg-emerald-50 text-emerald-800 ring-emerald-600/30', Icon: ShieldCheck },
  MEDIUM: { cls: 'bg-amber-50 text-amber-800 ring-amber-600/30', Icon: Shield },
  HIGH: { cls: 'bg-red-50 text-red-800 ring-red-600/30', Icon: ShieldAlert },
};

export function RiskBadge({ level, score, reasons, className, showScore = true }) {
  if (!level) return <span className="text-xs text-slate-400">—</span>;
  const s = RISK_STYLES[level] || RISK_STYLES.MEDIUM;
  const tooltip =
    reasons && reasons.length ? `${humanize(level)} risk${score != null ? ` (${score})` : ''}:\n• ${reasons.join('\n• ')}` : `${humanize(level)} risk`;
  return (
    <span className="group relative inline-flex">
      <Badge className={clsx(s.cls, className)} title={tooltip}>
        <s.Icon className="h-3 w-3" aria-hidden="true" />
        {humanize(level)}
        {showScore && score != null && <span className="font-normal opacity-80">· {score}</span>}
      </Badge>
      {reasons && reasons.length > 0 && (
        <span
          role="tooltip"
          className="pointer-events-none absolute left-0 top-full z-50 mt-1 hidden w-64 rounded-lg bg-slate-900 p-2.5 text-xs font-normal text-white shadow-lg group-hover:block"
        >
          <span className="mb-1 block font-semibold">Why {humanize(level).toLowerCase()} risk?</span>
          <ul className="list-disc space-y-0.5 pl-4">
            {reasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </span>
      )}
    </span>
  );
}

export function RoleBadge({ role }) {
  const styles = {
    admin: 'bg-violet-50 text-violet-800 ring-violet-600/30',
    warden: 'bg-indigo-50 text-indigo-800 ring-indigo-600/30',
    faculty: 'bg-sky-50 text-sky-800 ring-sky-600/30',
    security: 'bg-slate-100 text-slate-700 ring-slate-500/30',
    parent: 'bg-teal-50 text-teal-800 ring-teal-600/30',
    student: 'bg-amber-50 text-amber-800 ring-amber-600/30',
  };
  return <Badge className={styles[role] || styles.security}>{humanize(role)}</Badge>;
}
