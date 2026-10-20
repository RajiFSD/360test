import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Check, History, Paperclip, X } from 'lucide-react';
import { useApproveOutpass, useOutpass, useRejectOutpass, useUserHistory } from '../../api/hooks';
import { DailyBadge, DailyPassControls, ScheduleSummary } from '../../components/DailyPass';
import { getErrorMessage } from '../../api/client';
import { Button, Card, Field, KeyValue, LinkButton, PageHeader, Textarea } from '../../components/ui';
import { ErrorState } from '../../components/States';
import { SkeletonList } from '../../components/Spinner';
import { StatusBadge } from '../../components/Badges';
import { DestinationLine, SectionCard, StudentInline, StudentPhone, Timeline } from '../../components/domain';
import { AiPrediction } from '../../components/AiPreview';
import { Modal } from '../../components/Modal';
import { DateTime } from '../../components/DateTime';
import { useToast } from '../../components/Toast';
import { BaseMap, CampusLayer, DestinationCircle, FitBounds } from '../../components/map/MapBits';
import { assetUrl, CAMPUS_CENTER } from '../../lib/config';
import { humanize } from '../../lib/constants';
import { formatMinutes } from '../../lib/format';
import { distanceMeters } from '../../lib/geo';

/** The student's late-return record, shown when reviewing a daily pass. */
function StudentLateHistory({ studentId }) {
  const h = useUserHistory(studentId);
  if (h.isPending || h.isError || !h.data?.stats) return null;
  const s = h.data.stats;
  return (
    <p className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
      Past one-time trips: {s.completed} completed, <span className={s.late ? 'font-semibold text-red-700' : ''}>{s.late} late</span>
      {s.completed ? ` (${Math.round(s.late_rate * 100)}%)` : ''}
      {s.avg_delay_min ? ` · avg delay ${s.avg_delay_min} min` : ''} ·{' '}
      <Link to={`/staff/students/${studentId}`} className="font-medium text-indigo-700 hover:underline">
        full history
      </Link>
    </p>
  );
}

