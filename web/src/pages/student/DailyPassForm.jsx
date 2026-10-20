import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { Crosshair, FileUp, Paperclip, Send, Sparkles, X } from 'lucide-react';
import { useCreateOutpass, usePredict } from '../../api/hooks';
import { uploadFile } from '../../api/endpoints';
import { getApiError, getErrorMessage } from '../../api/client';
import { Button, Card, CardBody, CardHeader, Checkbox, Field, Input, Select, Textarea } from '../../components/ui';
import { LocationPickerMap } from '../../components/map/MapBits';
import { Modal } from '../../components/Modal';
import { AiPrediction } from '../../components/AiPreview';
import { useToast } from '../../components/Toast';
import { DAILY_CATEGORIES, WEEKDAYS } from '../../lib/constants';
import { getCurrentPosition } from '../../lib/geo';

const MAX_DAYS = 90; // server setting daily_pass_max_days (re-validated there)
const JS_DAY = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const CONSENT =
  'I agree to share my live location with my warden and linked parents during the scheduled daily windows of this pass only. I can stop at any time.';

/** Today's date in campus local time (IST) as YYYY-MM-DD. */
const istToday = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const addDays = (d, n) => new Date(new Date(`${d}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);
const dayOf = (d) => JS_DAY[new Date(`${d}T00:00:00Z`).getUTCDay()];

function scheduledDates(start, end, days) {
  const out = [];
  for (let d = start; d && end && d <= end && out.length < 400; d = addDays(d, 1)) if (days.includes(dayOf(d))) out.push(d);
  return out;
}

export default function DailyPassForm() {
  const navigate = useNavigate();
  const toast = useToast();
  const fileRef = useRef(null);
  const today = istToday();
  const [form, setForm] = useState({
    reason: '',
    reason_category: 'COLLEGE_WORK',
    dest_name: '',
    dest_address: '',
    start_date: today,
    end_date: addDays(today, 27),
    days_of_week: ['MON', 'TUE', 'WED', 'THU', 'FRI'],
    depart_time: '08:00',
    return_time: '18:00',
    consent: false,
  });
  const [pos, setPos] = useState(null);
  const [errors, setErrors] = useState({});
  const [attachment, setAttachment] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [locating, setLocating] = useState(false);
  const [preview, setPreview] = useState(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const predict = usePredict();
  const create = useCreateOutpass();

  const set = (k) => (e) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setErrors((x) => ({ ...x, [k]: undefined }));
  };
  const toggleDay = (d) => {
    setForm((f) => ({ ...f, days_of_week: f.days_of_week.includes(d) ? f.days_of_week.filter((x) => x !== d) : [...f.days_of_week, d] }));
    setErrors((x) => ({ ...x, days_of_week: undefined }));
  };
  const dates = scheduledDates(form.start_date, form.end_date, form.days_of_week);

  const validate = () => {
    const e = {};
    if (form.reason.trim().length < 3) e.reason = 'Describe the purpose (at least 3 characters)';
    if (form.dest_name.trim().length < 2) e.dest_name = 'Enter the place name';
    if (form.dest_address.trim().length < 3) e.dest_address = 'Enter the address';
    if (!pos) e.location = 'Pick the place on the map';
    if (!form.start_date) e.start_date = 'Choose a start date';
    else if (form.start_date < today) e.start_date = 'Start date cannot be in the past';
    if (!form.end_date) e.end_date = 'Choose an end date';
    else if (form.end_date < form.start_date) e.end_date = 'End date must be on or after the start date';
    else if ((new Date(form.end_date) - new Date(form.start_date)) / 86_400_000 + 1 > MAX_DAYS) e.end_date = `A daily pass can cover at most ${MAX_DAYS} days`;
    if (!form.days_of_week.length) e.days_of_week = 'Choose at least one day';
    else if (!e.end_date && !e.start_date && !dates.length) e.days_of_week = 'None of these days fall in the date range';
    if (!form.depart_time) e.depart_time = 'Choose a departure time';
    if (!form.return_time) e.return_time = 'Choose a return time';
    else if (form.return_time <= form.depart_time) e.return_time = 'Return time must be after departure (same day)';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const body = () => ({
    pass_type: 'DAILY',
    reason: form.reason.trim(),
    reason_category: form.reason_category,
    dest_name: form.dest_name.trim(),
    dest_address: form.dest_address.trim(),
    dest_lat: pos.lat,
    dest_lng: pos.lng,
    start_date: form.start_date,
    end_date: form.end_date,
    days_of_week: WEEKDAYS.map((d) => d.value).filter((d) => form.days_of_week.includes(d)),
    depart_time: form.depart_time,
    return_time: form.return_time,
    consent: form.consent,
    ...(attachment?.url ? { attachment_url: attachment.url } : {}),
  });

  const onReview = (ev) => {
    ev.preventDefault();
    if (!validate()) {
      toast.error('Please fix the highlighted fields');
      return;
    }
    setPreview(null);
    setPreviewOpen(true);
    // Risk for a typical day (the first scheduled one); the server uses the same rule.
    predict.mutate(
      {
        reason_category: form.reason_category,
        destination_type: 'OTHER',
        dest_lat: pos.lat,
        dest_lng: pos.lng,
        depart_at: new Date(`${dates[0]}T${form.depart_time}:00+05:30`).toISOString(),
        expected_return_at: new Date(`${dates[0]}T${form.return_time}:00+05:30`).toISOString(),
      },
      { onSuccess: (p) => setPreview(p) },
    );
  };

  const onSubmit = () => {
    create.mutate(body(), {
      onSuccess: (o) => {
        toast.success('Daily pass requested', 'Your warden has been notified.');
        navigate(`/student/requests/${o.id}`, { replace: true });
      },
      onError: (err) => {
        const ae = getApiError(err);
        if (ae.code === 'VALIDATION_ERROR' && Array.isArray(ae.details)) {
          const fe = {};
          ae.details.forEach((d) => d.path && (fe[d.path] = d.message));
          setErrors((x) => ({ ...x, ...fe }));
        }
        setPreviewOpen(false);
        toast.error('Could not submit daily pass', getErrorMessage(err));
      },
    });
  };

  const pickMyLocation = async () => {
    setLocating(true);
    try {
      const p = await getCurrentPosition();
      setPos({ lat: Number(p.coords.latitude.toFixed(6)), lng: Number(p.coords.longitude.toFixed(6)) });
      setErrors((x) => ({ ...x, location: undefined }));
    } catch (err) {
      toast.error('Location unavailable', err.message);
    } finally {
      setLocating(false);
    }
  };

  const onFile = async (file) => {
    if (!file) return;
    if (!/^(image\/(jpeg|png)|application\/pdf)$/.test(file.type)) return toast.error('Unsupported file', 'Attach a JPG, PNG or PDF.');
    if (file.size > 5 * 1024 * 1024) return toast.error('File too large', 'Maximum size is 5 MB.');
    setUploading(true);
    try {
      const { url } = await uploadFile(file);
      setAttachment({ name: file.name, url });
    } catch (err) {
      toast.error('Upload failed', getErrorMessage(err));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const dayLabels = WEEKDAYS.filter((d) => form.days_of_week.includes(d.value)).map((d) => d.label).join(', ');

  return (
    <>
      <form onSubmit={onReview} noValidate className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader title="Daily pass details" subtitle="Approved once by your warden; a new QR is issued for each scheduled day." />
          <CardBody className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Category" htmlFor="d-cat" required>
                <Select id="d-cat" value={form.reason_category} onChange={set('reason_category')}>
                  {DAILY_CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Place name" htmlFor="d-name" error={errors.dest_name} required>
                <Input id="d-name" value={form.dest_name} onChange={set('dest_name')} placeholder="e.g. Tidel Park" invalid={!!errors.dest_name} />
              </Field>
            </div>
            <Field label="Purpose" htmlFor="d-reason" error={errors.reason} required>
              <Textarea id="d-reason" value={form.reason} onChange={set('reason')} placeholder="e.g. Internship at ABC Ltd, Mon–Fri" invalid={!!errors.reason} maxLength={500} />
            </Field>
            <Field label="Address" htmlFor="d-addr" error={errors.dest_address} required>
              <Input id="d-addr" value={form.dest_address} onChange={set('dest_address')} placeholder="Building, street, city" invalid={!!errors.dest_address} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Start date" htmlFor="d-start" error={errors.start_date} required>
                <Input id="d-start" type="date" min={today} value={form.start_date} onChange={set('start_date')} invalid={!!errors.start_date} />
              </Field>
              <Field label="End date" htmlFor="d-end" error={errors.end_date} hint={`Up to ${MAX_DAYS} days`} required>
                <Input id="d-end" type="date" min={form.start_date} value={form.end_date} onChange={set('end_date')} invalid={!!errors.end_date} />
              </Field>
            </div>
            <Field label="Days of the week" error={errors.days_of_week} required hint={dates.length ? `${dates.length} scheduled days in this range` : undefined}>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Days of the week">
                {WEEKDAYS.map((d) => {
                  const on = form.days_of_week.includes(d.value);
                  return (
                    <button
                      key={d.value}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggleDay(d.value)}
                      className={clsx(
                        'min-w-[3.25rem] rounded-lg border px-3 py-2 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500',
                        on ? 'border-indigo-600 bg-indigo-50 text-indigo-700' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50',
                      )}
                    >
                      {d.label}
                    </button>
                  );
                })}
              </div>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Departure time" htmlFor="d-dep" error={errors.depart_time} required hint="Campus local time">
                <Input id="d-dep" type="time" value={form.depart_time} onChange={set('depart_time')} invalid={!!errors.depart_time} />
              </Field>
              <Field label="Return time (same day)" htmlFor="d-ret" error={errors.return_time} required>
                <Input id="d-ret" type="time" value={form.return_time} onChange={set('return_time')} invalid={!!errors.return_time} />
              </Field>
            </div>
            <Field label="Attachment (optional)" hint="e.g. internship letter — JPG, PNG or PDF up to 5 MB.">
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,application/pdf" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} aria-label="Attach a supporting document" />
              {attachment ? (
                <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                  <Paperclip className="h-4 w-4 text-slate-400" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">{attachment.name}</span>
                  <button type="button" onClick={() => setAttachment(null)} className="rounded p-1 text-slate-400 hover:bg-slate-200" aria-label="Remove attachment">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <Button variant="secondary" icon={FileUp} loading={uploading} onClick={() => fileRef.current?.click()}>
                  Choose file
                </Button>
              )}
            </Field>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <Checkbox checked={form.consent} onChange={(e) => setForm((f) => ({ ...f, consent: e.target.checked }))} label={CONSENT} />
              <p className="mt-1 pl-6 text-xs text-slate-500">Optional. You can turn this on or off later on the pass page.</p>
            </div>
          </CardBody>
        </Card>

        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader
              title="Place on map"
              subtitle="The same place every day."
              actions={
                <Button size="sm" variant="secondary" icon={Crosshair} loading={locating} onClick={pickMyLocation}>
                  Use my location
                </Button>
              }
            />
            <CardBody className="space-y-2">
              <LocationPickerMap
                value={pos}
                onChange={(v) => {
                  setPos(v);
                  setErrors((x) => ({ ...x, location: undefined }));
                }}
                className="h-72 sm:h-80"
              />
              <p className={`text-xs ${errors.location ? 'font-medium text-red-600' : 'text-slate-500'}`} role={errors.location ? 'alert' : undefined}>
                {pos ? `Selected: ${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}` : errors.location || 'No location selected yet.'}
              </p>
            </CardBody>
          </Card>
          <Button type="submit" size="lg" className="w-full" icon={Sparkles}>
            Preview risk & submit
          </Button>
        </div>
      </form>

      <Modal
        open={previewOpen}
        onClose={() => !create.isPending && setPreviewOpen(false)}
        title="Review your daily pass"
        description="Risk is estimated for a typical day of this pass. Staff will see this score."
        footer={
          <>
            <Button variant="secondary" onClick={() => setPreviewOpen(false)} disabled={create.isPending}>
              Edit details
            </Button>
            <Button icon={Send} onClick={onSubmit} loading={create.isPending} disabled={predict.isPending}>
              Confirm & submit
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="rounded-lg bg-slate-50 p-3 text-sm">
            <p className="font-medium text-slate-900">
              {form.dest_name} — {form.reason}
            </p>
            <p className="text-slate-600">
              {dayLabels} · {form.depart_time}–{form.return_time}
            </p>
            <p className="text-slate-500">
              {form.start_date} to {form.end_date} · {dates.length} days
            </p>
          </div>
          {predict.isPending ? (
            <p className="flex items-center gap-2 text-sm text-slate-500" role="status">
              <Sparkles className="h-4 w-4 animate-pulse text-indigo-600" aria-hidden="true" /> Calculating delay risk…
            </p>
          ) : predict.isError ? (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800" role="alert">
              Risk preview unavailable ({getErrorMessage(predict.error)}). You can still submit.
            </p>
          ) : (
            preview && <AiPrediction prediction={preview} />
          )}
        </div>
      </Modal>
    </>
  );
}
