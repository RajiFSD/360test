import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { Building2, LocateFixed, MapPinOff, Navigation, QrCode, RefreshCw, ShieldCheck } from 'lucide-react';
import { useCheckin, useGrantConsent, usePublicSettings, useRevokeConsent, useTrip, useTripQr } from '../../api/hooks';
import { getApiError, getErrorMessage } from '../../api/client';
import { useLocationSharing } from '../../socket/useLocationSharing';
import { Button, Card, Checkbox } from '../../components/ui';
import { ConfirmDialog } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { Spinner } from '../../components/Spinner';
import { ErrorState } from '../../components/States';
import { StatusBadge } from '../../components/Badges';
import { TripProgress } from '../../components/domain';
import { DateTime } from '../../components/DateTime';
import { formatDistance, formatTime } from '../../lib/format';
import { getCurrentPosition } from '../../lib/geo';
import { LIVE_TRIP_STATUSES, QR_TRIP_STATUSES, humanize } from '../../lib/constants';

const CONSENT_TEXT =
  'I agree to share my live location with my warden and linked parents for this trip only. I can stop at any time; sharing ends automatically when the trip is completed.';

function useCountdown(iso) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!iso) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [iso]);
  if (!iso) return null;
  return Math.max(0, Math.round((new Date(iso).getTime() - now) / 1000));
}

function QrCard({ trip }) {
  const enabled = QR_TRIP_STATUSES.includes(trip.status);
  const qr = useTripQr(trip.id, enabled);
  const secs = useCountdown(qr.data?.expires_at);

  if (!enabled) return null;
  return (
    <Card className="p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
          <QrCode className="h-5 w-5 text-indigo-600" aria-hidden="true" /> Gate pass QR
        </h2>
        <Button size="sm" variant="ghost" icon={RefreshCw} onClick={() => qr.refetch()} loading={qr.isFetching} aria-label="Refresh QR code">
          Refresh
        </Button>
      </div>
      {qr.isPending ? (
        <div className="flex h-64 items-center justify-center">
          <Spinner label="Generating QR code" />
        </div>
      ) : qr.isError ? (
        <ErrorState error={qr.error} onRetry={qr.refetch} title="QR code unavailable" />
      ) : (
        <div className="flex flex-col items-center">
          <div className="rounded-2xl border-4 border-indigo-600 bg-white p-3">
            <QRCodeSVG value={qr.data.token} size={224} level="M" includeMargin={false} aria-label="Outpass QR code" role="img" />
          </div>
          <p className="mt-3 text-sm text-slate-600">
            Show this at the gate for <span className="font-semibold">{trip.exit_at ? 'ENTRY' : 'EXIT'}</span>.
          </p>
          <p className="mt-1 text-xs text-slate-500" aria-live="polite">
            Expires at {formatTime(qr.data.expires_at)}
            {secs != null && (secs > 0 ? ` · ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')} left` : ' · refreshing…')}
          </p>
          <p className="mt-1 text-xs text-slate-400">The code refreshes automatically every minute.</p>
        </div>
      )}
    </Card>
  );
}

function SharingIndicator({ sharing }) {
  if (sharing.status !== 'sharing' && sharing.status !== 'starting') return null;
  return (
    <div className="flex items-center gap-3 rounded-xl bg-emerald-600 px-4 py-3 text-white shadow" role="status" aria-live="polite">
      <span className="relative flex h-4 w-4">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
        <span className="relative inline-flex h-4 w-4 rounded-full bg-white" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold">{sharing.status === 'starting' ? 'Starting location sharing…' : 'Sharing location'}</p>
        <p className="text-xs text-emerald-50">
          {sharing.lastSentAt ? (
            <>
              Last update <DateTime value={sharing.lastSentAt} relative /> · every {sharing.intervalSec}s
            </>
          ) : (
            'Waiting for a GPS fix…'
          )}
        </p>
      </div>
    </div>
  );
}

function ConsentCard({ trip, consent, sharing }) {
  const toast = useToast();
  const [agree, setAgree] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const grant = useGrantConsent();
  const revoke = useRevokeConsent();
  const active = !!consent?.active;
  const live = LIVE_TRIP_STATUSES.includes(trip.status);

  return (
    <Card className="p-4 sm:p-5">
      <h2 className="mb-2 flex items-center gap-2 text-base font-semibold text-slate-900">
        <ShieldCheck className="h-5 w-5 text-indigo-600" aria-hidden="true" /> Live location consent
      </h2>
      {active ? (
        <div className="space-y-3">
          <SharingIndicator sharing={sharing} />
          {!live && (
            <p className="rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-800">
              Consent granted <DateTime value={consent.granted_at} relative />. Sharing begins after you exit through the gate.
            </p>
          )}
          {sharing.error && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{sharing.error}</p>}
          <p className="text-sm text-slate-600">
            Your warden and linked parents can see your location for this trip only. Keep this page open to share from this browser,
            or use the mobile app for background sharing.
          </p>
          <Button variant="danger" icon={MapPinOff} onClick={() => setConfirmStop(true)}>
            Stop sharing
          </Button>
          <ConfirmDialog
            open={confirmStop}
            onClose={() => setConfirmStop(false)}
            title="Stop sharing your location?"
            message="Your warden and parents will no longer see your live location for this trip. You can opt in again later."
            confirmLabel="Stop sharing"
            loading={revoke.isPending}
            onConfirm={() =>
              revoke.mutate(trip.id, {
                onSuccess: () => {
                  setConfirmStop(false);
                  toast.success('Location sharing stopped');
                },
                onError: (e) => toast.error('Could not stop sharing', getErrorMessage(e)),
              })
            }
          />
        </div>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!agree) return;
            grant.mutate(trip.id, {
              onSuccess: () => {
                toast.success('Thank you', 'Location sharing is enabled for this trip.');
                setAgree(false);
              },
              onError: (err) => toast.error('Could not enable sharing', getErrorMessage(err)),
            });
          }}
        >
          <p className="text-sm text-slate-600">
            Sharing is optional and off by default. If you opt in, your location is shared only during this trip.
          </p>
          {consent && consent.revoked_at && (
            <p className="text-xs text-slate-500">
              Previously stopped <DateTime value={consent.revoked_at} relative />
              {consent.revoke_reason ? ` (${humanize(consent.revoke_reason)})` : ''}.
            </p>
          )}
          <Checkbox checked={agree} onChange={(e) => setAgree(e.target.checked)} label={CONSENT_TEXT} />
          <Button type="submit" disabled={!agree} loading={grant.isPending} icon={Navigation}>
            Start sharing for this trip
          </Button>
        </form>
      )}
    </Card>
  );
}