export default function StaffRequestDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const q = useOutpass(id);
  const approve = useApproveOutpass();
  const reject = useRejectOutpass();
  const [mode, setMode] = useState(null); // 'approve' | 'reject'
  const [remarks, setRemarks] = useState('');
  const [remarksError, setRemarksError] = useState(null);

  const back = (
    <Button variant="ghost" size="sm" icon={ArrowLeft} className="-ml-2 mb-2" onClick={() => navigate(-1)}>
      Back
    </Button>
  );

  if (q.isPending)
    return (
      <div>
        <PageHeader back={back} title="Request" />
        <Card className="p-5">
          <SkeletonList rows={5} />
        </Card>
      </div>
    );
  if (q.isError)
    return (
      <div>
        <PageHeader back={back} title="Request" />
        <Card>
          <ErrorState error={q.error} onRetry={q.refetch} />
        </Card>
      </div>
    );

  const o = q.data;
  const pending = o.status === 'PENDING';
  const distKm = o.dest_lat != null ? distanceMeters(CAMPUS_CENTER, [o.dest_lat, o.dest_lng]) / 1000 : null;
  const durationMin = (new Date(o.expected_return_at) - new Date(o.depart_at)) / 60000;

  const submit = () => {
    if (mode === 'reject' && !remarks.trim()) {
      setRemarksError('Remarks are required when rejecting');
      return;
    }
    const m = mode === 'approve' ? approve : reject;
    m.mutate(
      { id: o.id, remarks: remarks.trim() || undefined },
      {
        onSuccess: () => {
          toast.success(mode === 'approve' ? 'Request approved' : 'Request rejected', `${o.student?.name || 'The student'} has been notified.`);
          setMode(null);
          setRemarks('');
        },
        onError: (err) => toast.error('Action failed', getErrorMessage(err)),
      },
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader
        back={back}
        title={o.reason}
        subtitle={`Request #${o.id} · ${humanize(o.reason_category)}`}
        actions={
          <>
            <StatusBadge status={o.status} className="text-sm" />
            {o.trip && (
              <LinkButton to={`/trips/${o.trip.id}`} variant="secondary" size="sm">
                Open trip
              </LinkButton>
            )}
          </>
        }
      />

      {pending && (
        <Card className="flex flex-col gap-3 border-indigo-200 bg-indigo-50/40 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-slate-700">This request is awaiting your decision.</p>
          <div className="flex gap-2">
            <Button variant="danger" icon={X} onClick={() => { setMode('reject'); setRemarksError(null); }}>
              Reject
            </Button>
            <Button variant="success" icon={Check} onClick={() => { setMode('approve'); setRemarksError(null); }}>
              Approve
            </Button>
          </div>
        </Card>
      )}

      {o.pass_type === 'DAILY' && (
        <SectionCard title={<span className="flex items-center gap-2">Daily pass <DailyBadge /></span>} actions={<DailyPassControls outpass={o} staff />}>
          <ScheduleSummary schedule={o.schedule} />
          <StudentLateHistory studentId={o.student_id} />
        </SectionCard>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <SectionCard title="Request">
            <dl className="grid gap-4 sm:grid-cols-2">
              <KeyValue label="Reason" className="sm:col-span-2">
                {o.reason}
              </KeyValue>
              <KeyValue label="Destination" className="sm:col-span-2">
                <DestinationLine item={o} />
                {distKm != null && <span className="text-xs text-slate-500">≈ {distKm.toFixed(1)} km from campus centre</span>}
              </KeyValue>
              {o.pass_type !== 'DAILY' && (
                <>
                  <KeyValue label="Departure">
                    <DateTime value={o.depart_at} />
                  </KeyValue>
                  <KeyValue label="Expected return">
                    <DateTime value={o.expected_return_at} />
                  </KeyValue>
                  <KeyValue label="Duration">{formatMinutes(durationMin)}</KeyValue>
                </>
              )}
              <KeyValue label="Submitted">
                <DateTime value={o.created_at} />
              </KeyValue>
              {o.reviewer && (
                <KeyValue label="Reviewed by">
                  {o.reviewer.name} · <DateTime value={o.reviewed_at} />
                </KeyValue>
              )}
              {o.remarks && <KeyValue label="Remarks">{o.remarks}</KeyValue>}
              {o.attachment_url && (
                <KeyValue label="Attachment">
                  <a href={assetUrl(o.attachment_url)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-indigo-700 hover:underline">
                    <Paperclip className="h-4 w-4" aria-hidden="true" /> View attachment
                  </a>
                </KeyValue>
              )}
            </dl>
            {o.dest_lat != null && (
              <BaseMap className="mt-4 h-64" zoom={10} center={[o.dest_lat, o.dest_lng]} ariaLabel="Destination map">
                <CampusLayer />
                <DestinationCircle lat={o.dest_lat} lng={o.dest_lng} radius={300} label={o.dest_address} />
                <FitBounds points={[CAMPUS_CENTER, [o.dest_lat, o.dest_lng]]} fitKey={o.id} maxZoom={13} />
              </BaseMap>
            )}
          </SectionCard>
          <SectionCard title="Timeline">
            <Timeline events={o.events} gateLogs={o.gate_logs} />
          </SectionCard>
        </div>

        <div className="space-y-6">
          <SectionCard
            title="Student"
            actions={
              o.student && (
                <Link to={`/staff/students/${o.student.id}`} className="inline-flex items-center gap-1 text-sm font-medium text-indigo-700 hover:underline">
                  <History className="h-4 w-4" aria-hidden="true" /> History
                </Link>
              )
            }
          >
            <StudentInline student={o.student} size={56} />
            <dl className="mt-4 grid grid-cols-2 gap-3">
              <KeyValue label="Roll no">{o.student?.roll_no}</KeyValue>
              <KeyValue label="Department">{o.student?.department}</KeyValue>
              <KeyValue label="Hostel">{o.student?.hostel}</KeyValue>
              <KeyValue label="Phone">
                <StudentPhone phone={o.student?.phone} />
              </KeyValue>
            </dl>
          </SectionCard>
          <SectionCard title="AI risk assessment">
            <AiPrediction
              compact
              prediction={{
                risk_level: o.risk_level,
                risk_score: o.risk_score,
                reasons: o.risk_reasons,
                delay_probability: o.delay_probability,
                expected_delay_min: o.predicted_delay_min,
              }}
            />
          </SectionCard>
        </div>
      </div>

      <Modal
        open={!!mode}
        onClose={() => setMode(null)}
        title={mode === 'approve' ? 'Approve request' : 'Reject request'}
        description={`${o.student?.name || 'Student'} · ${o.reason}`}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setMode(null)}>
              Cancel
            </Button>
            <Button
              variant={mode === 'approve' ? 'success' : 'danger'}
              icon={mode === 'approve' ? Check : X}
              loading={approve.isPending || reject.isPending}
              onClick={submit}
            >
              {mode === 'approve' ? 'Approve' : 'Reject'}
            </Button>
          </>
        }
      >
        <Field
          label={mode === 'reject' ? 'Reason for rejection' : 'Remarks (optional)'}
          htmlFor="decision-remarks"
          required={mode === 'reject'}
          error={remarksError}
        >
          <Textarea
            id="decision-remarks"
            value={remarks}
            invalid={!!remarksError}
            onChange={(e) => {
              setRemarks(e.target.value);
              setRemarksError(null);
            }}
            placeholder={mode === 'reject' ? 'e.g. Exams scheduled on these dates' : 'e.g. Return by the stated time'}
          />
        </Field>
      </Modal>
    </div>
  );
}
