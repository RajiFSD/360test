import { forwardRef, useId } from 'react';
import clsx from 'clsx';
import { Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { assetUrl } from '../lib/config';

const BUTTON_VARIANTS = {
  primary: 'bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-indigo-300',
  secondary: 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 disabled:text-slate-400',
  danger: 'bg-red-600 text-white hover:bg-red-700 disabled:bg-red-300',
  success: 'bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-emerald-300',
  ghost: 'bg-transparent text-slate-600 hover:bg-slate-100 disabled:text-slate-300',
  warning: 'bg-amber-500 text-white hover:bg-amber-600 disabled:bg-amber-300',
};
const BUTTON_SIZES = {
  sm: 'px-2.5 py-1.5 text-xs gap-1.5',
  md: 'px-3.5 py-2 text-sm gap-2',
  lg: 'px-5 py-3 text-base gap-2',
  xl: 'px-6 py-4 text-lg gap-3',
};

export const Button = forwardRef(function Button(
  { variant = 'primary', size = 'md', loading = false, className, children, disabled, type = 'button', icon: Icon, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={clsx(
        'inline-flex items-center justify-center rounded-lg font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed',
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className,
      )}
      {...props}
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      ) : Icon ? (
        <Icon className={size === 'xl' ? 'h-6 w-6' : 'h-4 w-4'} aria-hidden="true" />
      ) : null}
      {children}
    </button>
  );
});

/** A react-router Link styled as a button. */
export function LinkButton({ to, variant = 'primary', size = 'md', icon: Icon, className, children, ...props }) {
  return (
    <Link
      to={to}
      className={clsx(
        'inline-flex items-center justify-center rounded-lg font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2',
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className,
      )}
      {...props}
    >
      {Icon && <Icon className={size === 'xl' ? 'h-6 w-6' : 'h-4 w-4'} aria-hidden="true" />}
      {children}
    </Link>
  );
}

export function Card({ className, children, as: Tag = 'div', ...props }) {
  return (
    <Tag className={clsx('rounded-2xl border border-slate-200 bg-white shadow-sm', className)} {...props}>
      {children}
    </Tag>
  );
}

export function CardHeader({ title, subtitle, actions, className }) {
  return (
    <div className={clsx('flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:px-5', className)}>
      <div className="min-w-0">
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function CardBody({ className, children }) {
  return <div className={clsx('px-4 py-4 sm:px-5', className)}>{children}</div>;
}

export function PageHeader({ title, subtitle, actions, back }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {back}
        <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

const inputBase =
  'block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 disabled:bg-slate-100 disabled:text-slate-500';

export function Field({ label, htmlFor, error, hint, required, children, className }) {
  return (
    <div className={clsx('space-y-1', className)}>
      {label && (
        <label htmlFor={htmlFor} className="block text-sm font-medium text-slate-700">
          {label}
          {required && (
            <span className="ml-0.5 text-red-600" aria-hidden="true">
              *
            </span>
          )}
        </label>
      )}
      {children}
      {hint && !error && <p className="text-xs text-slate-500">{hint}</p>}
      {error && (
        <p className="text-xs font-medium text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export const Input = forwardRef(function Input({ className, invalid, ...props }, ref) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={clsx(inputBase, invalid && 'border-red-400 focus:border-red-500 focus:ring-red-500/30', className)}
      {...props}
    />
  );
});

export const Textarea = forwardRef(function Textarea({ className, invalid, rows = 3, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      aria-invalid={invalid || undefined}
      className={clsx(inputBase, invalid && 'border-red-400 focus:border-red-500 focus:ring-red-500/30', className)}
      {...props}
    />
  );
});

export const Select = forwardRef(function Select({ className, invalid, children, ...props }, ref) {
  return (
    <select
      ref={ref}
      aria-invalid={invalid || undefined}
      className={clsx(inputBase, 'pr-8', invalid && 'border-red-400', className)}
      {...props}
    >
      {children}
    </select>
  );
});

export function Checkbox({ label, className, id, ...props }) {
  const autoId = useId();
  const cid = id || autoId;
  return (
    <label htmlFor={cid} className={clsx('inline-flex cursor-pointer items-start gap-2 text-sm text-slate-700', className)}>
      <input
        id={cid}
        type="checkbox"
        className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-2 focus:ring-indigo-500"
        {...props}
      />
      {label && <span>{label}</span>}
    </label>
  );
}

export function Toggle({ checked, onChange, label, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={!!checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:opacity-50',
        checked ? 'bg-indigo-600' : 'bg-slate-300',
      )}
    >
      <span
        className={clsx(
          'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform',
          checked ? 'translate-x-5' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}

export function Badge({ className, children, title }) {
  return (
    <span
      title={title}
      className={clsx('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset', className)}
    >
      {children}
    </span>
  );
}

export function Avatar({ src, name, size = 40, className }) {
  const initials = (name || '?')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');
  const url = assetUrl(src);
  return url ? (
    <img
      src={url}
      alt={name ? `Photo of ${name}` : 'User photo'}
      width={size}
      height={size}
      style={{ width: size, height: size }}
      className={clsx('shrink-0 rounded-full bg-slate-200 object-cover', className)}
      loading="lazy"
    />
  ) : (
    <span
      aria-hidden="true"
      style={{ width: size, height: size, fontSize: Math.max(12, size / 2.8) }}
      className={clsx('inline-flex shrink-0 items-center justify-center rounded-full bg-indigo-100 font-semibold text-indigo-700', className)}
    >
      {initials}
    </span>
  );
}

export function StatCard({ label, value, icon: Icon, tone = 'indigo', hint, to, onClick }) {
  const tones = {
    indigo: 'bg-indigo-50 text-indigo-700',
    amber: 'bg-amber-50 text-amber-700',
    red: 'bg-red-50 text-red-700',
    green: 'bg-emerald-50 text-emerald-700',
    blue: 'bg-sky-50 text-sky-700',
    slate: 'bg-slate-100 text-slate-700',
  };
  const Tag = onClick ? 'button' : 'div';
  return (
    <Card
      as={Tag}
      onClick={onClick}
      className={clsx('flex items-center gap-4 p-4 text-left', onClick && 'transition hover:border-indigo-300 hover:shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500')}
      data-to={to}
    >
      {Icon && (
        <span className={clsx('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl', tones[tone])}>
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
      )}
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-slate-500">{label}</p>
        <p className="text-2xl font-bold text-slate-900">{value ?? '—'}</p>
        {hint && <p className="truncate text-xs text-slate-500">{hint}</p>}
      </div>
    </Card>
  );
}

export function KeyValue({ label, children, className }) {
  return (
    <div className={clsx('min-w-0', className)}>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-slate-900">{children ?? '—'}</dd>
    </div>
  );
}

export function Table({ children, className }) {
  return (
    <div className={clsx('overflow-x-auto', className)}>
      <table className="min-w-full divide-y divide-slate-200 text-sm">{children}</table>
    </div>
  );
}
export function Th({ children, className, ...props }) {
  return (
    <th scope="col" className={clsx('whitespace-nowrap bg-slate-50 px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500', className)} {...props}>
      {children}
    </th>
  );
}
export function Td({ children, className, ...props }) {
  return (
    <td className={clsx('px-3 py-2.5 align-middle text-slate-700', className)} {...props}>
      {children}
    </td>
  );
}

export function Tabs({ tabs, value, onChange, className }) {
  return (
    <div role="tablist" className={clsx('flex gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1', className)}>
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          role="tab"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={clsx(
            'whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500',
            value === t.value ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-600 hover:text-slate-900',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
