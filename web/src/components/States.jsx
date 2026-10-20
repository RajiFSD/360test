import clsx from 'clsx';
import { AlertOctagon, Inbox, RefreshCw } from 'lucide-react';
import { Button } from './ui';
import { getApiError } from '../api/client';
import { SkeletonList } from './Spinner';

export function EmptyState({ icon: Icon = Inbox, title = 'Nothing here yet', message, action, className }) {
  return (
    <div className={clsx('flex flex-col items-center justify-center px-4 py-10 text-center', className)}>
      <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
        <Icon className="h-6 w-6" aria-hidden="true" />
      </span>
      <p className="text-sm font-semibold text-slate-800">{title}</p>
      {message && <p className="mt-1 max-w-sm text-sm text-slate-500">{message}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry, title = 'Could not load data', className }) {
  const e = error ? getApiError(error) : null;
  return (
    <div role="alert" className={clsx('flex flex-col items-center justify-center px-4 py-10 text-center', className)}>
      <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-500">
        <AlertOctagon className="h-6 w-6" aria-hidden="true" />
      </span>
      <p className="text-sm font-semibold text-slate-800">{title}</p>
      {e && <p className="mt-1 max-w-sm text-sm text-slate-500">{e.message}</p>}
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-4" icon={RefreshCw} onClick={() => onRetry()}>
          Try again
        </Button>
      )}
    </div>
  );
}

/**
 * Renders loading / error / empty states for a TanStack query and calls `children(data)` otherwise.
 * `isEmpty` decides emptiness (defaults to empty array / items).
 */
export function QueryState({ query, loading, empty, isEmpty, errorTitle, children }) {
  if (query.isPending) return loading ?? <div className="p-4"><SkeletonList rows={3} /></div>;
  if (query.isError) return <ErrorState error={query.error} onRetry={query.refetch} title={errorTitle} />;
  const data = query.data;
  const emptyCheck =
    isEmpty ??
    ((d) => d === null || d === undefined || (Array.isArray(d) && d.length === 0) || (Array.isArray(d?.items) && d.items.length === 0));
  if (emptyCheck(data)) return empty ?? <EmptyState />;
  return children(data);
}