function CheckinCard({ trip }) {
  const toast = useToast();
  const checkin = useCheckin();
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState(null);

  if (!LIVE_TRIP_STATUSES.includes(trip.status) || trip.returned_at) {
    if (trip.returned_at && trip.status !== 'COMPLETED') {
      return (
        <Card className="p-4 text-sm text-emerald-800 sm:p-5">
          You checked in on campus <DateTime value={trip.returned_at} relative />. Scan your QR at the gate to complete the trip.
        </Card>
      );
    }
    return null;
  }

  const doCheckin = async () => {
    setError(null);
    setLocating(true);
    let pos;
    try {
      pos = await getCurrentPosition();
    } catch (e) {
      setError(e.message);
      setLocating(false);
      return;
    }
    setLocating(false);
    checkin.mutate(
      { id: trip.id, lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy },
      {
        onSuccess: () => toast.success('Welcome back!', 'Your return to campus has been recorded.'),
        onError: (err) => {
          const e = getApiError(err);
          if (e.code === 'OUTSIDE_CAMPUS') {
            setError(
              `You appear to be ${formatDistance(e.details?.distance_m)} away from campus. Move inside the campus boundary and try again.`,
            );
          } else setError(e.message);
        },
      },
    );
  };

  return (
    <Card className="p-4 sm:p-5">
      <h2 className="mb-2 flex items-center gap-2 text-base font-semibold text-slate-900">
        <Building2 className="h-5 w-5 text-indigo-600" aria-hidden="true" /> Back on campus?
      </h2>
      <p className="text-sm text-slate-600">Let your warden know you've returned. We'll check your current position.</p>
      {error && (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {error}
        </p>
      )}
      <Button className="mt-3 w-full sm:w-auto" size="lg" variant="success" icon={LocateFixed} loading={locating || checkin.isPending} onClick={doCheckin}>
        I've reached campus
      </Button>
    </Card>
  );
}

/** Everything a student needs for an approved/active trip: QR, consent, live sharing, check-in. */
export function StudentTripPanel({ tripId }) {
  const toast = useToast();
  const tripQ = useTrip(tripId);
  const settings = usePublicSettings();
  const trip = tripQ.data;
  const consent = trip?.consent || null;
  const shouldShare = !!trip && LIVE_TRIP_STATUSES.includes(trip.status) && !!consent?.active;

  const sharing = useLocationSharing({
    tripId,
    enabled: shouldShare,
    defaultIntervalSec: settings.data?.tracking_interval_moving_sec || 30,
    onEvents: (events) => {
      events.forEach((ev) => {
        if (ev === 'REACHED_DESTINATION') toast.success('Destination reached', 'Your warden and parents have been notified.');
        else if (ev === 'RETURNED_CAMPUS') toast.success('Back on campus', 'Your return has been recorded.');
        else toast.info(humanize(ev));
      });
    },
  });

  if (tripQ.isPending) {
    return (
      <Card className="flex h-40 items-center justify-center">
        <Spinner label="Loading trip" />
      </Card>
    );
  }
  if (tripQ.isError) return <Card><ErrorState error={tripQ.error} onRetry={tripQ.refetch} title="Could not load trip" /></Card>;
  if (!trip) return null;

  const showTripTools = QR_TRIP_STATUSES.includes(trip.status);

  return (
    <div className="space-y-4">
      {shouldShare && (sharing.status === 'sharing' || sharing.status === 'starting') && (
        <div className="sticky top-[4.5rem] z-10">
          <SharingIndicator sharing={sharing} />
        </div>
      )}
      <Card className="p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-slate-900">Trip #{trip.id}</h2>
          <div className="flex items-center gap-2">
            <StatusBadge status={trip.status} />
            <Link to={`/trips/${trip.id}`} className="text-sm font-medium text-indigo-700 hover:underline">
              Trip details
            </Link>
          </div>
        </div>
        <TripProgress trip={trip} />
      </Card>
      {showTripTools && (
        <div className="grid gap-4 lg:grid-cols-2">
          <QrCard trip={trip} />
          <div className="space-y-4">
            <ConsentCard trip={trip} consent={consent} sharing={sharing} />
            <CheckinCard trip={trip} />
          </div>
        </div>
      )}
    </div>
  );
}
