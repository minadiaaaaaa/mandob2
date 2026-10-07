import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import ar from '@shared/i18n/ar.json';
import en from '@shared/i18n/en.json';
import bn from '@shared/i18n/bn.json';
import ur from '@shared/i18n/ur.json';

export const LANGS = [
  { code: 'ar', name: 'العربية', dir: 'rtl' },
  { code: 'en', name: 'English', dir: 'ltr' },
  { code: 'bn', name: 'বাংলা', dir: 'ltr' },
  { code: 'ur', name: 'اردو', dir: 'rtl' },
] as const;
export type Lang = (typeof LANGS)[number]['code'];
const DICTS: Record<string, Record<string, string>> = { ar, en, bn, ur };

export type T = (key: string, vars?: Record<string, unknown>) => string;
type Ctx = { lang: Lang; dir: 'rtl' | 'ltr'; t: T; setLang: (l: Lang) => void; has: (key: string) => boolean };
const I18n = createContext<Ctx>(null!);

const stored = (): Lang => {
  try { const l = localStorage.getItem('lsp.lang'); if (l && l in DICTS) return l as Lang; } catch { /* storage blocked */ }
  return 'ar';
};

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(stored);
  const dir = LANGS.find((l) => l.code === lang)!.dir;
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
  }, [lang, dir]);
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try { localStorage.setItem('lsp.lang', l); } catch { /* ignore */ }
  }, []);
  // A missing phrase falls back to English, then to the key itself.
  const t = useCallback<T>((key, vars) => {
    const s = DICTS[lang][key] ?? en[key as keyof typeof en] ?? key;
    return vars ? s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? '') as string) : s;
  }, [lang]);
  const has = useCallback((key: string) => key in DICTS[lang] || key in en, [lang]);
  const value = useMemo(() => ({ lang, dir, t, setLang, has }), [lang, dir, t, setLang, has]);
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
