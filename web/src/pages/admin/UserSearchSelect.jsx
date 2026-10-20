import { useEffect, useId, useRef, useState } from 'react';
import clsx from 'clsx';
import { Search, X } from 'lucide-react';
import { useUsers } from '../../api/hooks';
import { Avatar, Input } from '../../components/ui';
import { Spinner } from '../../components/Spinner';

/** Searchable single-user picker backed by GET /users?role=&q=. value = user object | null. */
export function UserSearchSelect({ role, value, onChange, placeholder = 'Search by name, email or roll no', id, invalid }) {
  const autoId = useId();
  const inputId = id || autoId;
  const listId = `${inputId}-list`;
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const ref = useRef(null);

  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 250);
    return () => clearTimeout(t);
  }, [text]);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const query = useUsers({ role, q, pageSize: 8, is_active: true }, { enabled: open });
  const items = query.data?.items || [];

  if (value) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5">
        <Avatar src={value.photo_url} name={value.name} size={28} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-slate-900">{value.name}</p>
          <p className="truncate text-xs text-slate-500">{value.roll_no || value.email}</p>
        </div>
        <button
          type="button"
          onClick={() => {
            onChange(null);
            setText('');
          }}
          className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          aria-label={`Clear ${value.name}`}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  const choose = (u) => {
    onChange(u);
    setOpen(false);
    setText('');
  };

  return (
    <div className="relative" ref={ref}>
      <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" aria-hidden="true" />
      <Input
        id={inputId}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        invalid={invalid}
        className="pl-9"
        placeholder={placeholder}
        value={text}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(items.length - 1, a + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(0, a - 1));
          } else if (e.key === 'Enter' && open && items[active]) {
            e.preventDefault();
            choose(items[active]);
          } else if (e.key === 'Escape') setOpen(false);
        }}
      />
      {open && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
        >
          {query.isPending ? (
            <li className="flex justify-center p-3">
              <Spinner />
            </li>
          ) : query.isError ? (
            <li className="px-3 py-2 text-sm text-red-600">Search failed</li>
          ) : !items.length ? (
            <li className="px-3 py-2 text-sm text-slate-500">No matches</li>
          ) : (
            items.map((u, i) => (
              <li
                key={u.id}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(u)}
                onMouseEnter={() => setActive(i)}
                className={clsx('flex cursor-pointer items-center gap-2 px-3 py-2', i === active && 'bg-indigo-50')}
              >
                <Avatar src={u.photo_url} name={u.name} size={28} />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-slate-900">{u.name}</span>
                  <span className="block truncate text-xs text-slate-500">{u.roll_no ? `${u.roll_no} · ${u.email}` : u.email}</span>
                </span>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
