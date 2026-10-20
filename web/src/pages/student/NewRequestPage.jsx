import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Crosshair, FileUp, Paperclip, Send, Sparkles, X } from 'lucide-react';
import { useCreateOutpass, usePredict } from '../../api/hooks';
import { uploadFile } from '../../api/endpoints';
import { getApiError, getErrorMessage } from '../../api/client';
import { Button, Card, CardBody, CardHeader, Field, Input, LinkButton, PageHeader, Select, Textarea } from '../../components/ui';
import { LocationPickerMap } from '../../components/map/MapBits';
import { Modal } from '../../components/Modal';
import { AiPrediction } from '../../components/AiPreview';
import { useToast } from '../../components/Toast';
import { DESTINATION_TYPES, REASON_CATEGORIES, humanize } from '../../lib/constants';
import { formatDateTime, isoToLocalInput, localInputToIso } from '../../lib/format';
import { getCurrentPosition } from '../../lib/geo';
import DailyPassForm from './DailyPassForm';

const MAX_DAYS = 30;

function defaultTimes() {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setMinutes(0, 0, 0);
  const r = new Date(d.getTime() + 6 * 60 * 60 * 1000);
  return { depart: isoToLocalInput(d.toISOString()), ret: isoToLocalInput(r.toISOString()) };
}

