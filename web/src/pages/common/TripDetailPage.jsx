import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, BatteryMedium, Clock, EyeOff, Radio, ShieldCheck, ShieldOff } from 'lucide-react';
import { qk, useParentStudents, useTrip, useTripLocations } from '../../api/hooks';
import { useAuth } from '../../auth/AuthContext';
import { useSocket, useSocketEvent } from '../../socket/SocketContext';
import { Button, Card, KeyValue, LinkButton, PageHeader } from '../../components/ui';
import { EmptyState, ErrorState } from '../../components/States';
import { SkeletonList } from '../../components/Spinner';
import { StatusBadge } from '../../components/Badges';
import { DestinationLine, SectionCard, StudentInline, StudentPhone, Timeline, TripProgress } from '../../components/domain';
import { TripMap } from '../../components/map/TripMap';
import { DateTime } from '../../components/DateTime';
import { LIVE_TRIP_STATUSES, STAFF_ROLES, humanize } from '../../lib/constants';
import { formatBattery } from '../../lib/format';
import { NotifyButtons } from '../staff/NotifyButtons';

export default function TripDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const role = user?.role;
  const isStaff = STAFF_ROLES.includes(role);
  const qc = useQueryClient();
  const { socket, connected } = useSocket();
  const tripQ = useTrip(id);
  const trip = tripQ.data;
  const consentActive = !!trip?.consent?.active || (!!trip?.tracking_active && trip?.consent === undefined);
  const isLive = !!trip && LIVE_TRIP_STATUSES.includes(trip.status);

  // Parents may only see location when the server says tracking is visible (live trip + active consent).
  const parentLinks = useParentStudents({ enabled: role === 'parent' });
  const parentLink = (parentLinks.data || []).find((l) => String(l.current_trip?.id) === String(id));
  const parentVisible = parentLink ? !!parentLink.tracking_visible : consentActive;
  const canSeeMap = !!trip && (role === 'parent' ? isLive && parentVisible : true);
  const locQ = useTripLocations(id, canSeeMap);
  const [subError, setSubError] = useState(null);
  const [stopped, setStopped] = useState(null);

  const canSubscribe = !!trip && isLive && (role !== 'parent' || parentVisible);

  useEffect(() => {
    if (!socket || !canSubscribe) return undefined;
    const tripId = Number(id);
    const subscribe = () =>
      socket.emit('trip:subscribe', { tripId }, (ack) => {
        if (ack && ack.ok === false) setSubError(ack.error || 'FORBIDDEN');
        else setSubError(null);
      });
    if (socket.connected) subscribe();
    socket.on('connect', subscribe);
    return () => {
      socket.off('connect', subscribe);
      if (socket.connected) socket.emit('trip:unsubscribe', { tripId }, () => {});
    };
  }, [socket, canSubscribe, id]);

  useSocketEvent('trip:location', (p) => {
    if (String(p?.tripId) !== String(id)) return;
    const point = { lat: p.lat, lng: p.lng, accuracy: p.accuracy, speed: p.speed, battery: p.battery, recorded_at: p.recorded_at };
    qc.setQueryData(qk.tripLocations(id), (old) => (Array.isArray(old) ? [...old, point] : [point]));
    qc.setQueryData(qk.trip(id), (old) =>
      old ? { ...old, last_location: point, last_ping_at: p.recorded_at, status: p.status || old.status } : old,
    );
  });

  useSocketEvent('tracking:stop', (p) => {
    if (String(p?.tripId) !== String(id)) return;
    setStopped(p.reason);
    if (role === 'parent') qc.removeQueries({ queryKey: qk.tripLocations(id) });
  });

  const back = (
    <Button variant="ghost" size="sm" icon={ArrowLeft} className="-ml-2 mb-2" onClick={() => navigate(-1)}>
      Back
    </Button>
  );

  if (tripQ.isPending) {
    return (
      <div>
        <PageHeader back={back} title="Trip" />
        <Card className="p-5">
          <SkeletonList rows={4} />
        </Card>
      </div>
    );
  }
  if (tripQ.isError) {
    return (
      <div>
        <PageHeader back={back} title="Trip" />
        <Card>
          <ErrorState error={tripQ.error} onRetry={tripQ.refetch} title="Could not load this trip" />
        </Card>
      </div>
    );
  }

  const points = Array.isArray(locQ.data) ? locQ.data : [];
  const last = points[points.length - 1] || trip.last_location;
  const locForbidden = locQ.isError && locQ.error?.response?.status === 403;
  const showMap = canSeeMap && !locForbidden && !(role === 'parent' && stopped);

  return (
    <div className="space-y-6">
      <PageHeader
        back={back}
        title={`Trip #${trip.id}`}
        subtitle={trip.reason}
        actions={
          <>
            <StatusBadge status={trip.status} className="text-sm" />
            {isStaff && (
              <LinkButton to={`/staff/requests/${trip.request_id}`} variant="secondary" size="sm">
                View request
              </LinkButton>
            )}
            {role === 'student' && (
              <LinkButton to={`/student/requests/${trip.request_id}`} variant="secondary" size="sm">
                QR & sharing
              </LinkButton>
            )}
          </>
        }
      />

      <Card className="p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <StudentInline student={trip.student} size={48} />
          {trip.student?.phone && role !== 'student' && <StudentPhone phone={trip.student.phone} />}
        </div>
        <div className="mt-5">
          <TripProgress trip={trip} />
        </div>
      </Card>

      {trip.status === 'OVERDUE' && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm font-medium text-red-900" role="alert">
          This trip is overdue — expected back <DateTime value={trip.expected_return_at} relative />.
          {trip.escalation_level > 0 && ` Escalation level ${trip.escalation_level}.`}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <SectionCard
            title="Location"
            actions={
              isLive && showMap ? (
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500">
                  <Radio className={`h-4 w-4 ${connected && !subError ? 'text-emerald-600' : 'text-slate-400'}`} aria-hidden="true" />
                  {connected && !subError ? 'Live updates on' : 'Live updates paused'}
                </span>
              ) : null
            }
          >
            {stopped && (
              <p className="mb-3 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700" role="status">
                Live sharing stopped ({humanize(stopped)}).
              </p>
            )}
            {!showMap ? (
              <EmptyState
                icon={EyeOff}
                title="Live location not shared for this trip"
                message={
                  role === 'parent'
                    ? 'Location is visible only while the trip is active and the student has chosen to share it.'
                    : 'Location data is not available for this trip.'
                }
              />
            ) : locQ.isPending ? (
              <div className="h-80 animate-pulse rounded-xl bg-slate-100" />
            ) : locQ.isError ? (
              <ErrorState error={locQ.error} onRetry={locQ.refetch} title="Could not load the path" />
            ) : (
              <>
                <TripMap trip={trip} points={points} className="h-80 sm:h-96" live={isLive && !stopped} />
                <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-600">
                  <span className="inline-flex items-center gap-1.5">
                    <Clock className="h-4 w-4 text-slate-400" aria-hidden="true" /> Last seen:{' '}
                    <DateTime value={last?.recorded_at || trip.last_ping_at} relative />
                  </span>
                  {last?.battery != null && (
                    <span className="inline-flex items-center gap-1.5">
                      <BatteryMedium className="h-4 w-4 text-slate-400" aria-hidden="true" /> Battery {formatBattery(last.battery)}
                    </span>
                  )}
                  <span>{points.length} recorded point{points.length === 1 ? '' : 's'}</span>
                </div>
                {!points.length && <p className="mt-2 text-sm text-slate-500">No location points recorded yet.</p>}
              </>
            )}
          </SectionCard>

          <SectionCard title="Trip details">
            <dl className="grid gap-4 sm:grid-cols-2">
              <KeyValue label="Category">{humanize(trip.reason_category)}</KeyValue>
              <KeyValue label="Destination">
                <DestinationLine item={trip} />
              </KeyValue>
              <KeyValue label="Planned departure">
                <DateTime value={trip.depart_at} />
              </KeyValue>
              <KeyValue label="Expected return">
                <DateTime value={trip.expected_return_at} />
              </KeyValue>
              <KeyValue label="Gate exit">
                <DateTime value={trip.exit_at} />
              </KeyValue>
              <KeyValue label="Gate entry">
                <DateTime value={trip.entry_at} />
              </KeyValue>
              <KeyValue label="Reached destination">
                <DateTime value={trip.reached_destination_at} />
              </KeyValue>
              <KeyValue label="Returned to campus">
                <DateTime value={trip.returned_at} />
              </KeyValue>
              <KeyValue label="Location consent">
                {trip.consent ? (
                  trip.consent.active ? (
                    <span className="inline-flex items-center gap-1 text-emerald-700">
                      <ShieldCheck className="h-4 w-4" aria-hidden="true" /> Sharing since <DateTime value={trip.consent.granted_at} />
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-slate-600">
                      <ShieldOff className="h-4 w-4" aria-hidden="true" /> Stopped <DateTime value={trip.consent.revoked_at} />
                      {trip.consent.revoke_reason ? ` (${humanize(trip.consent.revoke_reason)})` : ''}
                    </span>
                  )
                ) : (
                  'Not shared'
                )}
              </KeyValue>
            </dl>
          </SectionCard>
        </div>

        <div className="space-y-6">
          {isStaff && isLive && (
            <SectionCard title="Contact">
              <NotifyButtons tripId={trip.id} />
            </SectionCard>
          )}
          <SectionCard title="Timeline">
            <Timeline events={trip.events} gateLogs={trip.gate_logs} />
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
