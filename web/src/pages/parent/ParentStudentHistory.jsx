import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, ClipboardList } from 'lucide-react';
import { useOutpasses, useParentStudents } from '../../api/hooks';
import { Card, LinkButton, PageHeader } from '../../components/ui';
import { EmptyState, QueryState } from '../../components/States';
import { Pagination } from '../../components/Pagination';
import { StatusBadge } from '../../components/Badges';
import { StudentInline } from '../../components/domain';
import { humanize } from '../../lib/constants';
import { formatDateTime } from '../../lib/format';

export default function ParentStudentHistory() {
  const { id } = useParams();
  const [page, setPage] = useState(1);
  const students = useParentStudents();
  const link = (students.data || []).find((s) => String(s.student.id) === String(id));
  const query = useOutpasses({ student_id: id, page, pageSize: 15 });

  return (
    <div className="space-y-6">
      <PageHeader
        back={
          <LinkButton to="/parent" variant="ghost" size="sm" icon={ArrowLeft} className="-ml-2 mb-2">
            My students
          </LinkButton>
        }
        title={link ? `${link.student.name}'s trips` : 'Trip history'}
        subtitle="All outpasses for this student."
      />
      {link && (
        <Card className="p-4">
          <StudentInline student={link.student} size={48} />
        </Card>
      )}
      <Card>
        <QueryState query={query} empty={<EmptyState icon={ClipboardList} title="No outpasses yet" />}>
          {(data) => (
            <>
              <ul className="divide-y divide-slate-100">
                {data.items.map((o) => {
                  const body = (
                    <>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-900">{o.reason}</p>
                        <p className="text-xs text-slate-500">
                          {humanize(o.reason_category)} · {formatDateTime(o.depart_at)} → {formatDateTime(o.expected_return_at)}
                        </p>
                        {o.dest_address && <p className="truncate text-xs text-slate-500">{o.dest_address}</p>}
                      </div>
                      <StatusBadge status={o.status} />
                      {o.trip && <ArrowRight className="h-4 w-4 text-slate-300" aria-hidden="true" />}
                    </>
                  );
                  return (
                    <li key={o.id}>
                      {o.trip ? (
                        <Link to={`/trips/${o.trip.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 focus:bg-slate-50 focus:outline-none sm:px-5">
                          {body}
                        </Link>
                      ) : (
                        <div className="flex items-center gap-3 px-4 py-3 sm:px-5">{body}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
              <Pagination meta={data.meta} page={page} onPageChange={setPage} />
            </>
          )}
        </QueryState>
      </Card>
    </div>
  );
}
