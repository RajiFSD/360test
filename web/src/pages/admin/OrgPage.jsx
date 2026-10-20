import { useEffect, useState } from 'react';
import { Building2, GraduationCap, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  useAdminDepartments,
  useAdminHostels,
  useDeleteDepartment,
  useDeleteHostel,
  useSaveDepartment,
  useSaveHostel,
  useUsers,
} from '../../api/hooks';
import { getErrorMessage } from '../../api/client';
import { Button, Card, Field, Input, PageHeader, Select, Table, Td, Th } from '../../components/ui';
import { EmptyState, QueryState } from '../../components/States';
import { ConfirmDialog, Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';

function DepartmentModal({ open, onClose, item }) {
  const toast = useToast();
  const save = useSaveDepartment();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [errors, setErrors] = useState({});
  useEffect(() => {
    if (open) {
      setName(item?.name || '');
      setCode(item?.code || '');
      setErrors({});
    }
  }, [open, item]);
  const submit = (e) => {
    e.preventDefault();
    const errs = {};
    if (!name.trim()) errs.name = 'Name is required';
    if (!code.trim()) errs.code = 'Code is required';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    save.mutate(
      { id: item?.id, body: { name: name.trim(), code: code.trim().toUpperCase() } },
      {
        onSuccess: () => {
          toast.success(item ? 'Department updated' : 'Department created');
          onClose();
        },
        onError: (er) => toast.error('Could not save department', getErrorMessage(er)),
      },
    );
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={item ? 'Edit department' : 'New department'}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="dept-form" loading={save.isPending}>
            Save
          </Button>
        </>
      }
    >
      <form id="dept-form" onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Name" htmlFor="d-name" error={errors.name} required>
          <Input id="d-name" value={name} onChange={(e) => setName(e.target.value)} invalid={!!errors.name} />
        </Field>
        <Field label="Code" htmlFor="d-code" error={errors.code} required hint="Short code, e.g. CSE">
          <Input id="d-code" value={code} onChange={(e) => setCode(e.target.value)} invalid={!!errors.code} className="uppercase" />
        </Field>
      </form>
    </Modal>
  );
}

function HostelModal({ open, onClose, item }) {
  const toast = useToast();
  const save = useSaveHostel();
  const wardens = useUsers({ role: 'warden', pageSize: 100, is_active: true }, { enabled: open });
  const [name, setName] = useState('');
  const [wardenId, setWardenId] = useState('');
  const [error, setError] = useState(null);
  useEffect(() => {
    if (open) {
      setName(item?.name || '');
      setWardenId(item?.warden_id ?? '');
      setError(null);
    }
  }, [open, item]);
  const submit = (e) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    save.mutate(
      { id: item?.id, body: { name: name.trim(), warden_id: wardenId ? Number(wardenId) : null } },
      {
        onSuccess: () => {
          toast.success(item ? 'Hostel updated' : 'Hostel created');
          onClose();
        },
        onError: (er) => toast.error('Could not save hostel', getErrorMessage(er)),
      },
    );
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={item ? 'Edit hostel' : 'New hostel'}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="hostel-form" loading={save.isPending}>
            Save
          </Button>
        </>
      }
    >
      <form id="hostel-form" onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Name" htmlFor="h-name" error={error} required>
          <Input id="h-name" value={name} onChange={(e) => setName(e.target.value)} invalid={!!error} />
        </Field>
        <Field label="Warden" htmlFor="h-warden" hint={wardens.isError ? 'Could not load wardens' : undefined}>
          <Select id="h-warden" value={wardenId} onChange={(e) => setWardenId(e.target.value)} disabled={wardens.isPending}>
            <option value="">No warden assigned</option>
            {(wardens.data?.items || []).map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </Select>
        </Field>
      </form>
    </Modal>
  );
}

