import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { KeyRound, LogOut, ShieldCheck } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useChangePassword } from '../../api/hooks';
import { getApiError, getErrorMessage } from '../../api/client';
import { Button, Card, CardBody, Field, Input } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { ROLE_HOME } from '../../lib/constants';

/** Shown after first login with a temporary password; every other page is blocked until it succeeds. */
export default function ChangePasswordPage() {
  const { user, updateUser, logout } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const changePw = useChangePassword();
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [errors, setErrors] = useState({});

  if (!user) return <Navigate to="/login" replace />;
  if (!user.must_change_password) return <Navigate to={ROLE_HOME[user.role] || '/'} replace />;

  const submit = (e) => {
    e.preventDefault();
    const errs = {};
    if (!pw.currentPassword) errs.currentPassword = 'Enter the temporary password you signed in with';
    if (pw.newPassword.length < 8) errs.newPassword = 'Use at least 8 characters';
    else if (pw.newPassword === pw.currentPassword) errs.newPassword = 'Choose a password different from the temporary one';
    if (pw.newPassword !== pw.confirm) errs.confirm = 'Passwords do not match';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    changePw.mutate(
      { currentPassword: pw.currentPassword, newPassword: pw.newPassword },
      {
        onSuccess: (result) => {
          updateUser(result?.user || { ...user, must_change_password: false });
          toast.success('Password changed', 'Welcome to SmartOutpass.');
          navigate(ROLE_HOME[user.role] || '/', { replace: true });
        },
        onError: (err) => {
          const ae = getApiError(err);
          if (/current password/i.test(ae.message || '')) setErrors({ currentPassword: 'Temporary password is incorrect' });
          else toast.error('Could not change password', getErrorMessage(err));
        },
      },
    );
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <Card className="w-full max-w-md">
        <CardBody className="space-y-5">
          <div className="flex items-start gap-3">
            <span className="rounded-xl bg-indigo-50 p-2.5 text-indigo-600">
              <ShieldCheck className="h-6 w-6" aria-hidden="true" />
            </span>
            <div>
              <h1 className="text-xl font-semibold text-slate-900">Set your own password</h1>
              <p className="mt-1 text-sm text-slate-600">
                Hi {user.name}, your account was created with a temporary password. Choose a new one to continue.
              </p>
            </div>
          </div>
          <form onSubmit={submit} className="space-y-4" noValidate>
            <Field label="Temporary password" htmlFor="cp-cur" error={errors.currentPassword} required>
              <Input
                id="cp-cur"
                type="password"
                autoComplete="current-password"
                autoFocus
                value={pw.currentPassword}
                invalid={!!errors.currentPassword}
                onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })}
              />
            </Field>
            <Field label="New password" htmlFor="cp-new" error={errors.newPassword} hint="At least 8 characters." required>
              <Input
                id="cp-new"
                type="password"
                autoComplete="new-password"
                value={pw.newPassword}
                invalid={!!errors.newPassword}
                onChange={(e) => setPw({ ...pw, newPassword: e.target.value })}
              />
            </Field>
            <Field label="Confirm new password" htmlFor="cp-confirm" error={errors.confirm} required>
              <Input
                id="cp-confirm"
                type="password"
                autoComplete="new-password"
                value={pw.confirm}
                invalid={!!errors.confirm}
                onChange={(e) => setPw({ ...pw, confirm: e.target.value })}
              />
            </Field>
            <Button type="submit" icon={KeyRound} loading={changePw.isPending} className="w-full">
              Save new password
            </Button>
          </form>
          <Button variant="ghost" icon={LogOut} onClick={logout} className="w-full">
            Sign out
          </Button>
        </CardBody>
      </Card>
    </div>
  );
}
