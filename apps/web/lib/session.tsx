'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, getToken, logout, setToken } from './api';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  createdAt?: string;
}

interface SessionCtx {
  user: SessionUser | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  demoSignIn: () => Promise<void>;
  signUp: (name: string, email: string, password: string) => Promise<void>;
  signOut: () => void;
  refresh: () => Promise<void>;
}

const Ctx = createContext<SessionCtx | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const data = await api.get<{ user: SessionUser }>('/auth/me');
      setUser(data.user);
    } catch {
      setToken(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const signIn = async (email: string, password: string) => {
    const data = await api.post<{ token: string; user: SessionUser }>('/auth/login', { email, password });
    setToken(data.token);
    setUser(data.user);
  };
  const demoSignIn = async () => {
    const data = await api.post<{ token: string; user: SessionUser }>('/auth/demo');
    setToken(data.token);
    setUser(data.user);
  };
  const signUp = async (name: string, email: string, password: string) => {
    const data = await api.post<{ token: string; user: SessionUser }>('/auth/signup', { name, email, password });
    setToken(data.token);
    setUser(data.user);
  };
  const signOut = () => logout();

  return <Ctx.Provider value={{ user, loading, signIn, demoSignIn, signUp, signOut, refresh }}>{children}</Ctx.Provider>;
}

export function useSession(): SessionCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useSession must be inside SessionProvider');
  return ctx;
}
