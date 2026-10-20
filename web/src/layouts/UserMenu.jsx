import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronDown, KeyRound, LogOut, UserCircle } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { Avatar } from '../components/ui';
import { ROLE_LABELS } from '../lib/constants';

export function UserMenu() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!user) return null;

  const item =
    'flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 focus:bg-slate-50 focus:outline-none';

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-full p-1 pr-2 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Open user menu"
      >
        <Avatar src={user.photo_url} name={user.name} size={32} />
        <span className="hidden max-w-[10rem] truncate text-sm font-medium text-slate-700 sm:block">{user.name}</span>
        <ChevronDown className="hidden h-4 w-4 text-slate-400 sm:block" aria-hidden="true" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-[700] mt-2 w-60 overflow-hidden rounded-2xl border border-slate-200 bg-white py-1 shadow-xl">
          <div className="border-b border-slate-100 px-4 py-3">
            <p className="truncate text-sm font-semibold text-slate-900">{user.name}</p>
            <p className="truncate text-xs text-slate-500">{user.email}</p>
            <p className="mt-1 text-xs font-medium text-indigo-700">{ROLE_LABELS[user.role]}</p>
          </div>
          <Link role="menuitem" to="/profile" className={item} onClick={() => setOpen(false)}>
            <UserCircle className="h-4 w-4 text-slate-400" aria-hidden="true" /> Profile
          </Link>
          <Link role="menuitem" to="/profile#password" className={item} onClick={() => setOpen(false)}>
            <KeyRound className="h-4 w-4 text-slate-400" aria-hidden="true" /> Change password
          </Link>
          <button
            role="menuitem"
            type="button"
            className={`${item} text-red-700`}
            onClick={async () => {
              setOpen(false);
              await logout();
              navigate('/login', { replace: true });
            }}
          >
            <LogOut className="h-4 w-4" aria-hidden="true" /> Log out
          </button>
        </div>
      )}
    </div>
  );
}
