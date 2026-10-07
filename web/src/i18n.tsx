import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import ar from '@shared/i18n/ar.json';
import en from '@shared/i18n/en.json';
import bn from '@shared/i18n/bn.json';
import ur from '@shared/i18n/ur.json';

export type LangInfo = { code: string; name: string; dir: 'rtl' | 'ltr'; font?: string | null; flag?: string | null };
export const LANGS: LangInfo[] = [
  { code: 'ar', name: 'العربية', dir: 'rtl' },
  { code: 'en', name: 'English', dir: 'ltr' },
  { code: 'bn', name: 'বাংলা', dir: 'ltr' },
  { code: 'ur', name: 'اردو', dir: 'rtl' },
];
export type Lang = string;
const BASE: Record<string, Record<string, string>> = { ar, en, bn, ur };

export type T = (key: string, vars?: Record<string, unknown>) => string;
type Ctx = { lang: Lang; dir: 'rtl' | 'ltr'; t: T; setLang: (l: Lang) => void; has: (key: string) => boolean; langs: LangInfo[] };
const I18n = createContext<Ctx>(null!);

const stored = (): Lang => {
  try { const l = localStorage.getItem('lsp.lang'); if (l && /^[a-z]{2,3}(-[A-Z]{2})?$/.test(l)) return l; } catch { /* storage blocked */ }
  return 'ar';
};

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(stored);
  // Languages added on the "Languages" screen and every translation override arrive from the server.
  const [extra, setExtra] = useState<{ langs: LangInfo[]; overrides: Record<string, Record<string, string>> }>({ langs: [], overrides: {} });
  useEffect(() => { fetch('/api/public/i18n').then((r) => (r.ok ? r.json() : null)).then((d) => d && setExtra({ langs: d.languages, overrides: d.overrides ?? {} })).catch(() => {}); }, []);
  const langs = useMemo(() => [...LANGS, ...extra.langs.filter((l) => !LANGS.some((b) => b.code === l.code))], [extra.langs]);
  const dicts = useMemo(() => Object.fromEntries(langs.map((l) => [l.code, { ...(BASE[l.code] ?? {}), ...(extra.overrides[l.code] ?? {}) }])), [langs, extra.overrides]);
  const info = langs.find((l) => l.code === lang) ?? LANGS[0];
  const dir = info.dir;
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
    if (info.font) document.documentElement.style.setProperty('--font-ui', info.font); else document.documentElement.style.removeProperty('--font-ui');
  }, [lang, dir, info.font]);
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try { localStorage.setItem('lsp.lang', l); } catch { /* ignore */ }
  }, []);
  // A missing phrase falls back to English, then to the key itself.
  const t = useCallback<T>((key, vars) => {
    const s = dicts[lang]?.[key] ?? dicts.en?.[key] ?? key;
    return vars ? s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? '') as string) : s;
  }, [lang, dicts]);
  const has = useCallback((key: string) => key in (dicts[lang] ?? {}) || key in (dicts.en ?? {}), [lang, dicts]);
  const value = useMemo(() => ({ lang, dir, t, setLang, has, langs }), [lang, dir, t, setLang, has, langs]);
  return <I18n.Provider value={value}>{children}</I18n.Provider>;
}
export const useI18n = () => useContext(I18n);

// ---------- formatting: Latin digits in every language ----------
let orgTz = 'Asia/Riyadh';
export const setOrgTimezone = (tz: string | null | undefined) => { if (tz) orgTz = tz; };
export const fmtDate = (d: string | null | undefined) => (d ? d.slice(0, 10) : '—');
export function fmtDateTime(d: string | null | undefined) {
  if (!d) return '—';
  const utc = new Date(d.replace(' ', 'T') + (d.length <= 19 ? 'Z' : ''));
  if (Number.isNaN(utc.getTime())) return d;
  return new Intl.DateTimeFormat('en-GB', { timeZone: orgTz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
    .format(utc).replace(/(\d+)\/(\d+)\/(\d+),?/, '$3-$2-$1');
}
export const fmtNum = (n: number | string | null | undefined, digits = 0) =>
  n === null || n === undefined || n === '' ? '—' : Number(n).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
export const fmtMoney = (n: number | string | null | undefined) => (n === null || n === undefined || n === '' ? '—' : `${fmtNum(n, 2)} SAR`);
export const fmtBytes = (b: number) => (b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1048576).toFixed(1)} MB`);
