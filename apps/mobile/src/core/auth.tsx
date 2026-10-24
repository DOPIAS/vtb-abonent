import {
  createContext,
  PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError, onUnauthorized, request } from './api';
import { sessionStorage } from './storage';
import { Auth, User } from './types';

interface Session {
  token: string | null;
  user: User | null;
  loading: boolean;
  bootError: unknown;
  reload: () => Promise<void>;
  authenticate: (
    mode: 'login' | 'register',
    data: { email: string; password: string; name?: string },
  ) => Promise<void>;
  logout: () => Promise<void>;
}
const Context = createContext<Session | null>(null);
export function AuthProvider({ children }: PropsWithChildren) {
  const queryClient = useQueryClient();
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [bootError, setBootError] = useState<unknown>(null);
  const clear = useCallback(() => {
    setToken(null);
    setUser(null);
    queryClient.clear();
    void sessionStorage.remove().catch(() => {
      /* No token remains in memory after expiry. */
    });
  }, [queryClient]);
  const loadSession = useCallback(async () => {
    try {
      const saved = await sessionStorage.get();
      setBootError(null);
      if (saved) {
        const current = await request<User>('/auth/me', { token: saved });
        setToken(saved);
        setUser(current);
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) clear();
      else setBootError(error);
    } finally {
      setLoading(false);
    }
  }, [clear]);
  useEffect(() => {
    onUnauthorized(clear);
    // Restore state from asynchronous SecureStore/sessionStorage at application startup.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadSession();
    return () => onUnauthorized();
  }, [clear, loadSession]);
  const reload = async () => {
    setLoading(true);
    setBootError(null);
    await loadSession();
  };
  const authenticate: Session['authenticate'] = async (mode, data) => {
    const result = await request<Auth>(`/auth/${mode}`, {
      method: 'POST',
      body: data,
    });
    await sessionStorage.set(result.token);
    queryClient.clear();
    setToken(result.token);
    setUser(result.user);
    setBootError(null);
  };
  const logout = async () => {
    await request('/auth/logout', { method: 'POST', token });
    clear();
  };
  return (
    <Context.Provider
      value={{ token, user, loading, bootError, reload, authenticate, logout }}
    >
      {children}
    </Context.Provider>
  );
}
export function useSession(): Session {
  const session = useContext(Context);
  if (!session) throw new Error('AuthProvider is missing');
  return session;
}
