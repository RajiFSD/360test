import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Search, UserX } from 'lucide-react';
import { gateApi } from '../../api/endpoints';
import { getApiError } from '../../api/client';
import { Avatar, Button, Card, Field, Input, LinkButton, PageHeader } from '../../components/ui';
import { EmptyState } from '../../components/States';
import { StatusBadge } from '../../components/Badges';
import { DateTime } from '../../components/DateTime';
import { GateErrorScreen, GateSuccessScreen, GateVerifyScreen } from './GateScreens';

export default function ManualLookupPage() {
  const qc = useQueryClient();
  const [roll, setRoll] = useState('');
  const [loading, setLoading] = useState(false);
  const [lookup, setLookup] = useState(null);
  const [lookupError, setLookupError] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [stage, setStage] = useState('search'); // search | confirm | success | error

  const search = async (e) => {
    e.preventDefault();
    const r = roll.trim().toUpperCase();
    if (!r) return;
    setLoading(true);
    setLookup(null);
    setLookupError(null);
    try {
      const data = await gateApi.lookup(r);
      setLookup(data);
    } catch (err) {
      setLookupError(getApiError(err));
    } finally {
      setLoading(false);
    }
  };

  const confirm = async () => {
    setConfirming(true);
    try {
      const r = await gateApi.manual(lookup.trip.id, lookup.action, note.trim() || undefined);
      setResult(r);
      setStage('success');
      qc.invalidateQueries({ queryKey: ['gate'] });
    } catch (err) {
      setError(getApiError(err));
      setStage('error');
    } finally {
      setConfirming(false);
    }
  };

  const reset = () => {
    setStage('search');
    setLookup(null);
    setLookupError(null);
    setResult(null);
    setError(null);
    setNote('');
    setRoll('');
  };

  if (stage === 'confirm' && lookup) {
    return (
      <div className="mx-auto max-w-2xl">
        <PageHeader title="Manual gate entry" />
        <GateVerifyScreen
          result={lookup}
          confirming={confirming}
          onConfirm={confirm}
          onCancel={() => setStage('search')}
          showNote
          note={note}
          onNoteChange={setNote}
        />
      </div>
    );
  }
  if (stage === 'success' && result) {
    return (
      <div className="mx-auto max-w-2xl">
        <PageHeader title="Manual gate entry" />
        <GateSuccessScreen result={result} onNext={reset} />
      </div>
    );
  }
  if (stage === 'error' && error) {
    return (
      <div className="mx-auto max-w-2xl">
        <PageHeader title="Manual gate entry" />
        <GateErrorScreen error={error} onNext={reset} nextLabel="Start over" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Manual lookup"
        subtitle="Find a student by roll number when the QR code can't be scanned."
        actions={
          <LinkButton to="/security/scan" variant="secondary" size="sm">
            Back to scanner
          </LinkButton>
        }
      />
      <Card className="p-4">
        <form onSubmit={search} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <Field label="Roll number" htmlFor="roll" className="flex-1">
            <Input
              id="roll"
              value={roll}
              onChange={(e) => setRoll(e.target.value)}
              placeholder="S2024001"
              autoCapitalize="characters"
              autoComplete="off"
              className="text-lg uppercase"
            />
          </Field>
          <Button type="submit" size="lg" icon={Search} loading={loading} disabled={!roll.trim()}>
            Look up
          </Button>
        </form>
      </Card>

      {lookupError && (
        <Card className="mt-4">
          <EmptyState
            icon={UserX}
            title={lookupError.code === 'NOT_FOUND' ? 'No student with that roll number' : 'Lookup failed'}
            message={lookupError.message}
          />
        </Card>
      )}

      {lookup && (
        <Card className="mt-4 p-5">
          <div className="flex flex-col items-center gap-3 text-center sm:flex-row sm:text-left">
            <Avatar src={lookup.student?.photo_url} name={lookup.student?.name} size={88} />
            <div className="flex-1">
              <p className="text-xl font-bold text-slate-900">{lookup.student?.name}</p>
              <p className="font-medium text-slate-600">{lookup.student?.roll_no}</p>
              <p className="text-sm text-slate-500">{[lookup.student?.hostel, lookup.student?.department].filter(Boolean).join(' · ')}</p>
            </div>
          </div>
          {lookup.trip ? (
            <div className="mt-4 space-y-3 rounded-xl bg-slate-50 p-4 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium text-slate-900">{lookup.outpass?.reason || lookup.trip.reason}</p>
                <StatusBadge status={lookup.trip.status} />
              </div>
              <p className="text-slate-600">
                Expected return: <DateTime value={lookup.trip.expected_return_at} />
              </p>
              {lookup.action ? (
                <Button size="lg" className="w-full" onClick={() => setStage('confirm')}>
                  Record {lookup.action}
                </Button>
              ) : (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-800">No gate action is currently allowed for this trip.</p>
              )}
            </div>
          ) : (
            <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800" role="status">
              This student has no approved or active outpass. Do not allow exit.
            </p>
          )}
        </Card>
      )}
    </div>
  );
}
