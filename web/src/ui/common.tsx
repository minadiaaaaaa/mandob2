import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { FileDown } from 'lucide-react';
import { download, get, type Query } from '../api';
import { useAuth } from '../auth';
import { fmtNum, useI18n } from '../i18n';
import { Badge, Button, cx, toneText, useAction, type Tone } from './kit';

// Option lists for selects, cached for the session and refreshed on demand.
const cache = new Map<string, Promise<any>>();
export function useOptions<T = any>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T[]>([]);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!path) { setData([]); return; }
    if (!cache.has(path)) cache.set(path, get(path).catch((e) => { cache.delete(path); throw e; }));
    let live = true;
    cache.get(path)!.then((d) => live && setData(d)).catch(() => live && setFailed(true));
    return () => { live = false; };
  }, [path, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps
  return Object.assign(data, { failed });
}
export const invalidateOptions = (prefix = '') => { for (const k of cache.keys()) if (k.startsWith(prefix)) cache.delete(k); };

export function useCityName() {
  const { lang } = useI18n();
  return useCallback((r: { city_ar?: string | null; city_en?: string | null; name_ar?: string; name_en?: string | null } | null | undefined) => {
    if (!r) return '—';
    const ar = r.city_ar ?? r.name_ar; const en = r.city_en ?? r.name_en;
    return (lang === 'ar' || lang === 'ur' ? ar : en || ar) ?? '—';
  }, [lang]);
}

// ---------- the business rules, as the server defines them (GET /meta/rules) ----------
// Statuses and each document's alert period live on the server (domain/rules.ts); screens never keep their own copy.
export type ExpiryKind = 'id' | 'license' | 'health' | 'driver_card' | 'ajeer' | 'operation_card' | 'vehicle_registration' | 'transport_license' | 'vehicle_insurance' | 'insurance_policy';
export type Rules = { statuses: { rider: string[]; vehicle: string[]; user: string[] }; expiry_days: Record<ExpiryKind, number> };
const rulesCache = new Map<number, { at: number; rules: Promise<Rules> }>();
export function useRules(): Rules | null {
  const { me } = useAuth();
  const [rules, setRules] = useState<Rules | null>(null);
  useEffect(() => {
    if (!me) return;
    // read again after a minute, so a changed alert window reaches open screens without a reload
    const cached = rulesCache.get(me.id);
    if (!cached || Date.now() - cached.at > 60_000)
      rulesCache.set(me.id, { at: Date.now(), rules: get<Rules>('/meta/rules').catch((e) => { rulesCache.delete(me.id); throw e; }) });
    let live = true;
    rulesCache.get(me.id)!.rules.then((r) => live && setRules(r)).catch(() => {});
    return () => { live = false; };
  }, [me]);
  return rules;
}
// the window a document type is "expiring soon" in: a screen filter wins, then the company's setting
function useWindow(kind?: ExpiryKind, window?: number) {
  const rules = useRules();
  return window ?? (kind ? rules?.expiry_days[kind] : undefined) ?? 30;
}

// ---------- expiry colours used across documents and fleet screens ----------
export const expiryTone = (days: number | null | undefined, window = 30): Tone =>
  days === null || days === undefined ? 'grey' : days < 0 ? 'red' : days <= window ? 'amber' : 'green';

export function Remaining({ days, window, kind, notRecorded }: { days: number | null | undefined; window?: number; kind?: ExpiryKind; notRecorded?: string }) {
  const { t } = useI18n();
  const win = useWindow(kind, window);
  if (days === null || days === undefined) return <span className="text-zinc-500">{notRecorded ?? t('docs.not_recorded')}</span>;
  const text = days < 0 ? t('docs.expired_ago', { n: fmtNum(-days) }) : days === 0 ? t('docs.expires_today') : t('docs.days_left', { n: fmtNum(days) });
  return <span className={cx('text-xs font-medium', toneText(expiryTone(days, win)))}>{text}</span>;
}
export function ExpiryDate({ date, days, window, kind }: { date: string | null | undefined; days: number | null | undefined; window?: number; kind?: ExpiryKind }) {
  const win = useWindow(kind, window);
  if (!date) return <span className="text-zinc-400">—</span>;
  return (
    <div>
      <span className={cx('num font-medium', toneText(expiryTone(days, win)))}>{date}</span>
      <div><Remaining days={days} window={win} /></div>
    </div>
  );
}

export function StatusBadge({ map, value, prefix }: { map: Record<string, Tone>; value: string | null | undefined; prefix: string }) {
  const { t } = useI18n();
  if (!value) return <span className="text-zinc-400">—</span>;
  return <Badge tone={map[value] ?? 'grey'}>{t(`${prefix}.${value}`)}</Badge>;
}

export function ExportButton({ path, query, label, format }: { path: string; query?: Query; label?: ReactNode; format?: 'xlsx' | 'csv' }) {
  const { t } = useI18n();
  const run = useAction();
  const [busy, setBusy] = useState(false);
  return (
    <Button size="sm" loading={busy} icon={<FileDown className="size-3.5" />} onClick={async () => {
      setBusy(true);
      const q = { ...query }; delete q.page; delete q.pageSize;
      await run(() => download(path, format ? { ...q, format } : q));
      setBusy(false);
    }}>{label ?? t('common.export_excel')}</Button>
  );
}

export const YesNo = ({ v }: { v: unknown }) => {
  const { t } = useI18n();
  return <>{v && v !== '0' ? t('common.yes') : t('common.no')}</>;
};

// Number inputs accept Arabic digits too.
export const latin = (s: string) => s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6f0));
