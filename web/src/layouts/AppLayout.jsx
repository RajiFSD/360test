import { Suspense, useEffect, useState } from 'react';
import { Spinner } from '../components/Spinner';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import clsx from 'clsx';
import { Menu, ShieldCheck, Wifi, WifiOff, X } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { useSocket } from '../socket/SocketContext';
import { NAV } from './navConfig';
import { NotificationBell } from './NotificationBell';
import { UserMenu } from './UserMenu';
import { ROLE_LABELS } from '../lib/constants';

function Brand() {
  return (
    <div className="flex items-center gap-2">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-white">
        <ShieldCheck className="h-5 w-5" aria-hidden="true" />
      </span>
      <span className="text-lg font-bold tracking-tight text-slate-900">
        Smart<span className="text-indigo-600">Outpass</span>
      </span>
    </div>
  );
}

function NavItems({ items, onNavigate }) {
  return (
    <ul className="space-y-1">
      {items.map((item, idx) =>
        item.section ? (
          <li key={`s-${idx}`} className="px-3 pb-1 pt-4 text-xs font-semibold uppercase tracking-wider text-slate-400">
            {item.section}
          </li>
        ) : (
          <li key={item.to}>
            <NavLink
              to={item.to}
              end={item.end}
              onClick={onNavigate}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500',
                  isActive ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                )
              }
            >
              <item.icon className="h-5 w-5 shrink-0" aria-hidden="true" />
              {item.label}
            </NavLink>
          </li>
        ),
      )}
    </ul>
  );
}

export default function AppLayout() {
  const { user } = useAuth();
  const { connected } = useSocket();
  const [drawer, setDrawer] = useState(false);
  const location = useLocation();
  const items = NAV[user?.role] || [];
  const primary = items.filter((i) => i.primary).slice(0, 4);

  useEffect(() => setDrawer(false), [location.pathname]);

  return (
    <div className="min-h-screen bg-slate-50">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-[1001] focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:shadow"
      >
        Skip to content
      </a>

      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-slate-200 bg-white lg:flex">
        <div className="flex h-16 items-center px-5">
          <Brand />
        </div>
        <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 pb-6">
          <NavItems items={items} />
        </nav>
        <div className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
          Signed in as <span className="font-medium text-slate-700">{ROLE_LABELS[user?.role]}</span>
        </div>
      </aside>

      {/* Mobile drawer */}
      {drawer && (
        <div className="fixed inset-0 z-[800] lg:hidden">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setDrawer(false)} aria-hidden="true" />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-white shadow-xl" role="dialog" aria-modal="true" aria-label="Navigation">
            <div className="flex h-16 items-center justify-between px-4">
              <Brand />
              <button
                type="button"
                onClick={() => setDrawer(false)}
                className="rounded-md p-2 text-slate-500 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                aria-label="Close navigation"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 pb-6">
              <NavItems items={items} onNavigate={() => setDrawer(false)} />
            </nav>
          </div>
        </div>
      )}

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-slate-200 bg-white/90 px-3 backdrop-blur sm:px-6">
          <button
            type="button"
            onClick={() => setDrawer(true)}
            className="rounded-md p-2 text-slate-600 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 lg:hidden"
            aria-label="Open navigation"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="lg:hidden">
            <Brand />
          </div>
          <div className="flex-1" />
          <span
            className={clsx(
              'hidden items-center gap-1 rounded-full px-2 py-1 text-xs font-medium sm:inline-flex',
              connected ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500',
            )}
            title={connected ? 'Realtime updates connected' : 'Realtime updates disconnected'}
          >
            {connected ? <Wifi className="h-3.5 w-3.5" aria-hidden="true" /> : <WifiOff className="h-3.5 w-3.5" aria-hidden="true" />}
            {connected ? 'Live' : 'Offline'}
          </span>
          <NotificationBell />
          <UserMenu />
        </header>

        <main id="main" className="mx-auto w-full max-w-7xl px-3 pb-24 pt-5 sm:px-6 lg:pb-10">
          <Suspense
            fallback={
              <div className="flex justify-center py-20">
                <Spinner label="Loading page" />
              </div>
            }
          >
            <Outlet />
          </Suspense>
        </main>
      </div>

      {/* Mobile bottom nav */}
      {primary.length > 0 && (
        <nav
          aria-label="Quick navigation"
          className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] lg:hidden"
        >
          <ul className="grid" style={{ gridTemplateColumns: `repeat(${primary.length}, minmax(0, 1fr))` }}>
            {primary.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    clsx(
                      'flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium focus:outline-none focus-visible:bg-indigo-50',
                      isActive ? 'text-indigo-700' : 'text-slate-500',
                    )
                  }
                >
                  <item.icon className="h-5 w-5" aria-hidden="true" />
                  <span className="truncate">{item.label}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  );
}
