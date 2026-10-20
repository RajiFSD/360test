import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { Bell, Check, CheckCheck } from 'lucide-react';
import { useMarkAllRead, useMarkNotificationRead, useNotifications } from '../../api/hooks';
import { useAuth } from '../../auth/AuthContext';
import { Button, Card, PageHeader, Tabs } from '../../components/ui';
import { EmptyState, QueryState } from '../../components/States';
import { Pagination } from '../../components/Pagination';
import { DateTime } from '../../components/DateTime';
import { humanize } from '../../lib/constants';
import { notificationTarget } from '../../lib/notificationTarget';
import { useToast } from '../../components/Toast';
import { getErrorMessage } from '../../api/client';

export default function NotificationsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1);
  const params = { page, pageSize: 20, unread: filter === 'unread' ? true : undefined };
  const query = useNotifications(params);
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllRead();

  return (
    <div>
      <PageHeader
        title="Notifications"
        subtitle="Updates about requests, trips and safety alerts."
        actions={
          <Button
            variant="secondary"
            icon={CheckCheck}
            loading={markAll.isPending}
            onClick={() =>
              markAll.mutate(undefined, {
                onSuccess: () => toast.success('All notifications marked as read'),
                onError: (e) => toast.error('Could not mark all read', getErrorMessage(e)),
              })
            }
          >
            Mark all read
          </Button>
        }
      />
      <Tabs
        className="mb-4 w-fit"
        value={filter}
        onChange={(v) => {
          setFilter(v);
          setPage(1);
        }}
        tabs={[
          { value: 'all', label: 'All' },
          { value: 'unread', label: 'Unread' },
        ]}
      />
      <Card>
        <QueryState
          query={query}
          empty={<EmptyState icon={Bell} title={filter === 'unread' ? 'No unread notifications' : 'No notifications yet'} />}
        >
          {(data) => (
            <>
              <ul className="divide-y divide-slate-100">
                {data.items.map((n) => {
                  const target = notificationTarget(n, user?.role);
                  return (
                    <li key={n.id} className={clsx('flex gap-3 px-4 py-3 sm:px-5', !n.read_at && 'bg-indigo-50/40')}>
                      <span
                        className={clsx('mt-2 h-2 w-2 shrink-0 rounded-full', n.read_at ? 'bg-slate-200' : 'bg-indigo-600')}
                        aria-hidden="true"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold text-slate-900">{n.title}</p>
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                            {humanize(n.type)}
                          </span>
                        </div>
                        {n.body && <p className="mt-0.5 text-sm text-slate-600">{n.body}</p>}
                        <p className="mt-1 text-xs text-slate-400">
                          <DateTime value={n.created_at} />
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center">
                        {target && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              if (!n.read_at) markRead.mutate(n.id);
                              navigate(target);
                            }}
                          >
                            Open
                          </Button>
                        )}
                        {!n.read_at && (
                          <Button
                            size="sm"
                            variant="secondary"
                            icon={Check}
                            onClick={() => markRead.mutate(n.id)}
                            aria-label={`Mark "${n.title}" as read`}
                          >
                            Read
                          </Button>
                        )}
                      </div>
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
