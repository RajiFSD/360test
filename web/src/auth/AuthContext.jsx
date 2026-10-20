import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { authApi } from '../api/endpoints';
import {
  clearTokens,
  getAccessToken,
  getRefreshToken,
  getStoredUser,
  setStoredUser,
  setTokens,
  subscribeAuth,
} from './tokens';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState(() => (getAccessToken() ? getStoredUser() : null));
  const [initializing, setInitializing] = useState(() => !!getAccessToken());
  const [sessionExpired, setSessionExpired] = useState(false);

  // Validate the stored session on first load.
  useEffect(() => {
    let cancelled = false;
    if (!getAccessToken()) {
      setInitializing(false);
      return undefined;
    }
    authApi
      .me()
      .then((me) => {
        if (cancelled) return;
        setUser(me);
        setStoredUser(me);
      })
      .catch((err) => {
        if (cancelled) return;
        const status = err?.response?.status;
        if (status === 401 || status === 403) {
          clearTokens();
          setUser(null);
        }
      })
      .finally(() => !cancelled && setInitializing(false));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(
    () =>
      subscribeAuth((evt) => {
        if (evt.type === 'expired') {
          setUser(null);
          setSessionExpired(true);
          queryClient.clear();
        }
      }),
    [queryClient],
  );

  const login = useCallback(
    async (identifier, password) => {
      const result = await authApi.login(identifier.trim(), password);
      setTokens({ accessToken: result.accessToken, refreshToken: result.refreshToken });
      setStoredUser(result.user);
      queryClient.clear();
      setSessionExpired(false);
      setUser(result.user);
      return result.user;
    },
    [queryClient],
  );

  const logout = useCallback(async () => {
    const refreshToken = getRefreshToken();
    if (refreshToken) {
      try {
        await authApi.logout(refreshToken);
      } catch {
        /* ignore: we log out locally regardless */
      }
    }
    clearTokens();
    queryClient.clear();
    setUser(null);
  }, [queryClient]);

  const updateUser = useCallback((next) => {
    setUser(next);
    setStoredUser(next);
  }, []);

  const value = useMemo(
    () => ({ user, initializing, login, logout, updateUser, sessionExpired, clearSessionExpired: () => setSessionExpired(false) }),
    [user, initializing, login, logout, updateUser, sessionExpired],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
