import { useEffect, useRef, useState } from 'react';
import { Download, Pencil, Search, Upload, UserMinus, UserPlus, Users } from 'lucide-react';
import {
  useCreateUser,
  useDeactivateUser,
  useDepartments,
  useHostels,
  useImportUsers,
  useUpdateUser,
  useUsers,
} from '../../api/hooks';
import { getApiError, getErrorMessage } from '../../api/client';
import { Avatar, Button, Card, Checkbox, Field, Input, PageHeader, Select, Table, Td, Th } from '../../components/ui';
import { EmptyState, QueryState } from '../../components/States';
import { Pagination } from '../../components/Pagination';
import { RoleBadge } from '../../components/Badges';
import { ConfirmDialog, Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { ROLES, ROLE_LABELS } from '../../lib/constants';
import { downloadText } from '../../lib/download';

const EMPTY = { role: 'student', name: '', email: '', phone: '', password: '', roll_no: '', department_id: '', hostel_id: '', photo_url: '', is_active: true };

const SAMPLE_CSV = [
  'role,name,email,phone,roll_no,department,hostel,password',
  'student,Riya Menon,riya.menon@smartoutpass.edu,+919800000101,S2024101,Computer Science,Girls Hostel A,TempPass@2026',
  'student,Kabir Rao,kabir.rao@smartoutpass.edu,+919800000102,S2024102,Mechanical Engineering,Boys Hostel A,TempPass@2026',
  'parent,Suresh Menon,suresh.menon@example.com,+919800000201,,,,TempPass@2026',
  'faculty,Dr. Anita Shah,anita.shah@smartoutpass.edu,+919800000301,,Computer Science,,TempPass@2026',
].join('\n');

function UserFormModal({ open, onClose, user }) {
  const toast = useToast();
  const departments = useDepartments();
  const hostels = useHostels();
  const create = useCreateUser();
  const update = useUpdateUser();
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const editing = !!user;

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setForm(
      user
        ? {
            role: user.role,
            name: user.name || '',
            email: user.email || '',
            phone: user.phone || '',
            password: '',
            roll_no: user.roll_no || '',
            department_id: user.department_id ?? '',
            hostel_id: user.hostel_id ?? '',
            photo_url: user.photo_url || '',
            is_active: user.is_active !== false,
          }
        : EMPTY,
    );
  }, [open, user]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const isStudent = form.role === 'student';

  const submit = (e) => {
    e.preventDefault();
    const errs = {};
    if (!form.name.trim()) errs.name = 'Name is required';
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) errs.email = 'Enter a valid email';
    if (!editing && form.password.length < 8) errs.password = 'At least 8 characters';
    if (editing && form.password && form.password.length < 8) errs.password = 'At least 8 characters';
    if (isStudent && !form.roll_no.trim()) errs.roll_no = 'Roll number is required for students';
    setErrors(errs);
    if (Object.keys(errs).length) return;

    const body = {
      role: form.role,
      name: form.name.trim(),
      email: form.email.trim().toLowerCase(),
      phone: form.phone.trim() || null,
      roll_no: isStudent ? form.roll_no.trim().toUpperCase() : null,
      department_id: form.department_id ? Number(form.department_id) : null,
      hostel_id: form.hostel_id ? Number(form.hostel_id) : null,
      photo_url: form.photo_url.trim() || null,
    };
    if (form.password) body.password = form.password;
    if (editing) body.is_active = form.is_active;

    const opts = {
      onSuccess: () => {
        toast.success(editing ? 'User updated' : 'User created');
        onClose();
      },
      onError: (err) => {
        const ae = getApiError(err);
        if (ae.code === 'CONFLICT') setErrors({ email: ae.message });
        toast.error(editing ? 'Could not update user' : 'Could not create user', getErrorMessage(err));
      },
    };
    if (editing) update.mutate({ id: user.id, body }, opts);
    else create.mutate(body, opts);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? `Edit ${user.name}` : 'Create user'}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="user-form" loading={create.isPending || update.isPending}>
            {editing ? 'Save changes' : 'Create user'}
          </Button>
        </>
      }
    >
      <form id="user-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
        <Field label="Role" htmlFor="u-role" required>
          <Select id="u-role" value={form.role} onChange={set('role')}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Full name" htmlFor="u-name" error={errors.name} required>
          <Input id="u-name" value={form.name} onChange={set('name')} invalid={!!errors.name} />
        </Field>
        <Field label="Email" htmlFor="u-email" error={errors.email} required>
          <Input id="u-email" type="email" value={form.email} onChange={set('email')} invalid={!!errors.email} />
        </Field>
        <Field label="Phone" htmlFor="u-phone">
          <Input id="u-phone" type="tel" value={form.phone} onChange={set('phone')} />
        </Field>
        <Field label={editing ? 'New password (optional)' : 'Password'} htmlFor="u-pw" error={errors.password} required={!editing}>
          <Input id="u-pw" type="password" autoComplete="new-password" value={form.password} onChange={set('password')} invalid={!!errors.password} />
        </Field>
        {isStudent && (
          <Field label="Roll number" htmlFor="u-roll" error={errors.roll_no} required>
            <Input id="u-roll" value={form.roll_no} onChange={set('roll_no')} invalid={!!errors.roll_no} className="uppercase" />
          </Field>
        )}
        <Field label="Department" htmlFor="u-dept">
          <Select id="u-dept" value={form.department_id} onChange={set('department_id')}>
            <option value="">—</option>
            {(departments.data || []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </Field>
        {(isStudent || form.role === 'warden') && (
          <Field label="Hostel" htmlFor="u-hostel">
            <Select id="u-hostel" value={form.hostel_id} onChange={set('hostel_id')}>
              <option value="">—</option>
              {(hostels.data || []).map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Photo URL" htmlFor="u-photo" className="sm:col-span-2">
          <Input id="u-photo" value={form.photo_url} onChange={set('photo_url')} placeholder="https://…" />
        </Field>
        {editing && (
          <Checkbox
            className="sm:col-span-2"
            checked={form.is_active}
            onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
            label="Account is active"
          />
        )}
      </form>
    </Modal>
  );
}

function ImportModal({ open, onClose }) {
  const toast = useToast();
  const importUsers = useImportUsers();
  const fileRef = useRef(null);
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (open) {
      setFile(null);
      setResult(null);
    }
  }, [open]);

  const run = () => {
    if (!file) return;
    importUsers.mutate(file, {
      onSuccess: (r) => {
        setResult(r);
        toast.success('Import finished', `${r.created} created, ${r.skipped} skipped`);
      },
      onError: (err) => toast.error('Import failed', getErrorMessage(err)),
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Import users from CSV"
      description="Header: role,name,email,phone,roll_no,department,hostel,password"
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button icon={Upload} onClick={run} loading={importUsers.isPending} disabled={!file}>
            Import
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Button variant="ghost" size="sm" icon={Download} onClick={() => downloadText('smartoutpass-users-sample.csv', SAMPLE_CSV)}>
          Download sample CSV
        </Button>
        <div
          className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 p-6 text-center"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files?.[0];
            if (f) setFile(f);
          }}
        >
          <Upload className="h-8 w-8 text-slate-400" aria-hidden="true" />
          <p className="text-sm text-slate-600">{file ? file.name : 'Drag a CSV file here, or'}</p>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            aria-label="Choose CSV file"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
          <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()}>
            {file ? 'Choose another file' : 'Choose file'}
          </Button>
        </div>
        {result && (
          <div className="space-y-3" role="status">
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="rounded-lg bg-emerald-50 p-3">
                <p className="text-2xl font-bold text-emerald-700">{result.created}</p>
                <p className="text-xs text-emerald-800">Created</p>
              </div>
              <div className="rounded-lg bg-amber-50 p-3">
                <p className="text-2xl font-bold text-amber-700">{result.skipped}</p>
                <p className="text-xs text-amber-800">Skipped</p>
              </div>
              <div className="rounded-lg bg-red-50 p-3">
                <p className="text-2xl font-bold text-red-700">{result.errors?.length || 0}</p>
                <p className="text-xs text-red-800">Errors</p>
              </div>
            </div>
            {result.errors?.length > 0 && (
              <ul className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-red-100 bg-red-50/50 p-3 text-sm text-red-800">
                {result.errors.map((er, i) => (
                  <li key={i}>
                    <span className="font-semibold">Line {er.line}:</span> {er.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

export default function UsersPage() {
  const toast = useToast();
  const [role, setRole] = useState('');
  const [active, setActive] = useState('true');
  const [hostel, setHostel] = useState('');
  const [dept, setDept] = useState('');
  const [input, setInput] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState(null); // null | 'new' | user
  const [importOpen, setImportOpen] = useState(false);
  const [toDeactivate, setToDeactivate] = useState(null);
  const departments = useDepartments();
  const hostels = useHostels();
  const deactivate = useDeactivateUser();

  useEffect(() => {
    const t = setTimeout(() => {
      setQ(input.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [input]);

  const query = useUsers({ role, q, is_active: active, hostel_id: hostel, department_id: dept, page, pageSize: 20 });
  const resetPage = (fn) => (e) => {
    fn(e.target.value);
    setPage(1);
  };

  return (
    <div>
      <PageHeader
        title="Users"
        subtitle="Create, edit, deactivate and bulk-import accounts."
        actions={
          <>
            <Button variant="secondary" icon={Upload} onClick={() => setImportOpen(true)}>
              Import CSV
            </Button>
            <Button icon={UserPlus} onClick={() => setEditing('new')}>
              New user
            </Button>
          </>
        }
      />
      <Card className="mb-4 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <Field label="Search" htmlFor="us-q" className="lg:col-span-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" aria-hidden="true" />
              <Input id="us-q" className="pl-9" placeholder="Name, email or roll no" value={input} onChange={(e) => setInput(e.target.value)} />
            </div>
          </Field>
          <Field label="Role" htmlFor="us-role">
            <Select id="us-role" value={role} onChange={resetPage(setRole)}>
              <option value="">All roles</option>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Status" htmlFor="us-active">
            <Select id="us-active" value={active} onChange={resetPage(setActive)}>
              <option value="">All</option>
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </Select>
          </Field>
          <Field label="Hostel" htmlFor="us-hostel">
              <Select id="us-hostel" value={hostel} onChange={resetPage(setHostel)}>
                <option value="">Any hostel</option>
                {(hostels.data || []).map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Department" htmlFor="us-dept">
              <Select id="us-dept" value={dept} onChange={resetPage(setDept)}>
                <option value="">Any department</option>
                {(departments.data || []).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </Field>
        </div>
      </Card>
      <Card>
        <QueryState query={query} empty={<EmptyState icon={Users} title="No users match" />}>
          {(data) => (
            <>
              <Table>
                <thead>
                  <tr>
                    <Th>User</Th>
                    <Th>Role</Th>
                    <Th className="hidden md:table-cell">Roll no</Th>
                    <Th className="hidden lg:table-cell">Department / Hostel</Th>
                    <Th>Status</Th>
                    <Th className="text-right">Actions</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {data.items.map((u) => (
                    <tr key={u.id}>
                      <Td>
                        <div className="flex items-center gap-3">
                          <Avatar src={u.photo_url} name={u.name} size={32} />
                          <div className="min-w-0">
                            <p className="truncate font-medium text-slate-900">{u.name}</p>
                            <p className="truncate text-xs text-slate-500">{u.email}</p>
                          </div>
                        </div>
                      </Td>
                      <Td>
                        <RoleBadge role={u.role} />
                      </Td>
                      <Td className="hidden md:table-cell">{u.roll_no || '—'}</Td>
                      <Td className="hidden text-xs lg:table-cell">
                        {[u.department, u.hostel].filter(Boolean).join(' · ') || '—'}
                      </Td>
                      <Td>
                        {u.is_active ? (
                          <span className="text-xs font-semibold text-emerald-700">Active</span>
                        ) : (
                          <span className="text-xs font-semibold text-slate-500">Inactive</span>
                        )}
                      </Td>
                      <Td className="whitespace-nowrap text-right">
                        <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEditing(u)} aria-label={`Edit ${u.name}`}>
                          Edit
                        </Button>
                        {u.is_active && (
                          <Button
                            size="sm"
                            variant="ghost"
                            icon={UserMinus}
                            className="text-red-700 hover:bg-red-50"
                            onClick={() => setToDeactivate(u)}
                            aria-label={`Deactivate ${u.name}`}
                          >
                            Deactivate
                          </Button>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              <Pagination meta={data.meta} page={page} onPageChange={setPage} />
            </>
          )}
        </QueryState>
      </Card>

      <UserFormModal open={!!editing} onClose={() => setEditing(null)} user={editing && editing !== 'new' ? editing : null} />
      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} />
      <ConfirmDialog
        open={!!toDeactivate}
        onClose={() => setToDeactivate(null)}
        title={`Deactivate ${toDeactivate?.name}?`}
        message="They will no longer be able to sign in. You can re-activate the account later by editing it."
        confirmLabel="Deactivate"
        loading={deactivate.isPending}
        onConfirm={() =>
          deactivate.mutate(toDeactivate.id, {
            onSuccess: () => {
              toast.success('User deactivated');
              setToDeactivate(null);
            },
            onError: (e) => toast.error('Could not deactivate', getErrorMessage(e)),
          })
        }
      />
    </div>
  );
}
