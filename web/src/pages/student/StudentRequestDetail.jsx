import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { ArrowLeft, Ban, Paperclip } from 'lucide-react';
import { useCancelOutpass, useOutpass } from '../../api/hooks';
import { getErrorMessage } from '../../api/client';
import { Button, Card, KeyValue, LinkButton, PageHeader } from '../../components/ui';
import { ErrorState } from '../../components/States';
import { SkeletonList } from '../../components/Spinner';
import { RiskBadge, StatusBadge } from '../../components/Badges';
import { DestinationLine, SectionCard, Timeline } from '../../components/domain';
import { ConfirmDialog } from '../../components/Modal';
import { DateTime } from '../../components/DateTime';
import { useToast } from '../../components/Toast';
import { assetUrl } from '../../lib/config';
import { formatDateTime } from '../../lib/format';
import { QR_TRIP_STATUSES, humanize } from '../../lib/constants';
import { StudentTripPanel } from './StudentTripPanel';

export default function StudentRequestDetail() {
  const { id } = useParams();
  const q = useOutpass(id);
  const cancel = useCancelOutpass();
  const toast = useToast();
  const [confirmCancel, setConfirmCancel] = useState(false);

  const back = (
    <LinkButton to="/student/requests" variant="ghost" size="sm" icon={ArrowLeft} className="-ml-2 mb-2">
      My requests
    </LinkButton>
  );

  if (q.isPending) {
    return (
      <div>
        <PageHeader back={back} title="Outpass request" />
        <Card className="p-5">
          <SkeletonList rows={4} />
        </Card>
      </div>
    );
  }
  if (q.isError) {
    return (
      <div>
        <PageHeader back={back} title="Outpass request" />
        <Card>
          <ErrorState error={q.error} onRetry={q.refetch} title="Could not load this request" />
        </Card>
      </div>
    );
  }

  const o = q.data;
  const trip = o.trip;
  const canCancel = o.status === 'PENDING' || (o.status === 'APPROVED' && !trip?.exit_at);
  const showTrip = trip && (QR_TRIP_STATUSES.includes(o.status) || QR_TRIP_STATUSES.includes(trip.status));

  return (
    <div className="space-y-6">
      <PageHeader
        back={back}
        title={o.reason}
        subtitle={`Request #${o.id} · submitted ${formatDateTime(o.created_at)}`}
        actions={
          <>
            <StatusBadge status={o.status} className="text-sm" />
            {canCancel && (
              <Button variant="secondary" icon={Ban} onClick={() => setConfirmCancel(true)}>
                Cancel request
              </Button>
            )}
          </>
        }
      />

      {o.status === 'REJECTED' && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900" role="status">
          <p className="font-semibold">Request rejected{o.reviewer ? ` by ${o.reviewer.name}` : ''}</p>
          {o.remarks && <p className="mt-1">“{o.remarks}”</p>}
        </div>
      )}
      {o.status === 'PENDING' && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" role="status">
          Waiting for approval. You'll get a notification as soon as it is reviewed.
        </div>
      )}
      {o.status === 'OVERDUE' && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm font-medium text-red-900" role="alert">
          You are past your expected return time. Please return to campus as soon as possible.
        </div>
      )}

      {showTrip && <StudentTripPanel tripId={trip.id} />}

      <div className="grid gap-6 lg:grid-cols-3">
        <SectionCard title="Details" className="lg:col-span-2">
          <dl className="grid gap-4 sm:grid-cols-2">
            <KeyValue label="Category">{humanize(o.reason_category)}</KeyValue>
            <KeyValue label="Destination">
              <DestinationLine item={o} />
            </KeyValue>
            <KeyValue label="Departure">
              <DateTime value={o.depart_at} />
            </KeyValue>
            <KeyValue label="Expected return">
              <DateTime value={o.expected_return_at} />
            </KeyValue>
            <KeyValue label="Reviewed by">{o.reviewer?.name || '—'}</KeyValue>
            <KeyValue label="Reviewed at">
              <DateTime value={o.reviewed_at} />
            </KeyValue>
            {o.remarks && o.status !== 'REJECTED' && (
              <KeyValue label="Remarks" className="sm:col-span-2">
                {o.remarks}
              </KeyValue>
            )}
            <KeyValue label="AI delay risk">
              <RiskBadge level={o.risk_level} score={o.risk_score} reasons={o.risk_reasons} />
            </KeyValue>
            {o.attachment_url && (
              <KeyValue label="Attachment">
                <a
                  href={assetUrl(o.attachment_url)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-medium text-indigo-700 hover:underline"
                >
                  <Paperclip className="h-4 w-4" aria-hidden="true" /> View attachment
                </a>
              </KeyValue>
            )}
          </dl>
        </SectionCard>
        <SectionCard title="Timeline">
          <Timeline events={o.events} gateLogs={o.gate_logs} />
        </SectionCard>
      </div>

      <ConfirmDialog
        open={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        title="Cancel this request?"
        message="This cannot be undone. You can submit a new request later."
        confirmLabel="Cancel request"
        cancelLabel="Keep it"
        loading={cancel.isPending}
        onConfirm={() =>
          cancel.mutate(o.id, {
            onSuccess: () => {
              setConfirmCancel(false);
              toast.success('Request cancelled');
            },
            onError: (err) => toast.error('Could not cancel', getErrorMessage(err)),
          })
        }
      />
    </div>
  );
}
