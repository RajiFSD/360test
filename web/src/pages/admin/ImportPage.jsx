import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { CheckCircle2, Download, FileSearch, FileUp, KeyRound, RotateCcw, Upload } from 'lucide-react';
import { importApi } from '../../api/endpoints';
import { getErrorMessage } from '../../api/client';
import { Badge, Button, Card, CardBody, CardHeader, Field, Input, PageHeader, Table, Tabs, Td, Th } from '../../components/ui';
import { EmptyState } from '../../components/States';
import { useToast } from '../../components/Toast';
import { downloadText } from '../../lib/download';

const TYPES = [
  {
    value: 'students',
    label: 'Students',
    columns: ['name', 'roll_no', 'email', 'phone', 'department', 'hostel'],
    help: 'Department and hostel must match existing names exactly (Departments & hostels page). Students sign in with their roll number.',
    users: true,
  },
  { value: 'parents', label: 'Parents', columns: ['name', 'email', 'phone'], help: 'Import parents before linking them to students.', users: true },
  {
    value: 'staff',
    label: 'Wardens / faculty / security',
    columns: ['name', 'role', 'email', 'phone', 'hostel'],
    help: 'role is warden, faculty or security. hostel is only for wardens and makes them that hostel’s warden.',
    users: true,
  },
  {
    value: 'links',
    label: 'Parent–student links',
    columns: ['student_roll_no', 'parent_phone_or_email', 'relation', 'verified'],
    help: 'Import students and parents first. verified is true/false; only verified parents get notifications and live location.',
    users: false,
  },
];

const STATUS_STYLE = {
  ok: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  duplicate: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  error: 'bg-red-50 text-red-700 ring-red-600/20',
};
const STATUS_LABEL = { ok: 'Will import', duplicate: 'Already exists — skip', error: 'Error' };

const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function displayValue(type, col, data) {
  if (type === 'links') {
    if (col === 'student_roll_no') return data.student_name ? `${data.student_roll_no} · ${data.student_name}` : data.student_roll_no;
    if (col === 'parent_phone_or_email') return data.parent_name || '—';
    if (col === 'verified') return data.verified == null ? '—' : data.verified ? 'Yes' : 'No';
    return data[col] ?? '—';
  }
  if (col === 'department') return data.department_id ? '✓' : '—';
  if (col === 'hostel') return data.hostel_id ? '✓' : '—';
  return data[col] || '—';
}

