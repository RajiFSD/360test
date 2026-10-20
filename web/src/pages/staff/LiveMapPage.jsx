import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { Marker, Polyline, Popup } from 'react-leaflet';
import { BatteryMedium, MapPinOff, Radio, RefreshCw, X } from 'lucide-react';
import { useLiveTrips, usePublicSettings, useTripLocations } from '../../api/hooks';
import { useSocket, useSocketEvent } from '../../socket/SocketContext';
import { Button, Card, PageHeader } from '../../components/ui';
import { EmptyState, ErrorState } from '../../components/States';
import { SkeletonList } from '../../components/Spinner';
import { StatusBadge, STATUS_HEX } from '../../components/Badges';
import { BaseMap, CampusLayer, CenterOnCampus, DestinationCircle, FitBounds, initialsOf, statusIcon } from '../../components/map/MapBits';
import { formatBattery, formatDateTime, formatRelative } from '../../lib/format';

function SelectedPath({ tripId }) {
  const q = useTripLocations(tripId, !!tripId);
  const points = useMemo(() => (Array.isArray(q.data) ? q.data.map((p) => [p.lat, p.lng]) : []), [q.data]);
  if (!points.length) return null;
  return (
    <>
      <Polyline positions={points} pathOptions={{ color: '#4f46e5', weight: 4, opacity: 0.85 }} />
      <FitBounds points={points} fitKey={`path-${tripId}-${points.length > 0}`} />
    </>
  );
}