export default function OrgPage() {
  const toast = useToast();
  const departments = useAdminDepartments();
  const hostels = useAdminHostels();
  const wardens = useUsers({ role: 'warden', pageSize: 100 });
  const delDept = useDeleteDepartment();
  const delHostel = useDeleteHostel();
  const [deptModal, setDeptModal] = useState(null); // null | 'new' | item
  const [hostelModal, setHostelModal] = useState(null);
  const [toDelete, setToDelete] = useState(null); // { kind, item }
  const wardenName = (id) => (wardens.data?.items || []).find((w) => w.id === id)?.name;

  const confirmDelete = () => {
    const m = toDelete.kind === 'dept' ? delDept : delHostel;
    m.mutate(toDelete.item.id, {
      onSuccess: () => {
        toast.success(`${toDelete.kind === 'dept' ? 'Department' : 'Hostel'} deleted`);
        setToDelete(null);
      },
      onError: (e) => toast.error('Could not delete', getErrorMessage(e)),
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Departments & hostels" subtitle="Organisation structure used for students and wardens." />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 sm:px-5">
            <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
              <GraduationCap className="h-5 w-5 text-indigo-600" aria-hidden="true" /> Departments
            </h2>
            <Button size="sm" icon={Plus} onClick={() => setDeptModal('new')}>
              Add
            </Button>
          </div>
          <QueryState query={departments} empty={<EmptyState title="No departments yet" />}>
            {(list) => (
              <Table>
                <thead>
                  <tr>
                    <Th>Name</Th>
                    <Th>Code</Th>
                    <Th className="text-right">Actions</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {list.map((d) => (
                    <tr key={d.id}>
                      <Td className="font-medium text-slate-900">{d.name}</Td>
                      <Td>
                        <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">{d.code}</code>
                      </Td>
                      <Td className="whitespace-nowrap text-right">
                        <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setDeptModal(d)} aria-label={`Edit ${d.name}`}>
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={Trash2}
                          className="text-red-700 hover:bg-red-50"
                          onClick={() => setToDelete({ kind: 'dept', item: d })}
                          aria-label={`Delete ${d.name}`}
                        >
                          Delete
                        </Button>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </QueryState>
        </Card>

        <Card>
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 sm:px-5">
            <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
              <Building2 className="h-5 w-5 text-indigo-600" aria-hidden="true" /> Hostels
            </h2>
            <Button size="sm" icon={Plus} onClick={() => setHostelModal('new')}>
              Add
            </Button>
          </div>
          <QueryState query={hostels} empty={<EmptyState title="No hostels yet" />}>
            {(list) => (
              <Table>
                <thead>
                  <tr>
                    <Th>Name</Th>
                    <Th>Warden</Th>
                    <Th className="text-right">Actions</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {list.map((h) => (
                    <tr key={h.id}>
                      <Td className="font-medium text-slate-900">{h.name}</Td>
                      <Td>{h.warden_name || h.warden?.name || wardenName(h.warden_id) || (h.warden_id ? `#${h.warden_id}` : '—')}</Td>
                      <Td className="whitespace-nowrap text-right">
                        <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setHostelModal(h)} aria-label={`Edit ${h.name}`}>
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={Trash2}
                          className="text-red-700 hover:bg-red-50"
                          onClick={() => setToDelete({ kind: 'hostel', item: h })}
                          aria-label={`Delete ${h.name}`}
                        >
                          Delete
                        </Button>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </QueryState>
        </Card>
      </div>

      <DepartmentModal open={!!deptModal} onClose={() => setDeptModal(null)} item={deptModal && deptModal !== 'new' ? deptModal : null} />
      <HostelModal open={!!hostelModal} onClose={() => setHostelModal(null)} item={hostelModal && hostelModal !== 'new' ? hostelModal : null} />
      <ConfirmDialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        title={`Delete ${toDelete?.item?.name}?`}
        message="Users assigned to it will no longer have it set. This cannot be undone."
        confirmLabel="Delete"
        loading={delDept.isPending || delHostel.isPending}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
