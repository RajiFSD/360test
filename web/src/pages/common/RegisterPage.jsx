import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import clsx from 'clsx';
import { ArrowLeft, CheckCircle2, Eye, EyeOff, GraduationCap, Plus, ShieldCheck, Trash2, UserPlus, Users } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { registrationApi } from '../../api/endpoints';
import { getApiError } from '../../api/client';
import { Button, Field, Input, Select } from '../../components/ui';
import { ROLE_HOME } from '../../lib/constants';

// Mirrors the server rules (server/src/routes/register.routes.js); the server re-validates everything.
const PHONE_RE = /^(?:\+?91[\s-]?|0)?[6-9]\d{9}$/;
const ROLL_RE = /^(?=.*\d)[A-Z0-9][A-Z0-9/-]{2,19}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RELATIONS = ['Father', 'Mother', 'Guardian'];
const MAX_CHILDREN = 5;

const emptyChild = () => ({ roll_no: '', relation: '' });
const initial = {
  name: '',
  roll_no: '',
  email: '',
  phone: '',
  department_id: '',
  hostel_id: '',
  password: '',
  confirm_password: '',
  children: [emptyChild()],
};

function validate(role, f) {
  const e = {};
  if (f.name.trim().length < 2) e.name = 'Enter your full name';
  if (!EMAIL_RE.test(f.email.trim())) e.email = 'Enter a valid email address';
  if (!PHONE_RE.test(f.phone.replace(/[\s-]/g, ''))) e.phone = 'Enter a valid 10-digit Indian mobile number (optionally with +91)';
  if (role === 'student') {
    if (!ROLL_RE.test(f.roll_no.trim().toUpperCase())) e.roll_no = 'Enter a valid roll number (3–20 letters/digits, at least one digit)';
    if (!f.department_id) e.department_id = 'Choose your department';
    if (!f.hostel_id) e.hostel_id = 'Choose your hostel';
  } else {
    const seen = new Set();
    f.children.forEach((c, i) => {
      const roll = c.roll_no.trim().toUpperCase();
      if (!ROLL_RE.test(roll)) e[`children.${i}.roll_no`] = "Enter your child's roll number";
      else if (seen.has(roll)) e[`children.${i}.roll_no`] = 'This roll number is already listed';
      seen.add(roll);
      if (!RELATIONS.includes(c.relation)) e[`children.${i}.relation`] = 'Choose a relation';
    });
  }
  if (f.password.length < 8) e.password = 'Use at least 8 characters';
  else if (!/[A-Za-z]/.test(f.password) || !/\d/.test(f.password)) e.password = 'Use at least one letter and one number';
  if (f.confirm_password !== f.password) e.confirm_password = 'Passwords do not match';
  return e;
}

function payload(role, f) {
  const common = { role, name: f.name.trim(), email: f.email.trim(), phone: f.phone.trim(), password: f.password, confirm_password: f.confirm_password };
  if (role === 'student') {
    return { ...common, roll_no: f.roll_no.trim(), department_id: Number(f.department_id), hostel_id: Number(f.hostel_id) };
  }
  return { ...common, children: f.children.map((c) => ({ roll_no: c.roll_no.trim(), relation: c.relation })) };
}

