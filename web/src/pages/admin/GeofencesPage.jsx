import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { Circle, CircleMarker, Polygon, Polyline } from 'react-leaflet';
import { MapPinned, Pencil, Plus, Save, Trash2, Undo2, X } from 'lucide-react';
import { useCreateGeofence, useDeleteGeofence, useGeofences, useUpdateGeofence } from '../../api/hooks';
import { getErrorMessage } from '../../api/client';
import { Badge, Button, Card, Field, Input, PageHeader, Select, Toggle } from '../../components/ui';
import { EmptyState, ErrorState } from '../../components/States';
import { SkeletonList } from '../../components/Spinner';
import { ConfirmDialog } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { BaseMap, CenterOnCampus, FitBounds, GeofenceShape, MapClickHandler } from '../../components/map/MapBits';
import { GEOFENCE_SHAPES, GEOFENCE_TYPES, humanize } from '../../lib/constants';

const TYPE_COLORS = { CAMPUS: '#4f46e5', DESTINATION: '#059669', CUSTOM: '#d97706' };

const NEW_DRAFT = { name: '', type: 'CUSTOM', shape: 'CIRCLE', center_lat: null, center_lng: null, radius_m: 200, polygon: [], is_active: true };

function centroid(points) {
  if (!points.length) return [null, null];
  const lat = points.reduce((s, p) => s + p[0], 0) / points.length;
  const lng = points.reduce((s, p) => s + p[1], 0) / points.length;
  return [Number(lat.toFixed(6)), Number(lng.toFixed(6))];
}

