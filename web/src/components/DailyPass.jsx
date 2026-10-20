import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, CalendarOff, MapPin, Pause, Play, QrCode, ShieldOff, XCircle } from 'lucide-react';
import { outpassApi } from '../api/endpoints';
import { getErrorMessage } from '../api/client';
import { Badge, Button, Field, KeyValue, LinkButton, Textarea } from './ui';
import { StatusBadge } from './Badges';
import { ConfirmDialog, Modal } from './Modal';
import { useToast } from './Toast';
import { WEEKDAYS } from '../lib/constants';
import { formatTime } from '../lib/format';

export const dayLabels = (days = []) => WEEKDAYS.filter((d) => days.includes(d.value)).map((d) => d.label).join(', ');

export function DailyBadge() {
  return <Badge className="bg-violet-50 text-violet-800 ring-violet-600/30">Daily pass</Badge>;
}

/** Schedule summary: place, weekdays, times, date range, status and attendance. */
export function ScheduleSummary({ schedule, showStats = true }) {
  if (!schedule) return null;
  const st = schedule.stats;
  return (
    <dl className="grid gap-4 sm:grid-cols-2">
      <KeyValue label="Place">{schedule.dest_name}</KeyValue>
      <KeyValue label="Pass status">
        <StatusBadge status={schedule.status} />
      </KeyValue>
      <KeyValue label="Days">{dayLabels(schedule.days_of_week)}</KeyValue>
      <KeyValue label="Daily window">
        {schedule.depart_time} – {schedule.return_time}
      </KeyValue>
      <KeyValue label="Dates">
        {schedule.start_date} → {schedule.end_date} ({schedule.total_days} days)
      </KeyValue>
      <KeyValue label="Location sharing">{schedule.consent_active ? 'On for scheduled windows' : 'Off'}</KeyValue>
      {showStats && st && (
        <KeyValue label="Attendance so far" className="sm:col-span-2">
          <span className="flex flex-wrap gap-2 text-sm">
            <Badge className="bg-slate-100 text-slate-700 ring-slate-300">{st.scheduled_to_date} scheduled</Badge>
            <Badge className="bg-emerald-50 text-emerald-800 ring-emerald-600/30">{st.completed} completed</Badge>
            <Badge className="bg-red-50 text-red-700 ring-red-600/30">{st.late} late</Badge>
            <Badge className="bg-slate-100 text-slate-600 ring-slate-400/40">{st.no_show} no-show</Badge>
          </span>
        </KeyValue>
      )}
      {schedule.status_note && (
        <KeyValue label="Note" className="sm:col-span-2">
          {schedule.status_note}
        </KeyValue>
      )}
    </dl>
  );
}

