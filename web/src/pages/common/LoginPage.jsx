import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, LogIn, MapPinned, QrCode, ShieldCheck, Sparkles } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { getApiError } from '../../api/client';
import { Button, Field, Input } from '../../components/ui';
import { DEMO_ACCOUNTS, DEMO_PASSWORD, ROLE_HOME } from '../../lib/constants';

export default function LoginPage() {
  const { user, login, sessionExpired, clearSessionExpired } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  if (user) return <Navigate to={ROLE_HOME[user.role] || '/'} replace />;

  const doLogin = async (id, pw) => {
    setError(null);
    if (!id.trim() || !pw) {
      setError('Enter your email or roll number and your password.');
      return;
    }
    setLoading(true);
    try {
      const u = await login(id, pw);
      clearSessionExpired();
      const from = location.state?.from;
      const home = ROLE_HOME[u.role] || '/';
      navigate(from && from !== '/login' ? from : home, { replace: true });
    } catch (err) {
      const e = getApiError(err);
      if (e.code === 'INVALID_CREDENTIALS') setError('Incorrect email/roll number or password.');
      else if (e.code === 'RATE_LIMITED') setError('Too many login attempts. Please wait a few minutes and try again.');
      else setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <section className="relative hidden flex-1 flex-col justify-between overflow-hidden bg-indigo-700 p-10 text-white lg:flex">
        <div className="flex items-center gap-2">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15">
            <ShieldCheck className="h-6 w-6" aria-hidden="true" />
          </span>
          <span className="text-xl font-bold">SmartOutpass</span>
        </div>
        <div className="max-w-md">
          <h1 className="text-4xl font-bold leading-tight">Digital outpasses, safer campuses.</h1>
          <p className="mt-4 text-indigo-100">
            AI-assisted approvals, QR gate checks and consent-based live tracking — students stay in control of their location.
          </p>
          <ul className="mt-8 space-y-3 text-sm text-indigo-50">
            <li className="flex items-center gap-3">
              <Sparkles className="h-5 w-5" aria-hidden="true" /> Delay-risk prediction on every request
            </li>
            <li className="flex items-center gap-3">
              <QrCode className="h-5 w-5" aria-hidden="true" /> Rotating QR codes verified at the gate
            </li>
            <li className="flex items-center gap-3">
              <MapPinned className="h-5 w-5" aria-hidden="true" /> Opt-in live location, only for the trip
            </li>
          </ul>
        </div>
        <p className="text-xs text-indigo-200">© {new Date().getFullYear()} SmartOutpass</p>
      </section>

      <section className="flex flex-1 items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-md">
          <div className="mb-8 flex items-center gap-2 lg:hidden">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-white">
              <ShieldCheck className="h-6 w-6" aria-hidden="true" />
            </span>
            <span className="text-xl font-bold text-slate-900">
              Smart<span className="text-indigo-600">Outpass</span>
            </span>
          </div>
          <h2 className="text-2xl font-bold text-slate-900">Sign in</h2>
          <p className="mt-1 text-sm text-slate-500">Use your college email or roll number.</p>

          {sessionExpired && !error && (
            <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800" role="status">
              Your session expired. Please sign in again.
            </p>
          )}

          <form
            className="mt-6 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              doLogin(identifier, password);
            }}
            noValidate
          >
            <Field label="Email or roll number" htmlFor="identifier" required>
              <Input
                id="identifier"
                autoComplete="username"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="you@college.edu or S2024001"
                invalid={!!error}
              />
            </Field>
            <Field label="Password" htmlFor="password" required>
              <div className="relative">
                <Input
                  id="password"
                  type={showPw ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pr-10"
                  invalid={!!error}
                />
                <button
                  type="button"
                  onClick={() => setShowPw((s) => !s)}
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-400 hover:text-slate-600 focus:outline-none focus-visible:text-indigo-600"
                  aria-label={showPw ? 'Hide password' : 'Show password'}
                >
                  {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </Field>
            {error && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
                {error}
              </p>
            )}
            <Button type="submit" size="lg" className="w-full" loading={loading} icon={LogIn}>
              Sign in
            </Button>
          </form>

          <div className="mt-8">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Demo login</p>
            <p className="mt-1 text-xs text-slate-500">
              One click signs in with password <code className="rounded bg-slate-100 px-1">{DEMO_PASSWORD}</code>
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {DEMO_ACCOUNTS.map((a) => (
                <button
                  key={a.identifier}
                  type="button"
                  disabled={loading}
                  onClick={() => {
                    setIdentifier(a.identifier);
                    setPassword(DEMO_PASSWORD);
                    doLogin(a.identifier, DEMO_PASSWORD);
                  }}
                  title={a.identifier}
                  className="rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 transition hover:bg-indigo-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-50"
                >
                  {a.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
