import { useEffect, useMemo, useState } from 'react';
import { RotateCcw, Save } from 'lucide-react';
import { useAdminSettings, useUpdateSettings } from '../../api/hooks';
import { getErrorMessage } from '../../api/client';
import { Button, Card, Field, Input, PageHeader, Toggle } from '../../components/ui';
import { ErrorState } from '../../components/States';
import { SkeletonList } from '../../components/Spinner';
import { useToast } from '../../components/Toast';
import { humanize } from '../../lib/constants';

const GROUPS = [
  {
    title: 'Location tracking',
    keys: [
      ['tracking_interval_moving_sec', 'Ping interval while moving', 'seconds'],
      ['tracking_interval_idle_sec', 'Ping interval while idle', 'seconds'],
      ['tracking_interval_low_battery_sec', 'Ping interval on low battery', 'seconds'],
      ['tracking_overrun_max_min', 'Tracking allowed after expected return', 'minutes'],
      ['signal_lost_min', 'Signal-lost alert after', 'minutes'],
      ['ping_retention_days', 'Keep location pings for', 'days'],
    ],
  },
  {
    title: 'Geofencing',
    keys: [
      ['destination_radius_m', 'Destination radius', 'metres'],
      ['geofence_max_accuracy_m', 'Ignore fixes less accurate than', 'metres'],
      ['geofence_debounce_count', 'Consecutive pings to confirm enter/exit', 'pings'],
    ],
  },
  {
    title: 'Overdue & escalation',
    keys: [
      ['overdue_grace_min', 'Grace period before overdue', 'minutes'],
      ['escalation_student_min', 'Remind student after', 'minutes late'],
      ['escalation_warden_min', 'Escalate to warden after', 'minutes late'],
      ['escalation_parent_min', 'Escalate to parents after', 'minutes late'],
      ['return_autocomplete_grace_min', 'Auto-complete after campus return', 'minutes'],
    ],
  },
  {
    title: 'Messaging',
    keys: [['sms_enabled', 'Send SMS alerts', null]],
  },
];

export default function SettingsPage() {
  const toast = useToast();
  const q = useAdminSettings();
  const save = useUpdateSettings();
  const [values, setValues] = useState({});

  useEffect(() => {
    if (q.data) setValues(q.data);
  }, [q.data]);

  const known = useMemo(() => new Set(GROUPS.flatMap((g) => g.keys.map((k) => k[0]))), []);
  const extraKeys = Object.keys(q.data || {}).filter((k) => !known.has(k));
  const dirty = q.data && Object.keys(values).some((k) => String(values[k]) !== String(q.data[k]));

  const submit = (e) => {
    e.preventDefault();
    const body = {};
    Object.keys(values).forEach((k) => {
      if (String(values[k]) === String(q.data[k])) return;
      const orig = q.data[k];
      if (typeof orig === 'number') body[k] = Number(values[k]);
      else if (typeof orig === 'boolean') body[k] = !!values[k];
      else body[k] = values[k];
    });
    if (!Object.keys(body).length) return;
    const bad = Object.entries(body).find(([, v]) => typeof v === 'number' && (Number.isNaN(v) || v < 0));
    if (bad) {
      toast.error('Invalid value', `${humanize(bad[0])} must be a non-negative number.`);
      return;
    }
    save.mutate(body, {
      onSuccess: () => toast.success('Settings saved'),
      onError: (er) => toast.error('Could not save settings', getErrorMessage(er)),
    });
  };

  const renderField = (key, label, unit) => {
    if (!(key in values)) return null;
    const v = values[key];
    const orig = q.data?.[key];
    if (typeof orig === 'boolean') {
      return (
        <div key={key} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2.5">
          <span className="text-sm font-medium text-slate-700">{label}</span>
          <Toggle checked={!!v} onChange={(nv) => setValues((s) => ({ ...s, [key]: nv }))} label={label} />
        </div>
      );
    }
    return (
      <Field key={key} label={label} htmlFor={`s-${key}`} hint={unit ? `In ${unit}` : undefined}>
        <Input
          id={`s-${key}`}
          type={typeof orig === 'number' ? 'number' : 'text'}
          min={typeof orig === 'number' ? 0 : undefined}
          value={v ?? ''}
          onChange={(e) => setValues((s) => ({ ...s, [key]: e.target.value }))}
        />
      </Field>
    );
  };

  return (
    <div>
      <PageHeader title="Settings" subtitle="System-wide tracking, geofence and escalation parameters." />
      {q.isPending ? (
        <Card className="p-5">
          <SkeletonList rows={6} />
        </Card>
      ) : q.isError ? (
        <Card>
          <ErrorState error={q.error} onRetry={q.refetch} />
        </Card>
      ) : (
        <form onSubmit={submit} className="space-y-6">
          {GROUPS.map((g) => {
            const fields = g.keys.map(([k, l, u]) => renderField(k, l, u)).filter(Boolean);
            if (!fields.length) return null;
            return (
              <Card key={g.title} className="p-4 sm:p-5">
                <h2 className="mb-4 text-base font-semibold text-slate-900">{g.title}</h2>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{fields}</div>
              </Card>
            );
          })}
          {extraKeys.length > 0 && (
            <Card className="p-4 sm:p-5">
              <h2 className="mb-4 text-base font-semibold text-slate-900">Other</h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{extraKeys.map((k) => renderField(k, humanize(k), null))}</div>
            </Card>
          )}
          <div className="sticky bottom-20 flex justify-end gap-2 lg:bottom-4">
            <Button variant="secondary" icon={RotateCcw} disabled={!dirty} onClick={() => setValues(q.data)}>
              Reset
            </Button>
            <Button type="submit" icon={Save} disabled={!dirty} loading={save.isPending}>
              Save settings
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