/** Student home: one card per running daily pass — today's trip or "No trip scheduled today". */
export function TodayTripCard({ entry }) {
  const { outpass, today_trip: trip, day } = entry;
  const sc = outpass.schedule;
  return (
    <div className="overflow-hidden rounded-xl border border-violet-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 bg-violet-600 px-4 py-3 text-white sm:px-5">
        <p className="flex items-center gap-2 font-semibold">
          <CalendarDays className="h-5 w-5" aria-hidden="true" /> Today's trip · {sc.dest_name}
        </p>
        {trip ? <StatusBadge status={trip.status} className="bg-white" /> : <StatusBadge status={sc.status} className="bg-white" />}
      </div>
      <div className="space-y-3 p-4 sm:p-5">
        {trip ? (
          <>
            <p className="text-sm text-slate-700">
              Window <span className="font-semibold">{formatTime(trip.window_start)} – {formatTime(trip.window_end)}</span>
              {day?.total ? <span className="text-slate-500"> · Day {day.day} of {day.total}</span> : null}
            </p>
            <LinkButton to={`/student/requests/${outpass.id}`} icon={QrCode}>
              {['APPROVED', 'ACTIVE', 'OVERDUE'].includes(trip.status) ? "Show today's QR" : 'View pass'}
            </LinkButton>
          </>
        ) : (
          <>
            <p className="flex items-center gap-2 text-sm text-slate-600">
              <CalendarOff className="h-4 w-4" aria-hidden="true" />
              {sc.status === 'PAUSED' ? 'This pass is paused.' : 'No trip scheduled today.'}
            </p>
            <p className="text-xs text-slate-500">
              {dayLabels(sc.days_of_week)} · {sc.depart_time}–{sc.return_time} · until {sc.end_date}
            </p>
            <LinkButton to={`/student/requests/${outpass.id}`} variant="secondary">
              View pass
            </LinkButton>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Pass controls. Student: pause/resume, cancel future days, pass-level location consent.
 * Staff: pause/resume, revoke (stops all future days).
 */
export function DailyPassControls({ outpass, staff = false }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState(null); // 'cancel'
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [remarks, setRemarks] = useState('');
  const sc = outpass.schedule;
  const done = (msg) => () => {
    toast.success(msg);
    setConfirm(null);
    setRevokeOpen(false);
    qc.invalidateQueries();
  };
  const fail = (title) => (err) => toast.error(title, getErrorMessage(err));
  const pause = useMutation({ mutationFn: () => outpassApi.pause(outpass.id), onSuccess: done('Pass paused'), onError: fail('Could not pause') });
  const resume = useMutation({ mutationFn: () => outpassApi.resume(outpass.id), onSuccess: done('Pass resumed'), onError: fail('Could not resume') });
  const cancel = useMutation({ mutationFn: () => outpassApi.cancel(outpass.id), onSuccess: done('Pass cancelled'), onError: fail('Could not cancel') });
  const revoke = useMutation({ mutationFn: () => outpassApi.revoke(outpass.id, remarks.trim()), onSuccess: done('Pass revoked'), onError: fail('Could not revoke') });
  const consentOn = useMutation({ mutationFn: () => outpassApi.grantPassConsent(outpass.id), onSuccess: done('Location sharing turned on'), onError: fail('Could not update consent') });
  const consentOff = useMutation({ mutationFn: () => outpassApi.revokePassConsent(outpass.id), onSuccess: done('Location sharing turned off'), onError: fail('Could not update consent') });

  if (!sc) return null;
  const running = outpass.status === 'APPROVED' && ['ACTIVE', 'PAUSED'].includes(sc.status);
  const canCancel = !staff && (outpass.status === 'PENDING' || running);

  return (
    <div className="flex flex-wrap gap-2">
      {running && sc.status === 'ACTIVE' && (
        <Button variant="secondary" icon={Pause} loading={pause.isPending} onClick={() => pause.mutate()}>
          Pause pass
        </Button>
      )}
      {running && sc.status === 'PAUSED' && (
        <Button variant="secondary" icon={Play} loading={resume.isPending} onClick={() => resume.mutate()}>
          Resume pass
        </Button>
      )}
      {!staff && ['PENDING', 'APPROVED'].includes(outpass.status) && (
        sc.consent_active ? (
          <Button variant="secondary" icon={ShieldOff} loading={consentOff.isPending} onClick={() => consentOff.mutate()}>
            Stop location sharing
          </Button>
        ) : (
          <Button variant="secondary" icon={MapPin} loading={consentOn.isPending} onClick={() => consentOn.mutate()}>
            Share location during trips
          </Button>
        )
      )}
      {canCancel && (
        <Button variant="secondary" icon={XCircle} onClick={() => setConfirm('cancel')}>
          Cancel pass
        </Button>
      )}
      {staff && running && (
        <Button variant="danger" icon={XCircle} onClick={() => setRevokeOpen(true)}>
          Revoke pass
        </Button>
      )}

      <ConfirmDialog
        open={confirm === 'cancel'}
        onClose={() => setConfirm(null)}
        title="Cancel this daily pass?"
        message="All future days are cancelled. If you are already out today, that trip finishes normally."
        confirmLabel="Cancel pass"
        cancelLabel="Keep it"
        loading={cancel.isPending}
        onConfirm={() => cancel.mutate()}
      />
      <Modal
        open={revokeOpen}
        onClose={() => setRevokeOpen(false)}
        title="Revoke this daily pass?"
        description="Stops all future days. A trip already in progress finishes normally. The student is notified."
        footer={
          <>
            <Button variant="secondary" onClick={() => setRevokeOpen(false)}>
              Keep pass
            </Button>
            <Button variant="danger" loading={revoke.isPending} disabled={remarks.trim().length < 3} onClick={() => revoke.mutate()}>
              Revoke pass
            </Button>
          </>
        }
      >
        <Field label="Reason" htmlFor="revoke-remarks" required hint="Shown to the student.">
          <Textarea id="revoke-remarks" value={remarks} onChange={(e) => setRemarks(e.target.value)} maxLength={500} />
        </Field>
      </Modal>
    </div>
  );
}
