import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Search, Users } from 'lucide-react';
import { useHostels, useUsers } from '../../api/hooks';
import { Card, Field, Input, PageHeader, Select } from '../../components/ui';
import { EmptyState, QueryState } from '../../components/States';
import { Pagination } from '../../components/Pagination';
import { StudentInline } from '../../components/domain';

export default function StudentsPage() {
  const [input, setInput] = useState('');
  const [q, setQ] = useState('');
  const [hostel, setHostel] = useState('');
  const [page, setPage] = useState(1);
  const hostels = useHostels();

  useEffect(() => {
    const t = setTimeout(() => {
      setQ(input.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [input]);

  const query = useUsers({ role: 'student', q, hostel_id: hostel, page, pageSize: 20 });

  return (
    <div>
      <PageHeader title="Students" subtitle="Search students and review their outpass history." />
      <Card className="mb-4 p-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Search" htmlFor="st-q" className="sm:col-span-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" aria-hidden="true" />
              <Input id="st-q" className="pl-9" placeholder="Name, roll number or email" value={input} onChange={(e) => setInput(e.target.value)} />
            </div>
          </Field>
          <Field label="Hostel" htmlFor="st-hostel">
            <Select
              id="st-hostel"
              value={hostel}
              onChange={(e) => {
                setHostel(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All hostels</option>
              {(hostels.data || []).map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Card>
      <Card>
        <QueryState query={query} empty={<EmptyState icon={Users} title="No students found" message="Try a different search." />}>
          {(data) => (
            <>
              <ul className="divide-y divide-slate-100">
                {data.items.map((s) => (
                  <li key={s.id}>
                    <Link
                      to={`/staff/students/${s.id}`}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 focus:bg-slate-50 focus:outline-none sm:px-5"
                    >
                      <StudentInline student={s} className="flex-1" />
                      {!s.is_active && <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-500">Inactive</span>}
                      <span className="hidden text-sm text-slate-500 sm:block">{s.department}</span>
                      <ChevronRight className="h-4 w-4 text-slate-300" aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ul>
              <Pagination meta={data.meta} page={page} onPageChange={setPage} />
            </>
          )}
        </QueryState>
      </Card>
    </div>
  );
}
