import { useState } from 'react';
import { ClipboardList, FilePlus2 } from 'lucide-react';
import { useOutpasses } from '../../api/hooks';
import { Card, LinkButton, PageHeader, Select } from '../../components/ui';
import { EmptyState, QueryState } from '../../components/States';
import { Pagination } from '../../components/Pagination';
import { OutpassListItem } from '../../components/domain';
import { OUTPASS_STATUSES, humanize } from '../../lib/constants';

export default function MyRequestsPage() {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const query = useOutpasses({ status, page, pageSize: 15 });

  return (
    <div>
      <PageHeader
        title="My requests"
        subtitle="All your outpass requests and their status."
        actions={
          <LinkButton to={"/student/requests/new"} icon={FilePlus2}>
              New request
            </LinkButton>
        }
      />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="w-full max-w-xs text-sm">
          <span className="mb-1 block font-medium text-slate-700">Status</span>
          <Select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
            aria-label="Filter by status"
          >
            <option value="">All statuses</option>
            {OUTPASS_STATUSES.map((s) => (
              <option key={s} value={s}>
                {humanize(s)}
              </option>
            ))}
          </Select>
        </label>
      </div>
      <Card>
        <QueryState
          query={query}
          empty={
            <EmptyState
              icon={ClipboardList}
              title={status ? `No ${humanize(status).toLowerCase()} requests` : 'No requests yet'}
              message="Submit a new outpass request when you need to leave campus."
            />
          }
        >
          {(data) => (
            <>
              <div className="divide-y divide-slate-100">
                {data.items.map((o) => (
                  <OutpassListItem key={o.id} outpass={o} to={`/student/requests/${o.id}`} />
                ))}
              </div>
              <Pagination meta={data.meta} page={page} onPageChange={setPage} />
            </>
          )}
        </QueryState>
      </Card>
    </div>
  );
}
