import { formatDateTime, formatRelative } from '../lib/format';

/** Renders an ISO date in the viewer's local time, with a semantic <time> element. */
export function DateTime({ value, relative = false, fallback = '—', className }) {
  if (!value) return <span className={className}>{fallback}</span>;
  return (
    <time dateTime={value} title={formatDateTime(value)} className={className}>
      {relative ? formatRelative(value) : formatDateTime(value)}
    </time>
  );
}
