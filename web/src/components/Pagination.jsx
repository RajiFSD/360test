import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from './ui';

export function Pagination({ meta, page, onPageChange, className }) {
  if (!meta) return null;
  const current = meta.page || page || 1;
  const pageSize = meta.pageSize || 20;
  const total = meta.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize && current === 1) {
    return <p className={`px-4 py-3 text-xs text-slate-500 ${className || ''}`}>{total} result{total === 1 ? '' : 's'}</p>;
  }
  const from = total === 0 ? 0 : (current - 1) * pageSize + 1;
  const to = Math.min(total, current * pageSize);
  return (
    <nav
      aria-label="Pagination"
      className={`flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-3 ${className || ''}`}
    >
      <p className="text-xs text-slate-500">
        Showing <span className="font-medium text-slate-700">{from}</span>–<span className="font-medium text-slate-700">{to}</span> of{' '}
        <span className="font-medium text-slate-700">{total}</span>
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          icon={ChevronLeft}
          disabled={current <= 1}
          onClick={() => onPageChange(current - 1)}
          aria-label="Previous page"
        >
          Prev
        </Button>
        <span className="text-xs text-slate-600">
          Page {current} / {pages}
        </span>
        <Button
          variant="secondary"
          size="sm"
          disabled={current >= pages}
          onClick={() => onPageChange(current + 1)}
          aria-label="Next page"
        >
          Next
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </nav>
  );
}
