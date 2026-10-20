import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Camera, KeyRound, Save } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useChangePassword, useUpdateMe } from '../../api/hooks';
import { uploadFile } from '../../api/endpoints';
import { getApiError, getErrorMessage } from '../../api/client';
import { Avatar, Button, Card, CardBody, CardHeader, Field, Input, KeyValue, PageHeader } from '../../components/ui';
import { RoleBadge } from '../../components/Badges';
import { useToast } from '../../components/Toast';
import { DateTime } from '../../components/DateTime';

export default function ProfilePage() {
  const { user, updateUser } = useAuth();
  const toast = useToast();
  const location = useLocation();
  const pwRef = useRef(null);
  const fileRef = useRef(null);
  const updateMe = useUpdateMe();
  const changePw = useChangePassword();

  const [form, setForm] = useState({ name: user?.name || '', phone: user?.phone || '', photo_url: user?.photo_url || '' });
  const [uploading, setUploading] = useState(false);
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [pwErrors, setPwErrors] = useState({});

  useEffect(() => {
    if (location.hash === '#password' && pwRef.current) {
      pwRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
      pwRef.current.querySelector('input')?.focus();
    }
  }, [location.hash]);

  if (!user) return null;

  const saveProfile = (e) => {
    e.preventDefault();
    if (!form.name.trim()) {
      toast.error('Name is required');
      return;
    }
    updateMe.mutate(
      { name: form.name.trim(), phone: form.phone.trim() || null, photo_url: form.photo_url || null },
      {
        onSuccess: (u) => {
          updateUser({ ...user, ...u });
          toast.success('Profile updated');
        },
        onError: (err) => toast.error('Could not update profile', getErrorMessage(err)),
      },
    );
  };

  const onPhoto = async (file) => {
    if (!file) return;
    if (!/^image\/(jpeg|png)$/.test(file.type)) {
      toast.error('Unsupported file', 'Please choose a JPG or PNG image.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('File too large', 'Maximum size is 5 MB.');
      return;
    }
    setUploading(true);
    try {
      const { url } = await uploadFile(file);
      setForm((f) => ({ ...f, photo_url: url }));
      toast.info('Photo uploaded', 'Click "Save profile" to apply it.');
    } catch (err) {
      toast.error('Upload failed', getErrorMessage(err));
    } finally {
      setUploading(false);
    }
  };

  const submitPw = (e) => {
    e.preventDefault();
    const errs = {};
    if (!pw.currentPassword) errs.currentPassword = 'Enter your current password';
    if (pw.newPassword.length < 8) errs.newPassword = 'Use at least 8 characters';
    if (pw.newPassword !== pw.confirm) errs.confirm = 'Passwords do not match';
    setPwErrors(errs);
    if (Object.keys(errs).length) return;
    changePw.mutate(
      { currentPassword: pw.currentPassword, newPassword: pw.newPassword },
      {
        onSuccess: () => {
          toast.success('Password changed');
          setPw({ currentPassword: '', newPassword: '', confirm: '' });
        },
        onError: (err) => {
          const ae = getApiError(err);
          if (ae.code === 'INVALID_CREDENTIALS' || ae.status === 401) setPwErrors({ currentPassword: 'Current password is incorrect' });
          else toast.error('Could not change password', getErrorMessage(err));
        },
      },
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader title="My profile" subtitle="Manage your personal details and password." />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardBody className="flex flex-col items-center text-center">
            <Avatar src={form.photo_url || user.photo_url} name={user.name} size={96} />
            <p className="mt-3 text-lg font-semibold text-slate-900">{user.name}</p>
            <p className="text-sm text-slate-500">{user.email}</p>
            <div className="mt-2">
              <RoleBadge role={user.role} />
            </div>
            <dl className="mt-6 grid w-full grid-cols-2 gap-4 text-left">
              {user.roll_no && <KeyValue label="Roll no">{user.roll_no}</KeyValue>}
              {user.department && <KeyValue label="Department">{user.department}</KeyValue>}
              {user.hostel && <KeyValue label="Hostel">{user.hostel}</KeyValue>}
              <KeyValue label="Member since">
                <DateTime value={user.created_at} />
              </KeyValue>
            </dl>
          </CardBody>
        </Card>

        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Personal details" />
            <CardBody>
              <form onSubmit={saveProfile} className="space-y-4" noValidate>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Full name" htmlFor="p-name" required>
                    <Input id="p-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                  </Field>
                  <Field label="Phone" htmlFor="p-phone">
                    <Input
                      id="p-phone"
                      type="tel"
                      value={form.phone}
                      onChange={(e) => setForm({ ...form, phone: e.target.value })}
                      placeholder="+91…"
                    />
                  </Field>
                </div>
                <Field label="Photo" hint="JPG or PNG, up to 5 MB.">
                  <div className="flex flex-wrap items-center gap-3">
                    <input
                      ref={fileRef}
                      type="file"
                      accept="image/png,image/jpeg"
                      className="sr-only"
                      onChange={(e) => onPhoto(e.target.files?.[0])}
                      aria-label="Upload profile photo"
                    />
                    <Button variant="secondary" icon={Camera} loading={uploading} onClick={() => fileRef.current?.click()}>
                      Upload photo
                    </Button>
                    {form.photo_url && (
                      <Button variant="ghost" onClick={() => setForm({ ...form, photo_url: '' })}>
                        Remove photo
                      </Button>
                    )}
                  </div>
                </Field>
                <div className="flex justify-end">
                  <Button type="submit" icon={Save} loading={updateMe.isPending}>
                    Save profile
                  </Button>
                </div>
              </form>
            </CardBody>
          </Card>

          <Card>
            <div ref={pwRef} id="password" className="scroll-mt-20">
              <CardHeader title="Change password" subtitle="Minimum 8 characters." />
              <CardBody>
                <form onSubmit={submitPw} className="space-y-4" noValidate>
                  <Field label="Current password" htmlFor="pw-cur" error={pwErrors.currentPassword} required>
                    <Input
                      id="pw-cur"
                      type="password"
                      autoComplete="current-password"
                      value={pw.currentPassword}
                      invalid={!!pwErrors.currentPassword}
                      onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })}
                    />
                  </Field>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="New password" htmlFor="pw-new" error={pwErrors.newPassword} required>
                      <Input
                        id="pw-new"
                        type="password"
                        autoComplete="new-password"
                        value={pw.newPassword}
                        invalid={!!pwErrors.newPassword}
                        onChange={(e) => setPw({ ...pw, newPassword: e.target.value })}
                      />
                    </Field>
                    <Field label="Confirm new password" htmlFor="pw-confirm" error={pwErrors.confirm} required>
                      <Input
                        id="pw-confirm"
                        type="password"
                        autoComplete="new-password"
                        value={pw.confirm}
                        invalid={!!pwErrors.confirm}
                        onChange={(e) => setPw({ ...pw, confirm: e.target.value })}
                      />
                    </Field>
                  </div>
                  <div className="flex justify-end">
                    <Button type="submit" icon={KeyRound} loading={changePw.isPending}>
                      Change password
                    </Button>
                  </div>
                </form>
              </CardBody>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
