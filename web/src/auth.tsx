import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, setCsrfToken, setOnUnauthorized, type AuthResponse, type User } from './api/client';

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  register: (data: { email: string; password: string; fullName: string; phone?: string }) => Promise<User>;
  logout: () => Promise<void>;
  setUser: (u: User) => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const apply = useCallback((r: AuthResponse) => {
    setCsrfToken(r.csrfToken);
    setUserState(r.user);
    return r.user;
  }, []);

  useEffect(() => {
    setOnUnauthorized(() => apply({ user: null, csrfToken: null }));
    api<AuthResponse>('GET', '/api/auth/me')
      .then(apply)
      .catch(() => apply({ user: null, csrfToken: null }))
      .finally(() => setLoading(false));
  }, [apply]);

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      login: async (email, password) => apply(await api<AuthResponse>('POST', '/api/auth/login', { email, password }))!,
      register: async (data) => apply(await api<AuthResponse>('POST', '/api/auth/register', data))!,
      logout: async () => {
        await api('POST', '/api/auth/logout').catch(() => {});
        apply({ user: null, csrfToken: null });
      },
      setUser: (u) => setUserState(u),
    }),
    [user, loading, apply],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth fuera de AuthProvider');
  return ctx;
}