export default function NewRequestPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const fileRef = useRef(null);
  const times = defaultTimes();
  const [form, setForm] = useState({
    reason: '',
    reason_category: 'HOME_VISIT',
    destination_type: 'HOME',
    dest_address: '',
    depart_at: times.depart,
    expected_return_at: times.ret,
  });
  const [passType, setPassType] = useState('ONE_TIME');
  const [pos, setPos] = useState(null);
  const [errors, setErrors] = useState({});
  const [attachment, setAttachment] = useState(null); // { name, url }
  const [uploading, setUploading] = useState(false);
  const [locating, setLocating] = useState(false);
  const [preview, setPreview] = useState(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const predict = usePredict();
  const create = useCreateOutpass();

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const validate = () => {
    const errs = {};
    if (!form.reason.trim()) errs.reason = 'Please describe the reason for leaving';
    else if (form.reason.trim().length < 3) errs.reason = 'Reason is too short';
    if (!form.dest_address.trim()) errs.dest_address = 'Enter the destination address';
    if (!pos) errs.location = 'Pick the destination on the map (click on the map) or use your location';
    const depIso = localInputToIso(form.depart_at);
    const retIso = localInputToIso(form.expected_return_at);
    if (!depIso) errs.depart_at = 'Choose a departure time';
    if (!retIso) errs.expected_return_at = 'Choose an expected return time';
    if (depIso && new Date(depIso).getTime() < Date.now() - 15 * 60 * 1000) errs.depart_at = 'Departure cannot be in the past';
    if (depIso && retIso) {
      const diff = new Date(retIso) - new Date(depIso);
      if (diff <= 0) errs.expected_return_at = 'Return must be after departure';
      else if (diff > MAX_DAYS * 24 * 3600 * 1000) errs.expected_return_at = `Outpass can be at most ${MAX_DAYS} days`;
    }
    setErrors(errs);
    return { ok: Object.keys(errs).length === 0, depIso, retIso };
  };

  const buildBody = (depIso, retIso) => ({
    reason: form.reason.trim(),
    reason_category: form.reason_category,
    destination_type: form.destination_type,
    dest_address: form.dest_address.trim(),
    dest_lat: pos.lat,
    dest_lng: pos.lng,
    depart_at: depIso,
    expected_return_at: retIso,
    ...(attachment?.url ? { attachment_url: attachment.url } : {}),
  });

  const onReview = (e) => {
    e.preventDefault();
    const { ok, depIso, retIso } = validate();
    if (!ok) {
      toast.error('Please fix the highlighted fields');
      return;
    }
    setPreview(null);
    setPreviewOpen(true);
    predict.mutate(
      {
        reason_category: form.reason_category,
        destination_type: form.destination_type,
        dest_lat: pos.lat,
        dest_lng: pos.lng,
        depart_at: depIso,
        expected_return_at: retIso,
      },
      { onSuccess: (p) => setPreview(p) },
    );
  };

  const onSubmit = () => {
    const { ok, depIso, retIso } = validate();
    if (!ok) {
      setPreviewOpen(false);
      return;
    }
    create.mutate(buildBody(depIso, retIso), {
      onSuccess: (o) => {
        toast.success('Request submitted', 'Your warden has been notified.');
        navigate(`/student/requests/${o.id}`, { replace: true });
      },
      onError: (err) => {
        const ae = getApiError(err);
        if (ae.code === 'VALIDATION_ERROR' && ae.details && typeof ae.details === 'object' && !Array.isArray(ae.details)) {
          const fieldErrs = {};
          Object.entries(ae.details).forEach(([k, v]) => {
            fieldErrs[k] = Array.isArray(v) ? v.join(', ') : String(v);
          });
          setErrors((x) => ({ ...x, ...fieldErrs }));
        }
        setPreviewOpen(false);
        toast.error('Could not submit request', getErrorMessage(err));
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
    if (!/^(image\/(jpeg|png)|application\/pdf)$/.test(file.type)) {
      toast.error('Unsupported file', 'Attach a JPG, PNG or PDF.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('File too large', 'Maximum size is 5 MB.');
      return;
    }
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

  return (
    <div>
      <PageHeader
        back={
          <LinkButton to="/student/requests" variant="ghost" size="sm" icon={ArrowLeft} className="-ml-2 mb-2">
            My requests
          </LinkButton>
        }
        title="New outpass request"
        subtitle="Fill in the details. You'll see an AI delay-risk preview before submitting."
      />
      <div className="mb-6 grid max-w-md grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1" role="radiogroup" aria-label="Pass type">
        {[
          ['ONE_TIME', 'One-time trip'],
          ['DAILY', 'Daily pass'],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={passType === value}
            onClick={() => setPassType(value)}
            className={`rounded-lg px-3 py-2 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
              passType === value ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {passType === 'DAILY' ? (
        <DailyPassForm />
      ) : (
      <>
      <form onSubmit={onReview} noValidate className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader title="Trip details" />
          <CardBody className="space-y-4">
            <Field label="Reason" htmlFor="reason" error={errors.reason} required>
              <Textarea
                id="reason"
                value={form.reason}
                onChange={set('reason')}
                placeholder="e.g. Sister's wedding at home"
                invalid={!!errors.reason}
                maxLength={500}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Category" htmlFor="cat" required>
                <Select id="cat" value={form.reason_category} onChange={set('reason_category')}>
                  {REASON_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {humanize(c)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Destination type" required>
                <div className="flex gap-2" role="radiogroup" aria-label="Destination type">
                  {DESTINATION_TYPES.map((t) => (
                    <button
                      key={t}
                      type="button"
                      role="radio"
                      aria-checked={form.destination_type === t}
                      onClick={() => setForm((f) => ({ ...f, destination_type: t }))}
                      className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                        form.destination_type === t
                          ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                          : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {humanize(t)}
                    </button>
                  ))}
                </div>
              </Field>
            </div>
            <Field label="Destination address" htmlFor="addr" error={errors.dest_address} required>
              <Input
                id="addr"
                value={form.dest_address}
                onChange={set('dest_address')}
                placeholder="House no, street, city"
                invalid={!!errors.dest_address}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Departure" htmlFor="dep" error={errors.depart_at} required hint="Your local time">
                <Input id="dep" type="datetime-local" value={form.depart_at} onChange={set('depart_at')} invalid={!!errors.depart_at} />
              </Field>
              <Field label="Expected return" htmlFor="ret" error={errors.expected_return_at} required hint="Your local time">
                <Input
                  id="ret"
                  type="datetime-local"
                  value={form.expected_return_at}
                  min={form.depart_at}
                  onChange={set('expected_return_at')}
                  invalid={!!errors.expected_return_at}
                />
              </Field>
            </div>
            <Field label="Attachment (optional)" hint="Supporting document — JPG, PNG or PDF up to 5 MB.">
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,application/pdf"
                className="sr-only"
                onChange={(e) => onFile(e.target.files?.[0])}
                aria-label="Attach a supporting document"
              />
              {attachment ? (
                <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                  <Paperclip className="h-4 w-4 text-slate-400" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">{attachment.name}</span>
                  <button
                    type="button"
                    onClick={() => setAttachment(null)}
                    className="rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                    aria-label="Remove attachment"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <Button variant="secondary" icon={FileUp} loading={uploading} onClick={() => fileRef.current?.click()}>
                  Choose file
                </Button>
              )}
            </Field>
          </CardBody>
        </Card>

        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader
              title="Destination on map"
              subtitle="Click the map to drop a pin. Drag it to adjust."
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
              {pos ? (
                <p className="text-xs text-slate-500">
                  Selected: {pos.lat.toFixed(5)}, {pos.lng.toFixed(5)}
                </p>
              ) : (
                <p className={`text-xs ${errors.location ? 'font-medium text-red-600' : 'text-slate-500'}`} role={errors.location ? 'alert' : undefined}>
                  {errors.location || 'No location selected yet.'}
                </p>
              )}
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
        title="Review your request"
        description="Our model estimates the chance of a late return. Staff will see this score."
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
            <p className="font-medium text-slate-900">{form.reason}</p>
            <p className="text-slate-500">
              {humanize(form.reason_category)} · {humanize(form.destination_type)} — {form.dest_address}
            </p>
            <p className="mt-1 text-slate-600">
              {formatDateTime(localInputToIso(form.depart_at))} → {formatDateTime(localInputToIso(form.expected_return_at))}
            </p>
          </div>
          {predict.isPending ? (
            <p className="flex items-center gap-2 text-sm text-slate-500" role="status">
              <Sparkles className="h-4 w-4 animate-pulse text-indigo-600" aria-hidden="true" /> Calculating delay risk…
            </p>
          ) : predict.isError ? (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800" role="alert">
              Risk preview unavailable ({getErrorMessage(predict.error)}). You can still submit your request.
            </p>
          ) : (
            preview && <AiPrediction prediction={preview} />
          )}
        </div>
      </Modal>
      </>
      )}
    </div>
  );
}