export default function GeofencesPage() {
  const toast = useToast();
  const [typeFilter, setTypeFilter] = useState('');
  const q = useGeofences(typeFilter ? { type: typeFilter } : undefined);
  const create = useCreateGeofence();
  const update = useUpdateGeofence();
  const del = useDeleteGeofence();
  const [draft, setDraft] = useState(null);
  const [errors, setErrors] = useState({});
  const [toDelete, setToDelete] = useState(null);
  const fences = useMemo(() => q.data || [], [q.data]);

  const startNew = () => {
    setDraft({ ...NEW_DRAFT });
    setErrors({});
  };
  const startEdit = (f) => {
    setDraft({
      id: f.id,
      name: f.name,
      type: f.type,
      shape: f.shape,
      center_lat: f.center_lat,
      center_lng: f.center_lng,
      radius_m: f.radius_m || 200,
      polygon: Array.isArray(f.polygon) ? f.polygon : [],
      is_active: f.is_active,
    });
    setErrors({});
  };

  const onMapClick = (ll) => {
    if (!draft) return;
    const pt = [Number(ll.lat.toFixed(6)), Number(ll.lng.toFixed(6))];
    if (draft.shape === 'CIRCLE') setDraft((d) => ({ ...d, center_lat: pt[0], center_lng: pt[1] }));
    else setDraft((d) => ({ ...d, polygon: [...d.polygon, pt] }));
  };

  const save = () => {
    const errs = {};
    if (!draft.name.trim()) errs.name = 'Name is required';
    if (draft.shape === 'CIRCLE') {
      if (draft.center_lat == null) errs.map = 'Click the map to set the circle centre';
      if (!(Number(draft.radius_m) > 0)) errs.radius_m = 'Radius must be greater than 0';
    } else if (draft.polygon.length < 3) errs.map = 'Click at least 3 points on the map to draw the polygon';
    setErrors(errs);
    if (Object.keys(errs).length) return;

    const [clat, clng] = draft.shape === 'POLYGON' ? centroid(draft.polygon) : [draft.center_lat, draft.center_lng];
    const body = {
      name: draft.name.trim(),
      type: draft.type,
      shape: draft.shape,
      center_lat: clat,
      center_lng: clng,
      radius_m: draft.shape === 'CIRCLE' ? Number(draft.radius_m) : null,
      polygon: draft.shape === 'POLYGON' ? draft.polygon : null,
      is_active: draft.is_active,
    };
    const opts = {
      onSuccess: () => {
        toast.success(draft.id ? 'Geofence updated' : 'Geofence created');
        setDraft(null);
      },
      onError: (e) => toast.error('Could not save geofence', getErrorMessage(e)),
    };
    if (draft.id) update.mutate({ id: draft.id, body }, opts);
    else create.mutate(body, opts);
  };

  const toggleActive = (f, v) =>
    update.mutate(
      { id: f.id, body: { is_active: v } },
      {
        onSuccess: () => toast.success(v ? 'Geofence activated' : 'Geofence deactivated'),
        onError: (e) => toast.error('Update failed', getErrorMessage(e)),
      },
    );

  const fitPoints = useMemo(() => {
    const pts = [];
    fences.forEach((f) => {
      if (f.shape === 'POLYGON' && Array.isArray(f.polygon)) pts.push(...f.polygon);
      else if (f.center_lat != null) pts.push([f.center_lat, f.center_lng]);
    });
    return pts;
  }, [fences]);

  const draftColor = TYPE_COLORS[draft?.type] || '#d97706';

  return (
    <div>
      <PageHeader
        title="Geofences"
        subtitle="Campus boundary, destination zones and custom areas used for trip events."
        actions={
          !draft && (
            <Button icon={Plus} onClick={startNew}>
              New geofence
            </Button>
          )
        }
      />
      <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
        <Card className="overflow-hidden p-2">
          {draft && (
            <p className="mb-2 rounded-lg bg-indigo-50 px-3 py-2 text-sm text-indigo-800" role="status">
              {draft.shape === 'CIRCLE'
                ? 'Click on the map to place the circle centre, then set the radius.'
                : `Click on the map to add polygon points (${draft.polygon.length} added).`}
            </p>
          )}
          <BaseMap className={clsx('h-[60vh] min-h-[22rem]', draft && 'cursor-crosshair')} zoom={15} ariaLabel="Geofence editor map">
            {!fitPoints.length && <CenterOnCampus />}
            <FitBounds points={fitPoints} fitKey={`fences-${fences.length}`} />
            {fences
              .filter((f) => f.id !== draft?.id)
              .map((f) => (
                <GeofenceShape key={f.id} fence={f} color={f.is_active ? TYPE_COLORS[f.type] || '#64748b' : '#94a3b8'} dashed={!f.is_active} />
              ))}
            {draft && <MapClickHandler onClick={onMapClick} />}
            {draft?.shape === 'CIRCLE' && draft.center_lat != null && (
              <>
                <Circle center={[draft.center_lat, draft.center_lng]} radius={Number(draft.radius_m) || 1} pathOptions={{ color: draftColor, weight: 3, fillOpacity: 0.15 }} />
                <CircleMarker center={[draft.center_lat, draft.center_lng]} radius={5} pathOptions={{ color: '#fff', weight: 2, fillColor: draftColor, fillOpacity: 1 }} />
              </>
            )}
            {draft?.shape === 'POLYGON' && draft.polygon.length > 0 && (
              <>
                {draft.polygon.length >= 3 ? (
                  <Polygon positions={draft.polygon} pathOptions={{ color: draftColor, weight: 3, fillOpacity: 0.15 }} />
                ) : (
                  <Polyline positions={draft.polygon} pathOptions={{ color: draftColor, weight: 3, dashArray: '4 4' }} />
                )}
                {draft.polygon.map((p, i) => (
                  <CircleMarker key={i} center={p} radius={5} pathOptions={{ color: '#fff', weight: 2, fillColor: draftColor, fillOpacity: 1 }} />
                ))}
              </>
            )}
          </BaseMap>
        </Card>

        {draft ? (
          <Card className="p-4">
            <h2 className="mb-4 text-base font-semibold text-slate-900">{draft.id ? 'Edit geofence' : 'New geofence'}</h2>
            <div className="space-y-4">
              <Field label="Name" htmlFor="gf-name" error={errors.name} required>
                <Input id="gf-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} invalid={!!errors.name} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Type" htmlFor="gf-type">
                  <Select id="gf-type" value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value })}>
                    {GEOFENCE_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {humanize(t)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Shape" htmlFor="gf-shape">
                  <Select id="gf-shape" value={draft.shape} onChange={(e) => setDraft({ ...draft, shape: e.target.value })}>
                    {GEOFENCE_SHAPES.map((s) => (
                      <option key={s} value={s}>
                        {humanize(s)}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              {draft.shape === 'CIRCLE' ? (
                <>
                  <Field label="Radius (metres)" htmlFor="gf-radius" error={errors.radius_m} required>
                    <Input
                      id="gf-radius"
                      type="number"
                      min={10}
                      step={10}
                      value={draft.radius_m}
                      onChange={(e) => setDraft({ ...draft, radius_m: e.target.value })}
                      invalid={!!errors.radius_m}
                    />
                  </Field>
                  <p className="text-xs text-slate-500">
                    Centre: {draft.center_lat != null ? `${draft.center_lat}, ${draft.center_lng}` : 'not set — click the map'}
                  </p>
                </>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={Undo2}
                    disabled={!draft.polygon.length}
                    onClick={() => setDraft({ ...draft, polygon: draft.polygon.slice(0, -1) })}
                  >
                    Undo point
                  </Button>
                  <Button size="sm" variant="secondary" icon={X} disabled={!draft.polygon.length} onClick={() => setDraft({ ...draft, polygon: [] })}>
                    Clear
                  </Button>
                  <span className="self-center text-xs text-slate-500">{draft.polygon.length} points</span>
                </div>
              )}
              {errors.map && (
                <p className="text-sm font-medium text-red-600" role="alert">
                  {errors.map}
                </p>
              )}
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-slate-700">Active</span>
                <Toggle checked={draft.is_active} onChange={(v) => setDraft({ ...draft, is_active: v })} label="Geofence active" />
              </div>
              <div className="flex gap-2 pt-2">
                <Button variant="secondary" className="flex-1" onClick={() => setDraft(null)}>
                  Cancel
                </Button>
                <Button className="flex-1" icon={Save} loading={create.isPending || update.isPending} onClick={save}>
                  Save
                </Button>
              </div>
            </div>
          </Card>
        ) : (
          <Card className="flex max-h-[70vh] flex-col">
            <div className="border-b border-slate-100 p-3">
              <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label="Filter by type">
                <option value="">All types</option>
                {GEOFENCE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {humanize(t)}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex-1 overflow-y-auto">
              {q.isPending ? (
                <div className="p-4">
                  <SkeletonList rows={4} />
                </div>
              ) : q.isError ? (
                <ErrorState error={q.error} onRetry={q.refetch} />
              ) : !fences.length ? (
                <EmptyState icon={MapPinned} title="No geofences" message="Create the campus boundary first." />
              ) : (
                <ul className="divide-y divide-slate-100">
                  {fences.map((f) => (
                    <li key={f.id} className="px-3 py-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-900">{f.name}</p>
                          <div className="mt-1 flex flex-wrap gap-1">
                            <Badge className="bg-slate-50 text-slate-700 ring-slate-300">
                              <span className="h-2 w-2 rounded-full" style={{ background: TYPE_COLORS[f.type] }} aria-hidden="true" />
                              {humanize(f.type)}
                            </Badge>
                            <Badge className="bg-slate-50 text-slate-600 ring-slate-200">
                              {humanize(f.shape)}
                              {f.shape === 'CIRCLE' && f.radius_m ? ` · ${f.radius_m} m` : ''}
                            </Badge>
                            {f.trip_id && <Badge className="bg-slate-50 text-slate-600 ring-slate-200">Trip #{f.trip_id}</Badge>}
                          </div>
                        </div>
                        <Toggle checked={f.is_active} onChange={(v) => toggleActive(f, v)} label={`${f.name} active`} disabled={update.isPending} />
                      </div>
                      <div className="mt-2 flex gap-1">
                        <Button size="sm" variant="ghost" icon={Pencil} onClick={() => startEdit(f)} aria-label={`Edit ${f.name}`}>
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={Trash2}
                          className="text-red-700 hover:bg-red-50"
                          onClick={() => setToDelete(f)}
                          aria-label={`Delete ${f.name}`}
                        >
                          Delete
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        )}
      </div>
      <ConfirmDialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        title={`Delete ${toDelete?.name}?`}
        message={toDelete?.type === 'CAMPUS' ? 'This is a campus boundary. Check-in and campus events depend on it.' : 'This cannot be undone.'}
        confirmLabel="Delete"
        loading={del.isPending}
        onConfirm={() =>
          del.mutate(toDelete.id, {
            onSuccess: () => {
              toast.success('Geofence deleted');
              setToDelete(null);
            },
            onError: (e) => toast.error('Could not delete', getErrorMessage(e)),
          })
        }
      />
    </div>
  );
}
