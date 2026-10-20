import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ClipboardPaste, Loader2, ScanLine } from 'lucide-react';
import { gateApi } from '../../api/endpoints';
import { getApiError } from '../../api/client';
import { Button, Card, Field, LinkButton, PageHeader, Textarea } from '../../components/ui';
import { QrScanner } from './QrScanner';
import { GateErrorScreen, GateSuccessScreen, GateVerifyScreen } from './GateScreens';

export default function ScanPage() {
  const qc = useQueryClient();
  const [phase, setPhase] = useState('scan'); // scan | verifying | verified | confirming | success | error
  const [token, setToken] = useState(null);
  const [verified, setVerified] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [pasted, setPasted] = useState('');

  const verify = useCallback(async (raw) => {
    const t = String(raw || '').trim();
    if (!t) return;
    setToken(t);
    setPhase('verifying');
    setError(null);
    try {
      const r = await gateApi.verify(t);
      setVerified(r);
      setPhase('verified');
      if (navigator.vibrate) navigator.vibrate(80);
    } catch (err) {
      setError(getApiError(err));
      setPhase('error');
      if (navigator.vibrate) navigator.vibrate([120, 60, 120]);
    }
  }, []);

  const confirm = async () => {
    setPhase('confirming');
    try {
      const r = await gateApi.scan(token);
      setResult(r);
      setPhase('success');
      qc.invalidateQueries({ queryKey: ['gate'] });
    } catch (err) {
      setError(getApiError(err));
      setPhase('error');
    }
  };

  const reset = () => {
    setPhase('scan');
    setToken(null);
    setVerified(null);
    setResult(null);
    setError(null);
    setPasted('');
  };

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Gate scanner"
        subtitle="Scan the student's outpass QR to record exit or entry."
        actions={
          <LinkButton to="/security/manual" variant="secondary" size="sm">
            Manual lookup
          </LinkButton>
        }
      />

      {(phase === 'verified' || phase === 'confirming') && verified && (
        <GateVerifyScreen result={verified} confirming={phase === 'confirming'} onConfirm={confirm} onCancel={reset} />
      )}
      {phase === 'success' && result && <GateSuccessScreen result={result} onNext={reset} />}
      {phase === 'error' && error && <GateErrorScreen error={error} onNext={reset} />}

      {(phase === 'scan' || phase === 'verifying') && (
        <div className="space-y-4">
          <Card className="p-3 sm:p-4">
            <div className="relative">
              <QrScanner active={phase === 'scan'} onDecode={verify} />
              {phase === 'verifying' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-2xl bg-slate-900/70 text-white" role="status">
                  <Loader2 className="h-10 w-10 animate-spin" aria-hidden="true" />
                  <p className="font-semibold">Verifying…</p>
                </div>
              )}
            </div>
            <p className="mt-3 flex items-center gap-2 text-sm text-slate-500">
              <ScanLine className="h-4 w-4" aria-hidden="true" /> Hold the QR code inside the frame.
            </p>
          </Card>
          <Card className="p-4">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                verify(pasted);
              }}
              className="space-y-3"
            >
              <Field label="Paste token instead" htmlFor="paste-token" hint="Use this if the camera can't read the code.">
                <Textarea
                  id="paste-token"
                  rows={2}
                  value={pasted}
                  onChange={(e) => setPasted(e.target.value)}
                  placeholder="eyJhbGciOi…"
                  className="font-mono text-xs"
                />
              </Field>
              <Button type="submit" icon={ClipboardPaste} disabled={!pasted.trim() || phase === 'verifying'}>
                Verify token
              </Button>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}