export default function LiveMapPage() {
  const q = useLiveTrips();
  const settings = usePublicSettings();
  const { socket, connected } = useSocket();
  const [overrides, setOverrides] = useState({}); // tripId -> partial trip from socket
  const [selectedId, setSelectedId] = useState(null);
  const [subscribed, setSubscribed] = useState(false);
  const [subError, setSubError] = useState(null);
  const [filter, setFilter] = useState('ALL');

  useEffect(() => {
    if (!socket) return undefined;
    const sub = () =>
      socket.emit('tracking:subscribe_all', {}, (ack) => {
        if (ack && ack.ok === false) {
          setSubscribed(false);
          setSubError(ack.error || 'FORBIDDEN');
        } else {
          setSubscribed(true);
          setSubError(null);
        }
      });
    if (socket.connected) sub();
    socket.on('connect', sub);
    const onDisc = () => setSubscribed(false);
    socket.on('disconnect', onDisc);
    return () => {
      socket.off('connect', sub);
      socket.off('disconnect', onDisc);
      if (socket.connected) socket.emit('tracking:unsubscribe_all', {}, () => {});
    };
  }, [socket]);

  useSocketEvent('trip:location', (p) => {
    if (!p?.tripId) return;
    setOverrides((o) => ({
      ...o,
      [p.tripId]: {
        ...(o[p.tripId] || {}),
        id: p.tripId,
        status: p.status || o[p.tripId]?.status,
        studentName: p.studentName,
        rollNo: p.rollNo,
        studentId: p.studentId,
        last_location: { lat: p.lat, lng: p.lng, accuracy: p.accuracy, speed: p.speed, battery: p.battery, recorded_at: p.recorded_at },
      },
    }));
  });

  useSocketEvent('tracking:stop', (p) => {
    if (!p?.tripId) return;
    setOverrides((o) => ({ ...o, [p.tripId]: { ...(o[p.tripId] || {}), id: p.tripId, stopped: true } }));
  });

  useSocketEvent('trip:status', (p) => {
    if (!p?.tripId) return;
    setOverrides((o) => (o[p.tripId] ? { ...o, [p.tripId]: { ...o[p.tripId], status: p.status } } : o));
  });

  const trips = useMemo(() => {
    const base = new Map((q.data || []).map((t) => [t.id, t]));
    Object.values(overrides).forEach((ov) => {
      const existing = base.get(ov.id);
      if (existing) {
        base.set(ov.id, {
          ...existing,
          status: ov.status || existing.status,
          last_location: ov.last_location || existing.last_location,
          stopped: ov.stopped,
        });
      } else if (ov.last_location) {
        base.set(ov.id, {
          id: ov.id,
          status: ov.status || 'ACTIVE',
          student: { id: ov.studentId, name: ov.studentName, roll_no: ov.rollNo },
          last_location: ov.last_location,
          stopped: ov.stopped,
        });
      }
    });
    return [...base.values()].filter((t) => !t.stopped && ['ACTIVE', 'OVERDUE'].includes(t.status));
  }, [q.data, overrides]);

  const visible = trips.filter((t) => filter === 'ALL' || t.status === filter);
  const selected = trips.find((t) => t.id === selectedId) || null;
  const markerPoints = visible.filter((t) => t.last_location).map((t) => [t.last_location.lat, t.last_location.lng]);
  const counts = { ALL: trips.length, ACTIVE: trips.filter((t) => t.status === 'ACTIVE').length, OVERDUE: trips.filter((t) => t.status === 'OVERDUE').length };

  return (
    <div>
      <PageHeader
        title="Live map"
        subtitle="Students on active trips who have chosen to share their location."
        actions={
          <>
            <span
              className={clsx(
                'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium',
                connected && subscribed ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500',
              )}
            >
              <Radio className="h-3.5 w-3.5" aria-hidden="true" />
              {connected && subscribed ? 'Receiving live updates' : subError ? `Live updates unavailable (${subError})` : 'Connecting…'}
            </span>
            <Button variant="secondary" size="sm" icon={RefreshCw} loading={q.isFetching} onClick={() => q.refetch()}>
              Refresh
            </Button>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <Card className="overflow-hidden p-2">
          <BaseMap className="h-[60vh] min-h-[22rem] lg:h-[calc(100vh-12rem)]" zoom={13} ariaLabel="Live map of students on trips">
            <CampusLayer />
            {!markerPoints.length && <CenterOnCampus />}
            {visible.map((t) =>
              t.last_location ? (
                <Marker
                  key={t.id}
                  position={[t.last_location.lat, t.last_location.lng]}
                  icon={statusIcon(t.status, initialsOf(t.student?.name), t.status === 'OVERDUE')}
                  eventHandlers={{ click: () => setSelectedId(t.id) }}
                  title={t.student?.name}
                >
                  <Popup>
                    <div className="min-w-[11rem] space-y-1">
                      <p className="font-semibold">{t.student?.name}</p>
                      <p className="text-xs text-slate-500">{t.student?.roll_no}</p>
                      <p>
                        Status: <span style={{ color: STATUS_HEX[t.status] }}>{t.status}</span>
                      </p>
                      <p>Battery: {formatBattery(t.last_location.battery)}</p>
                      <p>Last seen: {formatRelative(t.last_location.recorded_at)}</p>
                      <p>
                        <Link to={`/trips/${t.id}`} className="font-medium text-indigo-700 underline">
                          Open trip
                        </Link>
                      </p>
                    </div>
                  </Popup>
                </Marker>
              ) : null,
            )}
            {selected && <SelectedPath tripId={selected.id} />}
            {selected && selected.dest_lat != null && (
              <DestinationCircle
                lat={selected.dest_lat}
                lng={selected.dest_lng}
                radius={settings.data?.destination_radius_m || 200}
                label={selected.dest_address || 'Destination'}
              />
            )}
            {!selected && markerPoints.length > 0 && <FitBounds points={markerPoints} fitKey={`all-${q.dataUpdatedAt}`} maxZoom={15} />}
          </BaseMap>
        </Card>

        <Card className="flex max-h-[calc(100vh-12rem)] flex-col">
          <div className="flex gap-1 border-b border-slate-100 p-2" role="tablist" aria-label="Filter trips">
            {['ALL', 'ACTIVE', 'OVERDUE'].map((f) => (
              <button
                key={f}
                type="button"
                role="tab"
                aria-selected={filter === f}
                onClick={() => setFilter(f)}
                className={clsx(
                  'flex-1 rounded-lg px-2 py-1.5 text-xs font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500',
                  filter === f ? 'bg-indigo-50 text-indigo-700' : 'text-slate-500 hover:bg-slate-50',
                )}
              >
                {f === 'ALL' ? 'All' : f === 'ACTIVE' ? 'Active' : 'Overdue'} ({counts[f]})
              </button>
            ))}
          </div>
          {selected && (
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 bg-indigo-50/50 px-3 py-2 text-xs text-indigo-800">
              Showing path for {selected.student?.name}
              <button
                type="button"
                onClick={() => setSelectedId(null)}
                className="rounded p-1 hover:bg-indigo-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                aria-label="Clear selected trip"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          <div className="flex-1 overflow-y-auto">
            {q.isPending ? (
              <div className="p-4">
                <SkeletonList rows={4} />
              </div>
            ) : q.isError ? (
              <ErrorState error={q.error} onRetry={q.refetch} />
            ) : !visible.length ? (
              <EmptyState icon={MapPinOff} title="No students sharing location" message="Trips appear here once a student exits and opts in to sharing." />
            ) : (
              <ul className="divide-y divide-slate-100">
                {visible.map((t) => (
                  <li key={t.id} className={clsx('flex items-start', t.id === selectedId && 'bg-indigo-50/60')}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(t.id === selectedId ? null : t.id)}
                      aria-pressed={t.id === selectedId}
                      className={clsx(
                        'flex min-w-0 flex-1 items-start gap-3 py-3 pl-3 text-left hover:bg-slate-50 focus:bg-slate-50 focus:outline-none',
                      )}
                    >
                      <span className="mt-1 h-3 w-3 shrink-0 rounded-full" style={{ background: STATUS_HEX[t.status] }} aria-hidden="true" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-slate-900">{t.student?.name}</span>
                        <span className="block text-xs text-slate-500">{t.student?.roll_no}</span>
                        <span className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                          <StatusBadge status={t.status} />
                          {t.last_location?.battery != null && (
                            <span className="inline-flex items-center gap-0.5">
                              <BatteryMedium className="h-3 w-3" aria-hidden="true" />
                              {formatBattery(t.last_location.battery)}
                            </span>
                          )}
                          <span title={formatDateTime(t.last_location?.recorded_at)}>{formatRelative(t.last_location?.recorded_at, 'no fix yet')}</span>
                        </span>
                      </span>
                    </button>
                    <Link
                      to={`/trips/${t.id}`}
                      className="shrink-0 px-3 py-3 text-xs font-medium text-indigo-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                      aria-label={`Trip details for ${t.student?.name}`}
                    >
                      Details
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="flex flex-wrap gap-3 border-t border-slate-100 px-3 py-2 text-[11px] text-slate-500">
            <span className="inline-flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: STATUS_HEX.ACTIVE }} aria-hidden="true" /> Active
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: STATUS_HEX.OVERDUE }} aria-hidden="true" /> Overdue
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-sm border-2 border-indigo-600" aria-hidden="true" /> Campus
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-full border-2 border-dashed border-emerald-600" aria-hidden="true" /> Destination
            </span>
          </div>
        </Card>
      </div>
    </div>
  );
}