export default function ImportPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const fileRef = useRef(null);
  const [type, setType] = useState('students');
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [tempPassword, setTempPassword] = useState('');
  const [busy, setBusy] = useState(null); // 'preview' | 'commit' | 'template'
  const [filter, setFilter] = useState('all');

  const meta = TYPES.find((t) => t.value === type);

  const reset = (nextType = type) => {
    setType(nextType);
    setFile(null);
    setPreview(null);
    setResult(null);
    setFilter('all');
    if (fileRef.current) fileRef.current.value = '';
  };

  const downloadTemplate = async () => {
    setBusy('template');
    try {
      downloadText(`smartoutpass-${type}-template.csv`, await importApi.template(type));
    } catch (err) {
      toast.error('Could not download template', getErrorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const runPreview = async (f = file) => {
    if (!f) return;
    setBusy('preview');
    setResult(null);
    try {
      setPreview(await importApi.preview(type, f));
      setFilter('all');
    } catch (err) {
      setPreview(null);
      toast.error('Could not read the CSV', getErrorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const commit = async () => {
    if (tempPassword && tempPassword.length < 8) {
      toast.error('Temporary password too short', 'Use at least 8 characters, or leave it empty to generate one per user.');
      return;
    }
    setBusy('commit');
    try {
      const r = await importApi.commit(type, file, meta.users ? tempPassword : undefined);
      setResult(r);
      setPreview(null);
      queryClient.invalidateQueries();
      toast.success(`Imported ${r.created} ${r.created === 1 ? 'row' : 'rows'}`, r.skipped || r.failed ? `${r.skipped} skipped, ${r.failed} with errors` : undefined);
    } catch (err) {
      toast.error('Import failed — nothing was saved', getErrorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const downloadCredentials = () => {
    const rows = result.credentials.map((c) => [c.name, c.role, c.login, c.email, c.temporary_password].map(csvCell).join(','));
    downloadText(`smartoutpass-${type}-credentials.csv`, ['name,role,login,email,temporary_password', ...rows].join('\r\n'));
  };

  const downloadErrors = (rows) => {
    const lines = rows.filter((r) => r.status !== 'ok').map((r) => [r.line, r.status, r.message].map(csvCell).join(','));
    downloadText(`smartoutpass-${type}-problems.csv`, ['line,status,problem', ...lines].join('\r\n'));
  };

  const rows = preview?.rows || [];
  const shown = filter === 'all' ? rows : rows.filter((r) => r.status === filter);

  return (
    <div className="space-y-6">
      <PageHeader title="Bulk import" subtitle="Upload CSV files of your real students, parents, staff and parent links. Nothing is saved until you confirm." />

      <Tabs tabs={TYPES.map((t) => ({ value: t.value, label: t.label }))} value={type} onChange={(v) => reset(v)} />

      <Card>
        <CardHeader
          title={`1. Prepare the ${meta.label.toLowerCase()} CSV`}
          subtitle={meta.help}
          actions={
            <Button variant="secondary" icon={Download} loading={busy === 'template'} onClick={downloadTemplate}>
              Download template
            </Button>
          }
        />
        <CardBody className="space-y-4">
          <p className="text-sm text-slate-600">
            Columns:{' '}
            {meta.columns.map((c) => (
              <code key={c} className="mr-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700">
                {c}
              </code>
            ))}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              aria-label="Choose CSV file"
              onChange={(e) => {
                const f = e.target.files?.[0] || null;
                setFile(f);
                setResult(null);
                if (f) runPreview(f);
              }}
            />
            <Button icon={FileUp} variant="secondary" onClick={() => fileRef.current?.click()}>
              {file ? 'Choose another file' : 'Choose CSV file'}
            </Button>
            {file && (
              <>
                <span className="text-sm text-slate-700">{file.name}</span>
                <Button variant="ghost" icon={FileSearch} loading={busy === 'preview'} onClick={() => runPreview()}>
                  Re-check
                </Button>
              </>
            )}
          </div>
        </CardBody>
      </Card>

      {busy === 'preview' && !preview && (
        <Card>
          <CardBody className="text-sm text-slate-600">Checking every row…</CardBody>
        </Card>
      )}

      {preview && (
        <Card>
          <CardHeader
            title="2. Preview"
            subtitle={`${preview.summary.total} rows · ${preview.summary.ok} will be imported · ${preview.summary.duplicate} already exist · ${preview.summary.error} with errors`}
            actions={
              preview.summary.error + preview.summary.duplicate > 0 && (
                <Button variant="ghost" size="sm" icon={Download} onClick={() => downloadErrors(rows)}>
                  Download problems
                </Button>
              )
            }
          />
          <CardBody className="space-y-4">
            <div className="flex flex-wrap gap-2" role="group" aria-label="Filter rows">
              {[
                ['all', `All (${preview.summary.total})`],
                ['ok', `Will import (${preview.summary.ok})`],
                ['duplicate', `Skipped (${preview.summary.duplicate})`],
                ['error', `Errors (${preview.summary.error})`],
              ].map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setFilter(v)}
                  aria-pressed={filter === v}
                  className={clsx(
                    'rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset',
                    filter === v ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-white text-slate-600 ring-slate-300 hover:bg-slate-50',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            {shown.length === 0 ? (
              <EmptyState title="No rows in this filter" />
            ) : (
              <Table className="max-h-[28rem] overflow-y-auto rounded-lg border border-slate-200">
                <thead className="sticky top-0">
                  <tr>
                    <Th>Line</Th>
                    <Th>Status</Th>
                    {meta.columns.map((c) => (
                      <Th key={c}>{c}</Th>
                    ))}
                    <Th>Problem / note</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {shown.map((r) => (
                    <tr key={r.line} className={r.status === 'error' ? 'bg-red-50/40' : undefined}>
                      <Td className="tabular-nums text-slate-500">{r.line}</Td>
                      <Td>
                        <Badge className={STATUS_STYLE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                      </Td>
                      {meta.columns.map((c) => (
                        <Td key={c} className="max-w-[14rem] truncate">
                          {displayValue(type, c, r.data)}
                        </Td>
                      ))}
                      <Td className={clsx('min-w-[16rem] text-xs', r.status === 'error' ? 'text-red-700' : 'text-slate-500')}>
                        {r.message || '—'}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}

            <div className="space-y-4 border-t border-slate-200 pt-4">
              {meta.users && (
                <Field
                  label="Temporary password (optional)"
                  htmlFor="imp-pw"
                  hint="Leave empty to generate a different random password per user (download them after import). Everyone must change it at first login."
                >
                  <Input
                    id="imp-pw"
                    type="text"
                    autoComplete="off"
                    value={tempPassword}
                    onChange={(e) => setTempPassword(e.target.value)}
                    placeholder="e.g. a shared password you will send to users"
                    className="max-w-sm"
                  />
                </Field>
              )}
              <div className="flex flex-wrap items-center gap-3">
                <Button icon={Upload} loading={busy === 'commit'} disabled={!preview.summary.ok} onClick={commit}>
                  Confirm import of {preview.summary.ok} {preview.summary.ok === 1 ? 'row' : 'rows'}
                </Button>
                <Button variant="ghost" icon={RotateCcw} onClick={() => reset()}>
                  Cancel
                </Button>
                {preview.summary.error > 0 && (
                  <span className="text-sm text-slate-600">Rows with errors are not imported. Fix them in the CSV and upload again.</span>
                )}
              </div>
            </div>
          </CardBody>
        </Card>
      )}

      {result && (
        <Card>
          <CardHeader title="3. Done" subtitle={`${result.created} imported · ${result.skipped} skipped (already existed) · ${result.failed} not imported (errors)`} />
          <CardBody className="space-y-4">
            <div className="flex items-start gap-3 rounded-lg bg-emerald-50 p-4 text-sm text-emerald-800">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
              <span>
                {result.created} {meta.label.toLowerCase()} saved.
                {meta.users && result.created > 0 && ' Each new account must set its own password at first sign-in.'}
              </span>
            </div>
            {meta.users && result.credentials?.length > 0 && (
              <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                <KeyRound className="h-5 w-5 shrink-0" aria-hidden="true" />
                <span className="flex-1">
                  {tempPassword
                    ? 'All new accounts use the temporary password you entered.'
                    : 'Download the sign-in details now: generated passwords are shown only once and are not stored in readable form.'}
                </span>
                <Button variant="warning" icon={Download} onClick={downloadCredentials}>
                  Download sign-in list
                </Button>
              </div>
            )}
            <Button variant="secondary" icon={FileUp} onClick={() => reset()}>
              Import another file
            </Button>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