function PasswordInput({ id, value, onChange, invalid, autoComplete }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input id={id} type={show ? 'text' : 'password'} autoComplete={autoComplete} value={value} onChange={onChange} invalid={invalid} className="pr-10" />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-400 hover:text-slate-600 focus:outline-none focus-visible:text-indigo-600"
        aria-label={show ? 'Hide password' : 'Show password'}
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

export default function RegisterPage() {
  const { user } = useAuth();
  const [role, setRole] = useState('student');
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(null);
  const [options, setOptions] = useState({ departments: [], hostels: [], loading: true, error: null });

  useEffect(() => {
    let cancelled = false;
    registrationApi
      .options()
      .then((o) => !cancelled && setOptions({ departments: o.departments || [], hostels: o.hostels || [], loading: false, error: null }))
      .catch((err) => !cancelled && setOptions({ departments: [], hostels: [], loading: false, error: getApiError(err).message }));
    return () => {
      cancelled = true;
    };
  }, []);

  if (user) return <Navigate to={ROLE_HOME[user.role] || '/'} replace />;

  const set = (key) => (e) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
    setErrors((er) => ({ ...er, [key]: undefined }));
  };
  const setChild = (i, key, value) => {
    setForm((f) => ({ ...f, children: f.children.map((c, j) => (j === i ? { ...c, [key]: value } : c)) }));
    setErrors((er) => ({ ...er, [`children.${i}.${key}`]: undefined }));
  };

  const submit = async (e) => {
    e.preventDefault();
    setFormError(null);
    const errs = validate(role, form);
    setErrors(errs);
    if (Object.keys(errs).length) {
      setFormError('Please fix the highlighted fields.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await registrationApi.register(payload(role, form));
      setDone(res?.message || 'Registration submitted. You can sign in after the admin approves your account.');
    } catch (err) {
      const ae = getApiError(err);
      if (ae.code === 'VALIDATION_ERROR' && Array.isArray(ae.details)) {
        const fieldErrs = {};
        ae.details.forEach((d) => d.path && (fieldErrs[d.path] = d.message));
        setErrors(fieldErrs);
        setFormError('Please fix the highlighted fields.');
      } else {
        setFormError(ae.code === 'RATE_LIMITED' ? 'Too many attempts from this network. Please try again later.' : ae.message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const err = (k) => errors[k];

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
          <h1 className="text-4xl font-bold leading-tight">Create your account</h1>
          <p className="mt-4 text-indigo-100">
            Students and parents can register here. The college office reviews every registration before the account can be used.
          </p>
          <p className="mt-4 text-sm text-indigo-200">Wardens, faculty and security staff receive their accounts from the college administrator.</p>
        </div>
        <p className="text-xs text-indigo-200">© {new Date().getFullYear()} SmartOutpass</p>
      </section>

      <section className="flex flex-1 items-start justify-center px-4 py-10 sm:px-8 lg:items-center">
        <div className="w-full max-w-lg">
          <div className="mb-8 flex items-center gap-2 lg:hidden">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-white">
              <ShieldCheck className="h-6 w-6" aria-hidden="true" />
            </span>
            <span className="text-xl font-bold text-slate-900">
              Smart<span className="text-indigo-600">Outpass</span>
            </span>
          </div>

          {done ? (
            <div className="space-y-6" role="status">
              <div className="flex items-start gap-3 rounded-xl bg-emerald-50 p-5 text-emerald-800">
                <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0" aria-hidden="true" />
                <div>
                  <h2 className="text-lg font-semibold">Registration submitted</h2>
                  <p className="mt-1 text-sm">{done}</p>
                </div>
              </div>
              <Link to="/login" className="inline-flex items-center gap-2 text-sm font-semibold text-indigo-600 hover:text-indigo-700">
                <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to sign in
              </Link>
            </div>
          ) : (
            <>
              <h2 className="text-2xl font-bold text-slate-900">Create an account</h2>
              <p className="mt-1 text-sm text-slate-500">Your account is activated after the college admin approves it.</p>

              <div className="mt-6 grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1" role="radiogroup" aria-label="I am a">
                {[
                  ['student', 'I am a Student', GraduationCap],
                  ['parent', 'I am a Parent', Users],
                ].map(([value, label, Icon]) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={role === value}
                    onClick={() => {
                      setRole(value);
                      setErrors({});
                      setFormError(null);
                    }}
                    className={clsx(
                      'flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500',
                      role === value ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-600 hover:text-slate-900',
                    )}
                  >
                    <Icon className="h-4 w-4" aria-hidden="true" />
                    {label}
                  </button>
                ))}
              </div>

              <form className="mt-6 space-y-4" onSubmit={submit} noValidate>
                <Field label="Full name" htmlFor="r-name" error={err('name')} required>
                  <Input id="r-name" autoComplete="name" value={form.name} onChange={set('name')} invalid={!!err('name')} />
                </Field>

                {role === 'student' && (
                  <Field label="Roll number" htmlFor="r-roll" error={err('roll_no')} required>
                    <Input id="r-roll" autoComplete="off" value={form.roll_no} onChange={set('roll_no')} invalid={!!err('roll_no')} className="uppercase" />
                  </Field>
                )}

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Email" htmlFor="r-email" error={err('email')} required>
                    <Input id="r-email" type="email" autoComplete="email" value={form.email} onChange={set('email')} invalid={!!err('email')} />
                  </Field>
                  <Field label="Mobile number" htmlFor="r-phone" error={err('phone')} hint="10 digits, +91 optional" required>
                    <Input id="r-phone" type="tel" autoComplete="tel" value={form.phone} onChange={set('phone')} invalid={!!err('phone')} placeholder="+91 98765 43210" />
                  </Field>
                </div>

                {role === 'student' && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Department" htmlFor="r-dept" error={err('department_id')} required>
                      <Select id="r-dept" value={form.department_id} onChange={set('department_id')} invalid={!!err('department_id')} disabled={options.loading}>
                        <option value="">{options.loading ? 'Loading…' : 'Choose…'}</option>
                        {options.departments.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Hostel" htmlFor="r-hostel" error={err('hostel_id')} required>
                      <Select id="r-hostel" value={form.hostel_id} onChange={set('hostel_id')} invalid={!!err('hostel_id')} disabled={options.loading}>
                        <option value="">{options.loading ? 'Loading…' : 'Choose…'}</option>
                        {options.hostels.map((h) => (
                          <option key={h.id} value={h.id}>
                            {h.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  </div>
                )}

                {role === 'parent' && (
                  <fieldset className="space-y-3 rounded-xl border border-slate-200 p-4">
                    <legend className="px-1 text-sm font-medium text-slate-700">Your child (student at the college)</legend>
                    {form.children.map((c, i) => (
                      <div key={i} className="grid grid-cols-[1fr_9rem_auto] items-start gap-2">
                        <Field label={i === 0 ? 'Roll number' : `Roll number ${i + 1}`} htmlFor={`r-child-${i}`} error={err(`children.${i}.roll_no`)} required>
                          <Input
                            id={`r-child-${i}`}
                            value={c.roll_no}
                            onChange={(e) => setChild(i, 'roll_no', e.target.value)}
                            invalid={!!err(`children.${i}.roll_no`)}
                            className="uppercase"
                          />
                        </Field>
                        <Field label="Relation" htmlFor={`r-rel-${i}`} error={err(`children.${i}.relation`)} required>
                          <Select id={`r-rel-${i}`} value={c.relation} onChange={(e) => setChild(i, 'relation', e.target.value)} invalid={!!err(`children.${i}.relation`)}>
                            <option value="">Choose…</option>
                            {RELATIONS.map((r) => (
                              <option key={r} value={r}>
                                {r}
                              </option>
                            ))}
                          </Select>
                        </Field>
                        <div className="pt-6">
                          <Button
                            variant="ghost"
                            size="sm"
                            icon={Trash2}
                            disabled={form.children.length === 1}
                            onClick={() => setForm((f) => ({ ...f, children: f.children.filter((_, j) => j !== i) }))}
                            aria-label={`Remove child ${i + 1}`}
                          />
                        </div>
                      </div>
                    ))}
                    {err('children') && <p className="text-sm text-red-600">{err('children')}</p>}
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={Plus}
                      disabled={form.children.length >= MAX_CHILDREN}
                      onClick={() => setForm((f) => ({ ...f, children: [...f.children, emptyChild()] }))}
                    >
                      Add another child
                    </Button>
                    <p className="text-xs text-slate-500">The college verifies each parent–child link before you can see any trip details.</p>
                  </fieldset>
                )}

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Password" htmlFor="r-pw" error={err('password')} hint="8+ characters, a letter and a number" required>
                    <PasswordInput id="r-pw" autoComplete="new-password" value={form.password} onChange={set('password')} invalid={!!err('password')} />
                  </Field>
                  <Field label="Confirm password" htmlFor="r-pw2" error={err('confirm_password')} required>
                    <PasswordInput id="r-pw2" autoComplete="new-password" value={form.confirm_password} onChange={set('confirm_password')} invalid={!!err('confirm_password')} />
                  </Field>
                </div>

                {options.error && (
                  <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800" role="alert">
                    Could not load departments and hostels: {options.error}
                  </p>
                )}
                {formError && (
                  <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
                    {formError}
                  </p>
                )}

                <Button type="submit" size="lg" className="w-full" loading={submitting} icon={UserPlus}>
                  Submit registration
                </Button>
              </form>

              <p className="mt-6 text-center text-sm text-slate-600">
                <Link to="/login" className="inline-flex items-center gap-1 font-semibold text-indigo-600 hover:text-indigo-700">
                  <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to sign in
                </Link>
              </p>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
