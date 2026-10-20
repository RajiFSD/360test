import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { emitSessionExpired, getAccessToken, subscribeAuth } from '../auth/tokens';
import { refreshTokens } from '../api/client';
import { SOCKET_URL } from '../lib/config';
import { useToast } from '../components/Toast';
import { notificationTarget } from '../lib/notificationTarget';

const SocketContext = createContext({ socket: null, connected: false });

const NOTIF_PERMISSION_KEY = 'so_notif_permission_asked';

function maybeAskNotificationPermission() {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  try {
    if (Notification.permission !== 'default') return;
    if (localStorage.getItem(NOTIF_PERMISSION_KEY)) return;
    localStorage.setItem(NOTIF_PERMISSION_KEY, '1');
    Notification.requestPermission().catch(() => {});
  } catch {
    /* ignore */
  }
}

function showBrowserNotification(n, onClick) {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  try {
    const notif = new Notification(n.title || 'SmartOutpass', {
      body: n.body || '',
      tag: `so-${n.id}`,
      icon: '/favicon.svg',
    });
    notif.onclick = () => {
      window.focus();
      onClick?.();
      notif.close();
    };
  } catch {
    /* some browsers require a service worker for notifications */
  }
}

export function SocketProvider({ children }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);
  const handlersRef = useRef({ toast, navigate, role: user?.role });
  handlersRef.current = { toast, navigate, role: user?.role };

  const userId = user?.id;

  useEffect(() => {
    if (!userId) return undefined;
    const token = getAccessToken();
    if (!token) return undefined;

    maybeAskNotificationPermission();

    const s = io(SOCKET_URL, {
      path: '/socket.io',
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
    });

    let refreshing = false;

    s.on('connect', () => setConnected(true));
    s.on('disconnect', () => setConnected(false));

    s.on('connect_error', async (err) => {
      setConnected(false);
      const msg = err?.message;
      if (msg === 'TOKEN_EXPIRED' && !refreshing) {
        refreshing = true;
        try {
          const newToken = await refreshTokens();
          s.auth.token = newToken;
          s.connect();
        } catch {
          emitSessionExpired();
        } finally {
          refreshing = false;
        }
      } else if (msg === 'UNAUTHORIZED') {
        // Token may have been rotated meanwhile; try the latest stored token once.
        const latest = getAccessToken();
        if (latest && latest !== s.auth.token) {
          s.auth.token = latest;
          s.connect();
        }
      }
    });

    // Always use the latest access token on reconnects.
    const unsub = subscribeAuth((evt) => {
      if (evt.type === 'tokens' && evt.accessToken) s.auth.token = evt.accessToken;
    });
    s.io.on('reconnect_attempt', () => {
      const latest = getAccessToken();
      if (latest) s.auth.token = latest;
    });

    const inv = (key) => queryClient.invalidateQueries({ queryKey: key });

    s.on('notification', (n) => {
      inv(['notifications']);
      const { toast: t, navigate: nav, role } = handlersRef.current;
      const target = notificationTarget(n, role);
      const go = target ? () => nav(target) : undefined;
      t.notification(n.title || 'New notification', n.body, { onClick: go });
      showBrowserNotification(n, go);
    });

    s.on('request:new', () => {
      inv(['outpasses']);
      inv(['dashboard']);
    });

    s.on('request:updated', (p) => {
      inv(['outpasses']);
      inv(['outpass']);
      inv(['dashboard']);
      inv(['trips']);
      if (p?.tripId) inv(['trip', String(p.tripId)]);
      inv(['parent']);
    });

    s.on('trip:status', (p) => {
      if (p?.tripId) inv(['trip', String(p.tripId)]);
      inv(['trips']);
      inv(['outpass']);
      inv(['outpasses']);
      inv(['dashboard']);
      inv(['parent']);
    });

    s.on('trip:event', (p) => {
      if (p?.tripId) inv(['trip', String(p.tripId)]);
    });

    s.on('dashboard:refresh', () => {
      inv(['dashboard']);
      inv(['trips']);
    });

    s.on('tracking:stop', (p) => {
      if (p?.tripId) inv(['trip', String(p.tripId)]);
      inv(['trips']);
      inv(['parent']);
    });

    setSocket(s);

    return () => {
      unsub();
      s.removeAllListeners();
      s.io.removeAllListeners('reconnect_attempt');
      s.disconnect();
      setSocket(null);
      setConnected(false);
    };
  }, [userId, queryClient]);

  return <SocketContext.Provider value={{ socket, connected }}>{children}</SocketContext.Provider>;
}

export function useSocket() {
  return useContext(SocketContext);
}

/** Subscribe to a socket event for the lifetime of the component. */
export function useSocketEvent(event, handler) {
  const { socket } = useSocket();
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!socket) return undefined;
    const fn = (...args) => ref.current?.(...args);
    socket.on(event, fn);
    return () => socket.off(event, fn);
  }, [socket, event]);
}
