import { useEffect, useState } from 'react';
import { Link2, Plus, Search, Trash2 } from 'lucide-react';
import { useAdminLinks, useCreateLink, useDeleteLink, useUpdateLink } from '../../api/hooks';
import { getErrorMessage } from '../../api/client';
import { Button, Card, Checkbox, Field, Input, PageHeader, Select, Table, Td, Th, Toggle } from '../../components/ui';
import { EmptyState, QueryState } from '../../components/States';
import { ConfirmDialog, Modal } from '../../components/Modal';
import { StudentInline } from '../../components/domain';
import { DateTime } from '../../components/DateTime';
import { useToast } from '../../components/Toast';
import { UserSearchSelect } from './UserSearchSelect';

const RELATIONS = ['Father', 'Mother', 'Guardian', 'Sibling', 'Other'];

function CreateLinkModal({ open, onClose }) {
  const toast = useToast();
  const create = useCreateLink();
  const [parent, setParent] = useState(null);
  const [student, setStudent] = useState(null);
  const [relation, setRelation] = useState('Father');
  const [verified, setVerified] = useState(true);
  const [errors, setErrors] = useState({});

  useEffect(() => {
    if (open) {
      setParent(null);
      setStudent(null);
      setRelation('Father');
      setVerified(true);
      setErrors({});
    }
  }, [open]);

  const submit = () => {
    const errs = {};
    if (!parent) errs.parent = 'Choose a parent';
    if (!student) errs.student = 'Choose a student';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    create.mutate(
      { parent_id: parent.id, student_id: student.id, relation, verified },
      {
        onSuccess: () => {
          toast.success('Link created', `${parent.name} → ${student.name}`);
          onClose();
        },
        onError: (e) => toast.error('Could not create link', getErrorMessage(e)),
      },
    );
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Link parent to student"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={create.isPending}>
            Create link
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Parent" htmlFor="lk-parent" error={errors.parent} required>
          <UserSearchSelect id="lk-parent" role="parent" value={parent} onChange={setParent} invalid={!!errors.parent} />
        </Field>
        <Field label="Student" htmlFor="lk-student" error={errors.student} required>
          <UserSearchSelect id="lk-student" role="student" value={student} onChange={setStudent} invalid={!!errors.student} />
        </Field>
        <Field label="Relation" htmlFor="lk-rel">
          <Select id="lk-rel" value={relation} onChange={(e) => setRelation(e.target.value)}>
            {RELATIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
        </Field>
        <Checkbox
          checked={verified}
          onChange={(e) => setVerified(e.target.checked)}
          label="Verified — the parent will receive updates and may see live location (when the student consents)."
        />
      </div>
    </Modal>
  );
}

export default function LinksPage() {
  const toast = useToast();
  const [input, setInput] = useState('');
  const [q, setQ] = useState('');
  const [verified, setVerified] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [toDelete, setToDelete] = useState(null);
  const update = useUpdateLink();
  const del = useDeleteLink();

  useEffect(() => {
    const t = setTimeout(() => setQ(input.trim()), 300);
    return () => clearTimeout(t);
  }, [input]);

  const query = useAdminLinks({ q, verified });

  return (
    <div>
      <PageHeader
        title="Parent–student links"
        subtitle="Only verified links let parents receive updates and view shared locations."
        actions={
          <Button icon={Plus} onClick={() => setCreateOpen(true)}>
            New link
          </Button>
        }
      />
      <Card className="mb-4 p-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Search" htmlFor="lk-q" className="sm:col-span-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" aria-hidden="true" />
              <Input id="lk-q" className="pl-9" placeholder="Parent or student name, roll no" value={input} onChange={(e) => setInput(e.target.value)} />
            </div>
          </Field>
          <Field label="Verification" htmlFor="lk-ver">
            <Select id="lk-ver" value={verified} onChange={(e) => setVerified(e.target.value)}>
              <option value="">All</option>
              <option value="true">Verified</option>
              <option value="false">Unverified</option>
            </Select>
          </Field>
        </div>
      </Card>
      <Card>
        <QueryState query={query} empty={<EmptyState icon={Link2} title="No links found" />}>
          {(links) => (
            <Table>
              <thead>
                <tr>
                  <Th>Parent</Th>
                  <Th>Student</Th>
                  <Th>Relation</Th>
                  <Th>Verified</Th>
                  <Th className="hidden md:table-cell">Created</Th>
                  <Th className="text-right">Actions</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {links.map((l) => (
                  <tr key={l.id}>
                    <Td>
                      <p className="font-medium text-slate-900">{l.parent?.name}</p>
                      <p className="text-xs text-slate-500">{l.parent?.email}</p>
                      {l.parent?.phone && <p className="text-xs text-slate-500">{l.parent.phone}</p>}
                    </Td>
                    <Td>
                      <StudentInline student={l.student} size={28} />
                    </Td>
                    <Td>{l.relation || '—'}</Td>
                    <Td>
                      <Toggle
                        checked={!!l.verified}
                        label={`Verified link between ${l.parent?.name} and ${l.student?.name}`}
                        disabled={update.isPending}
                        onChange={(v) =>
                          update.mutate(
                            { id: l.id, body: { verified: v } },
                            {
                              onSuccess: () => toast.success(v ? 'Link verified' : 'Link unverified'),
                              onError: (e) => toast.error('Update failed', getErrorMessage(e)),
                            },
                          )
                        }
                      />
                    </Td>
                    <Td className="hidden text-xs md:table-cell">
                      <DateTime value={l.created_at} />
                    </Td>
                    <Td className="text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={Trash2}
                        className="text-red-700 hover:bg-red-50"
                        onClick={() => setToDelete(l)}
                        aria-label={`Delete link between ${l.parent?.name} and ${l.student?.name}`}
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

      <CreateLinkModal open={createOpen} onClose={() => setCreateOpen(false)} />
      <ConfirmDialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        title="Delete this link?"
        message={toDelete ? `${toDelete.parent?.name} will stop receiving updates about ${toDelete.student?.name}.` : ''}
        confirmLabel="Delete"
        loading={del.isPending}
        onConfirm={() =>
          del.mutate(toDelete.id, {
            onSuccess: () => {
              toast.success('Link deleted');
              setToDelete(null);
            },
            onError: (e) => toast.error('Could not delete', getErrorMessage(e)),
          })
        }
      />
    </div>
  );
}
