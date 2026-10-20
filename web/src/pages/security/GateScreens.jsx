import clsx from 'clsx';
import { CheckCircle2, DoorClosed, DoorOpen, ShieldX } from 'lucide-react';
import { Avatar, Button, Field, Textarea } from '../../components/ui';
import { DateTime } from '../../components/DateTime';
import { StatusBadge } from '../../components/Badges';
import { humanize } from '../../lib/constants';

const QR_ERROR_TITLES = {
  QR_INVALID: 'Invalid QR code',
  QR_EXPIRED: 'QR code expired',
  QR_REVOKED: 'QR code revoked',
  QR_ALREADY_USED: 'QR code already used',
  PASS_NOT_APPROVED: 'Outpass not approved',
  OUTSIDE_TIME_WINDOW: 'Outside permitted time window',
  TRIP_CLOSED: 'Trip already closed',
  NOT_FOUND: 'Not found',
  VALIDATION_ERROR: 'Invalid input',
};

/** Big confirm screen after a successful verify. */
export function GateVerifyScreen({ result, onConfirm, onCancel, confirming, note, onNoteChange, showNote = false }) {
  const { action, student, outpass, trip } = result;
  const isExit = action === 'EXIT';
  const Icon = isExit ? DoorOpen : DoorClosed;
  const info = outpass || trip || {};
  const late = !isExit && info.expected_return_at && new Date(info.expected_return_at) < new Date();
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg">
      <div className={clsx('flex items-center justify-center gap-3 px-4 py-4 text-white', isExit ? 'bg-indigo-600' : 'bg-sky-600')}>
        <Icon className="h-8 w-8" aria-hidden="true" />
        <p className="text-2xl font-extrabold tracking-wide">{action}</p>
      </div>
      <div className="flex flex-col items-center gap-4 p-5 text-center sm:p-8">
        <Avatar src={student?.photo_url} name={student?.name} size={144} className="ring-4 ring-slate-100" />
        <div>
          <p className="text-2xl font-bold text-slate-900">{student?.name}</p>
          <p className="text-lg font-semibold text-slate-600">{student?.roll_no}</p>
          <p className="text-sm text-slate-500">{[student?.hostel, student?.department].filter(Boolean).join(' · ')}</p>
        </div>
        <dl className="grid w-full max-w-md gap-3 rounded-xl bg-slate-50 p-4 text-left text-sm sm:grid-cols-2">
          <div className="sm:col-span-2">
            <dt className="text-xs font-medium uppercase text-slate-500">Reason</dt>
            <dd className="font-medium text-slate-900">
              {info.reason || '—'} {info.reason_category && <span className="text-slate-500">({humanize(info.reason_category)})</span>}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase text-slate-500">Destination</dt>
            <dd className="text-slate-900">{info.dest_address || humanize(info.destination_type) || '—'}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase text-slate-500">Expected return</dt>
            <dd className={clsx('font-semibold', late ? 'text-red-700' : 'text-slate-900')}>
              <DateTime value={info.expected_return_at} />
              {late && <span className="block text-xs font-medium">Returning late</span>}
            </dd>
          </div>
          {trip?.status && (
            <div>
              <dt className="text-xs font-medium uppercase text-slate-500">Trip status</dt>
              <dd>
                <StatusBadge status={trip.status} />
              </dd>
            </div>
          )}
        </dl>
        {showNote && (
          <Field label="Note (optional)" htmlFor="gate-note" className="w-full max-w-md text-left">
            <Textarea id="gate-note" rows={2} value={note} onChange={(e) => onNoteChange(e.target.value)} placeholder="e.g. QR not readable, verified ID card" />
          </Field>
        )}
        <div className="flex w-full max-w-md flex-col gap-2 sm:flex-row-reverse">
          <Button size="xl" variant={isExit ? 'primary' : 'success'} className="flex-1" loading={confirming} onClick={onConfirm} icon={Icon} data-autofocus>
            Confirm {action}
          </Button>
          <Button size="lg" variant="secondary" onClick={onCancel} disabled={confirming}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}

export function GateSuccessScreen({ result, onNext }) {
  const { action, student, gate_log } = result;
  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl bg-emerald-600 px-5 py-10 text-center text-white shadow-lg" role="status" aria-live="assertive">
      <CheckCircle2 className="h-20 w-20" aria-hidden="true" />
      <p className="text-3xl font-extrabold">{action} recorded</p>
      <Avatar src={student?.photo_url} name={student?.name} size={96} className="ring-4 ring-white/40" />
      <div>
        <p className="text-xl font-bold">{student?.name}</p>
        <p className="text-emerald-100">{student?.roll_no}</p>
      </div>
      {gate_log?.scanned_at && (
        <p className="text-sm text-emerald-100">
          at <DateTime value={gate_log.scanned_at} />
        </p>
      )}
      <Button size="xl" variant="secondary" className="mt-2 min-w-[12rem] border-0 text-emerald-800" onClick={onNext} data-autofocus>
        Next scan
      </Button>
    </div>
  );
}

export function GateErrorScreen({ error, onNext, nextLabel = 'Scan again' }) {
  const student = error?.details?.student;
  const trip = error?.details?.trip;
  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl bg-red-600 px-5 py-10 text-center text-white shadow-lg" role="alert" aria-live="assertive">
      <ShieldX className="h-20 w-20" aria-hidden="true" />
      <p className="text-3xl font-extrabold">{QR_ERROR_TITLES[error?.code] || 'Not allowed'}</p>
      <p className="max-w-md text-lg text-red-50">{error?.message}</p>
      {student && (
        <div className="flex flex-col items-center gap-2 rounded-xl bg-white/10 px-6 py-4">
          <Avatar src={student.photo_url} name={student.name} size={88} className="ring-4 ring-white/30" />
          <p className="text-xl font-bold">{student.name}</p>
          <p className="text-red-100">{student.roll_no}</p>
          {trip?.status && <p className="text-sm text-red-100">Trip status: {humanize(trip.status)}</p>}
          {trip?.expected_return_at && (
            <p className="text-sm text-red-100">
              Expected return: <DateTime value={trip.expected_return_at} />
            </p>
          )}
        </div>
      )}
      <p className="text-xs uppercase tracking-wider text-red-200">Code: {error?.code}</p>
      <Button size="xl" variant="secondary" className="mt-2 min-w-[12rem] border-0 text-red-800" onClick={onNext} data-autofocus>
        {nextLabel}
      </Button>
    </div>
  );
}
