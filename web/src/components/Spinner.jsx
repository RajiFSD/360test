import clsx from 'clsx';
import { Loader2 } from 'lucide-react';

export function Spinner({ className, label = 'Loading' }) {
  return (
    <span role="status" className={clsx('inline-flex items-center gap-2 text-slate-500', className)}>
      <Loader2 className="h-5 w-5 animate-spin text-indigo-600" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function FullPageSpinner({ label = 'Loading' }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-50">
      <Loader2 className="h-8 w-8 animate-spin text-indigo-600" aria-hidden="true" />
      <p className="text-sm text-slate-500" role="status">
        {label}…
      </p>
    </div>
  );
}

export function Skeleton({ className }) {
  return <div aria-hidden="true" className={clsx('animate-pulse rounded-lg bg-slate-200', className)} />;
}

export function SkeletonList({ rows = 4, className }) {
  return (
    <div className={clsx('space-y-3', className)} role="status" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-10 w-10 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-2/5" />
            <Skeleton className="h-3 w-3/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function SkeletonCards({ count = 4, className }) {
  return (
    <div className={clsx('grid gap-4 sm:grid-cols-2 lg:grid-cols-4', className)} role="status" aria-label="Loading">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-24 rounded-2xl" />
      ))}
    </div>
  );
}
