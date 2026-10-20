import { useMemo } from 'react';
import { CircleMarker, Marker, Polyline, Popup, Tooltip } from 'react-leaflet';
import {
  BaseMap,
  CampusLayer,
  DestinationCircle,
  FitBounds,
  initialsOf,
  statusIcon,
} from './MapBits';
import { usePublicSettings } from '../../api/hooks';
import { formatBattery, formatDateTime } from '../../lib/format';

/**
 * Map for a single trip: campus fence, destination circle, travelled path and current position.
 * `points` = [{lat,lng,recorded_at,...}] ascending.
 */
export function TripMap({ trip, points = [], className = 'h-80', live = false }) {
  const settings = usePublicSettings();
  const radius = settings.data?.destination_radius_m || 200;
  const path = useMemo(() => points.filter((p) => p.lat != null && p.lng != null).map((p) => [p.lat, p.lng]), [points]);
  const last = points.length ? points[points.length - 1] : trip?.last_location || null;
  const lastLat = last?.lat ?? null;
  const lastLng = last?.lng ?? null;
  const lastPos = useMemo(() => (lastLat != null ? [lastLat, lastLng] : null), [lastLat, lastLng]);
  const dest = useMemo(() => (trip?.dest_lat != null ? [trip.dest_lat, trip.dest_lng] : null), [trip?.dest_lat, trip?.dest_lng]);
  const fitPoints = useMemo(() => [...path, ...(dest ? [dest] : []), ...(lastPos ? [lastPos] : [])], [path, dest, lastPos]);
  const first = path[0];

  return (
    <BaseMap className={className} zoom={13} center={lastPos || dest || undefined} ariaLabel="Trip map">
      <CampusLayer />
      {dest && <DestinationCircle lat={dest[0]} lng={dest[1]} radius={radius} label={trip?.dest_address || 'Destination'} />}
      {path.length > 1 && <Polyline positions={path} pathOptions={{ color: '#4f46e5', weight: 4, opacity: 0.8 }} />}
      {first && path.length > 1 && (
        <CircleMarker center={first} radius={6} pathOptions={{ color: '#fff', weight: 2, fillColor: '#64748b', fillOpacity: 1 }}>
          <Tooltip>First recorded point</Tooltip>
        </CircleMarker>
      )}
      {lastPos && (
        <Marker position={lastPos} icon={statusIcon(trip?.status || 'ACTIVE', initialsOf(trip?.student?.name), live)}>
          <Popup>
            <div className="space-y-0.5">
              <p className="font-semibold">{trip?.student?.name || 'Student'}</p>
              <p>Last seen: {formatDateTime(last.recorded_at)}</p>
              {last.battery != null && <p>Battery: {formatBattery(last.battery)}</p>}
              {last.accuracy != null && <p>Accuracy: ±{Math.round(last.accuracy)} m</p>}
            </div>
          </Popup>
        </Marker>
      )}
      <FitBounds points={fitPoints} fitKey={`${trip?.id}-${path.length > 0}-${!!dest}`} />
    </BaseMap>
  );
}
