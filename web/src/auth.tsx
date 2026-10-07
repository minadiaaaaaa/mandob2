import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { get } from './api';
import { setOrgTimezone, useI18n, type Lang } from './i18n';

export type Me = { id: number; username: string; full_name: string; email: string; role: string; locale: Lang | null; perms: string[]; org_language: Lang };
export type Org = Record<string, string> & { logos: Record<string, number> };

type Ctx = { me: Me | null; loading: boolean; can: (...perms: string[]) => boolean; refresh: () => Promise<void>; org: Org | null; refreshOrg: () => Promise<void> };
const Auth = createContext<Ctx>(null!);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [org, setOrg] = useState<Org | null>(null);
  const [loading, setLoading] = useState(true);
  const { setLang } = useI18n();

  const refreshOrg = useCallback(async () => {
    try {
      const o = await get<Org>('/public/org');
      setOrg(o);
      setOrgTimezone(o['org.timezone']);
      if (o['platform.primary_color']) document.documentElement.style.setProperty('--brand', o['platform.primary_color']);
      document.title = o['platform.name'] || o['org.system_name'] || document.title;
    } catch { /* not installed yet */ }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const m = await get<Me>('/me');
      setMe(m);
      // The account language wins; "the organisation's language" follows the default.
      const l = m.locale ?? m.org_language;
      if (l) setLang(l);
    } catch { setMe(null); }
    finally { setLoading(false); }
  }, [setLang]);

  useEffect(() => { refreshOrg(); refresh(); }, [refresh, refreshOrg]);
  useEffect(() => {
    const off = () => setMe(null);
    window.addEventListener('lsp:unauthorized', off);
    return () => window.removeEventListener('lsp:unauthorized', off);
  }, []);

  const can = useCallback((...perms: string[]) => !!me && perms.some((p) => me.perms.includes(p)), [me]);
  return <Auth.Provider value={{ me, loading, can, refresh, org, refreshOrg }}>{children}</Auth.Provider>;
}
export const useAuth = () => useContext(Auth);

export function RequireAuth({ children }: { children: ReactNode }) {
  const { me, loading } = useAuth();
  const loc = useLocation();
  if (loading) return null;
  if (!me) return <Navigate to={`/admin/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  return <>{children}</>;
}
