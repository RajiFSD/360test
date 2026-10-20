import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { Bell, CheckCheck } from 'lucide-react';
import { useMarkAllRead, useMarkNotificationRead, useNotifications, useUnreadCount } from '../api/hooks';
import { useAuth } from '../auth/AuthContext';
import { notificationTarget } from '../lib/notificationTarget';
import { formatRelative } from '../lib/format';
import { Spinner } from '../components/Spinner';
import { ErrorState, EmptyState } from '../components/States';

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const { user } = useAuth();
  const navigate = useNavigate();
  const unread = useUnreadCount();
  const list = useNotifications({ page: 1, pageSize: 8 }, { enabled: open });
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllRead();
  const count = unread.data?.count ?? 0;

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const openItem = (n) => {
    if (!n.read_at) markRead.mutate(n.id);
    const target = notificationTarget(n, user?.role);
    setOpen(false);
    if (target) navigate(target);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="relative rounded-full p-2 text-slate-600 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        aria-label={`Notifications${count ? `, ${count} unread` : ''}`}
        aria-expanded={open}
        aria-haspopup="true"
      >
        <Bell className="h-5 w-5" aria-hidden="true" />
        {count > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-[700] mt-2 w-[min(22rem,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <p className="text-sm font-semibold text-slate-900">Notifications</p>
            <button
              type="button"
              disabled={!count || markAll.isPending}
              onClick={() => markAll.mutate()}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-50 disabled:text-slate-400 disabled:hover:bg-transparent focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" /> Mark all read
            </button>
          </div>
          <div className="max-h-96 overflow-y-auto">
            {list.isPending ? (
              <div className="flex justify-center p-6">
                <Spinner />
              </div>
            ) : list.isError ? (
              <ErrorState error={list.error} onRetry={list.refetch} className="py-6" />
            ) : !list.data?.items.length ? (
              <EmptyState title="You're all caught up" message="New notifications will appear here." className="py-6" />
            ) : (
              <ul className="divide-y divide-slate-100">
                {list.data.items.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => openItem(n)}
                      className={clsx(
                        'flex w-full gap-3 px-4 py-3 text-left hover:bg-slate-50 focus:bg-slate-50 focus:outline-none',
                        !n.read_at && 'bg-indigo-50/50',
                      )}
                    >
                      <span
                        className={clsx('mt-1.5 h-2 w-2 shrink-0 rounded-full', n.read_at ? 'bg-transparent' : 'bg-indigo-600')}
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-slate-900">{n.title}</span>
                        {n.body && <span className="mt-0.5 block text-xs text-slate-600 line-clamp-2">{n.body}</span>}
                        <span className="mt-1 block text-[11px] text-slate-400">{formatRelative(n.created_at)}</span>
                      </span>
                      {!n.read_at && <span className="sr-only">Unread</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <Link
            to="/notifications"
            onClick={() => setOpen(false)}
            className="block border-t border-slate-100 px-4 py-2.5 text-center text-sm font-medium text-indigo-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500"
          >
            View all
          </Link>
        </div>
      )}
    </div>
  );
}
