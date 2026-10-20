import { useEffect, useMemo, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';
import { Circle, MapContainer, Marker, Polygon, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import clsx from 'clsx';
import { useCampus } from '../../api/hooks';
import { CAMPUS_CENTER } from '../../lib/config';
import { STATUS_HEX } from '../Badges';

// Fix default marker icons under Vite (asset URLs are hashed at build time).
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

export { L };

export function BaseMap({ center, zoom = 15, className, children, scrollWheelZoom = true, ariaLabel = 'Map' }) {
  return (
    <div className={clsx('relative overflow-hidden rounded-xl border border-slate-200', className)} role="region" aria-label={ariaLabel}>
      <MapContainer
        center={center || CAMPUS_CENTER}
        zoom={zoom}
        scrollWheelZoom={scrollWheelZoom}
        style={{ height: '100%', width: '100%' }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={19}
        />
        {children}
      </MapContainer>
    </div>
  );
}

export function GeofenceShape({ fence, color = '#4f46e5', label, dashed = false }) {
  if (!fence) return null;
  const pathOptions = { color, weight: 2, fillOpacity: 0.08, dashArray: dashed ? '6 6' : undefined };
  const tooltip = label || fence.name;
  if (fence.shape === 'POLYGON' && Array.isArray(fence.polygon) && fence.polygon.length >= 3) {
    return (
      <Polygon positions={fence.polygon} pathOptions={pathOptions}>
        {tooltip && <Tooltip sticky>{tooltip}</Tooltip>}
      </Polygon>
    );
  }
  if (fence.center_lat != null && fence.center_lng != null) {
    return (
      <Circle center={[fence.center_lat, fence.center_lng]} radius={fence.radius_m || 100} pathOptions={pathOptions}>
        {tooltip && <Tooltip sticky>{tooltip}</Tooltip>}
      </Circle>
    );
  }
  return null;
}

/** Draws the active campus geofence (fetched from /geofences/campus). */
export function CampusLayer() {
  const { data } = useCampus();
  return data ? <GeofenceShape fence={data} color="#4f46e5" label={data.name || 'Campus'} /> : null;
}

/** Re-centres the map on the campus fence once it has loaded (when no other center is supplied). */
export function CenterOnCampus() {
  const map = useMap();
  const { data } = useCampus();
  const done = useRef(false);
  useEffect(() => {
    if (done.current || !data) return;
    done.current = true;
    if (data.shape === 'POLYGON' && Array.isArray(data.polygon) && data.polygon.length >= 3) {
      map.fitBounds(L.latLngBounds(data.polygon), { padding: [20, 20] });
    } else if (data.center_lat != null) {
      map.setView([data.center_lat, data.center_lng], map.getZoom());
    }
  }, [data, map]);
  return null;
}

export function DestinationCircle({ lat, lng, radius = 200, label = 'Destination' }) {
  if (lat == null || lng == null) return null;
  return (
    <Circle center={[lat, lng]} radius={radius} pathOptions={{ color: '#059669', weight: 2, fillOpacity: 0.1, dashArray: '6 6' }}>
      <Tooltip sticky>{label}</Tooltip>
    </Circle>
  );
}

/** Fits the map to the given [lat,lng] points whenever `fitKey` changes. */
export function FitBounds({ points, fitKey, maxZoom = 16 }) {
  const map = useMap();
  const last = useRef(null);
  useEffect(() => {
    const valid = (points || []).filter((p) => Array.isArray(p) && p[0] != null && p[1] != null);
    if (!valid.length) return;
    const key = fitKey ?? valid.length;
    if (last.current === key) return;
    last.current = key;
    if (valid.length === 1) map.setView(valid[0], Math.min(maxZoom, Math.max(map.getZoom(), 14)));
    else map.fitBounds(L.latLngBounds(valid), { padding: [30, 30], maxZoom });
  }, [points, fitKey, map, maxZoom]);
  return null;
}

export function MapClickHandler({ onClick }) {
  useMapEvents({
    click(e) {
      onClick?.(e.latlng);
    },
  });
  return null;
}

/** Fixes Leaflet rendering when the map is mounted in a container whose size changes. */
export function InvalidateSize({ deps = [] }) {
  const map = useMap();
  useEffect(() => {
    const t = setTimeout(() => map.invalidateSize(), 150);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return null;
}

export function PanTo({ position, zoom }) {
  const map = useMap();
  useEffect(() => {
    if (position && position[0] != null) map.setView(position, zoom ?? map.getZoom());
  }, [position?.[0], position?.[1]]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

const iconCache = new Map();
/** A round coloured marker for a trip, coloured by status. */
export function statusIcon(status, initials = '', pulse = false) {
  const key = `${status}|${initials}|${pulse}`;
  if (iconCache.has(key)) return iconCache.get(key);
  const color = STATUS_HEX[status] || '#4f46e5';
  const html = `
    <span style="position:relative;display:flex;align-items:center;justify-content:center;width:34px;height:34px;">
      ${pulse ? `<span class="animate-pulse-ring" style="position:absolute;inset:0;border-radius:9999px;background:${color};opacity:.5"></span>` : ''}
      <span style="position:relative;display:flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:9999px;background:${color};color:#fff;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35);font:600 11px/1 Inter,system-ui,sans-serif;">${initials}</span>
    </span>`;
  const icon = L.divIcon({ html, className: 'so-status-icon', iconSize: [34, 34], iconAnchor: [17, 17], popupAnchor: [0, -16] });
  iconCache.set(key, icon);
  return icon;
}

export function initialsOf(name) {
  return (name || '?')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');
}

/**
 * Click-to-pick map. `value` = { lat, lng } | null.
 */
export function LocationPickerMap({ value, onChange, className = 'h-72', showCampus = true }) {
  const position = value && value.lat != null && value.lng != null ? [value.lat, value.lng] : null;
  const markerRef = useRef(null);
  const handlers = useMemo(
    () => ({
      dragend() {
        const m = markerRef.current;
        if (m) {
          const ll = m.getLatLng();
          onChange({ lat: Number(ll.lat.toFixed(6)), lng: Number(ll.lng.toFixed(6)) });
        }
      },
    }),
    [onChange],
  );
  return (
    <BaseMap className={className} zoom={position ? 13 : 12} center={position || CAMPUS_CENTER} ariaLabel="Destination picker map">
      {showCampus && <CampusLayer />}
      <MapClickHandler onClick={(ll) => onChange({ lat: Number(ll.lat.toFixed(6)), lng: Number(ll.lng.toFixed(6)) })} />
      {position && <Marker position={position} draggable eventHandlers={handlers} ref={markerRef} />}
      {position && <PanTo position={position} />}
    </BaseMap>
  );
}
