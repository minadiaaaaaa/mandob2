import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { AlertTriangle, Bell, Bike, Car, CircleCheck, CircleSlash, FileWarning, FileX2, HandCoins, RefreshCw, Users, Wallet, Wrench, UserX } from 'lucide-react';
import { get } from '../api';
import { fmtDateTime, fmtNum, useI18n } from '../i18n';
import { Alert, Button, Card, cx, Loading, PageHeader } from '../ui/kit';
import { Bars, Columns, Donut, Gauge, Line } from '../ui/charts';

const DOT: Record<string, string> = { critical: 'bg-red-500', error: 'bg-red-500', warning: 'bg-amber-500' };
const SEG: Record<string, string> = { A: 'green', B: 'green', C: 'blue', D: 'amber', E: 'amber', F: 'red' };

function Figure({ icon, value, label, tone }: { icon: ReactNode; value: ReactNode; label: string; tone: 'green' | 'amber' | 'red' | 'grey' | 'blue' }) {
  const c = { green: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10', amber: 'bg-amber-50 text-amber-600 dark:bg-amber-500/10', red: 'bg-red-50 text-red-600 dark:bg-red-500/10',
    grey: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800', blue: 'bg-blue-50 text-blue-600 dark:bg-blue-500/10' }[tone];
  return (
    <div className="flex items-center gap-3 rounded-xl border border-zinc-200/80 bg-white p-3.5 shadow-xs dark:border-zinc-800 dark:bg-zinc-900">
      <span className={cx('flex size-10 shrink-0 items-center justify-center rounded-lg [&_svg]:size-5', c)}>{icon}</span>
      <div className="min-w-0"><div className="text-xl font-semibold num">{value ?? '—'}</div><div className="truncate text-xs text-zinc-500">{label}</div></div>
    </div>
  );
}

export default function Dashboard() {
  const { t } = useI18n();
  const [d, setD] = useState<any>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setBusy(true); setFailed(false);
    try { setD(await get('/dashboard')); } catch { setFailed(true); } finally { setBusy(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const none = t('dash.no_data');
  const header = <PageHeader title={t('dash.title')} subtitle={t('dash.subtitle')} actions={<Button icon={<RefreshCw className={cx('size-4', busy && 'animate-spin')} />} onClick={load}>{t('dash.refresh')}</Button>} />;
  if (failed && !d) return <>{header}<Alert tone="red" title={t('dash.load_failed')} action={<Button size="sm" onClick={load}>{t('dash.try_again')}</Button>} /></>;
  if (!d) return <>{header}<Loading /></>;
  const { alerts: a, figures: f, charts: c } = d;
  const kv = (rows: any[] | null, prefix: string, tone?: (k: string) => string) => (rows ?? []).map((r) => ({ label: t(`${prefix}.${r.k}`), value: Number(r.n), tone: tone?.(r.k) }));
  const levels = a ? [['expired', a.expired, 'bg-red-500', t('dash.lvl_expired')], ['l1', a.l1, 'bg-orange-500', t('dash.within', { n: a.days[0] })],
    ['l2', a.l2, 'bg-amber-400', t('dash.within', { n: a.days[1] })], ['l3', a.l3, 'bg-blue-500', t('dash.within', { n: a.days[2] })]].filter((l) => Number(l[1]) > 0) : [];
  return (
    <>
      {header}
      {levels.length > 0 && (
        <div className="mb-5 rounded-xl border border-red-200 bg-gradient-to-l from-red-50 to-white p-4 dark:border-red-900 dark:from-red-950/40 dark:to-zinc-900">
          <div className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-red-600 text-white"><AlertTriangle className="size-5" /></span>
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-red-800 dark:text-red-300">{t('dash.alerts_title')}</div>
              <div className="text-xs text-red-700/80 dark:text-red-300/80">{t('dash.alerts_sub')}</div>
              <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm">{levels.map(([k, n, dot, label]) => <span key={k} className="flex items-center gap-1.5"><span className={cx('size-2.5 rounded-full', dot)} /><b className="num">{fmtNum(n)}</b>{label}</span>)}</div>
              <div className="mt-1 flex flex-wrap gap-x-5 text-xs text-zinc-600 dark:text-zinc-400">
                {[['vehicle', 'dash.vehicle_docs'], ['rider', 'dash.rider_docs'], ['other', 'dash.other_docs']].map(([k, l]) => <span key={k}>{t(l)}: <b className="num">{a[k]}</b> {t('dash.docs_word')}</span>)}
              </div>
            </div>
          </div>
        </div>
      )}
      <h2 className="mb-2 text-sm font-semibold text-zinc-500">{t('dash.key_figures')}</h2>
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
        <Figure icon={<Car />} value={fmtNum(f?.vehicles.total)} label={t('dash.f.vehicles')} tone="grey" />
        <Figure icon={<CircleCheck />} value={fmtNum(f?.vehicles.active)} label={t('dash.f.active_vehicles')} tone="green" />
        <Figure icon={<Wrench />} value={fmtNum(f?.vehicles.maintenance)} label={t('dash.f.maintenance')} tone="amber" />
        <Figure icon={<CircleSlash />} value={fmtNum(f?.vehicles.retired)} label={t('dash.f.retired')} tone="grey" />
        <Figure icon={<Users />} value={fmtNum(f?.riders.total)} label={t('dash.f.riders')} tone="grey" />
        <Figure icon={<Bike />} value={fmtNum(f?.riders.active)} label={t('dash.f.active_riders')} tone="green" />
        <Figure icon={<UserX />} value={fmtNum(f?.riders.inactive)} label={t('dash.f.inactive_riders')} tone="amber" />
        <Figure icon={<FileX2 />} value={fmtNum(f?.docs.expired)} label={t('dash.f.expired_docs')} tone={f?.docs.expired ? 'red' : 'grey'} />
        <Figure icon={<FileWarning />} value={fmtNum(f?.docs.soon)} label={t('dash.f.soon_docs')} tone="amber" />
        <Figure icon={<HandCoins />} value={fmtNum(f?.advances_open)} label={t('dash.f.open_advances')} tone="blue" />
        <Figure icon={<Wallet />} value={f ? `${fmtNum(f.outstanding)} SAR` : '—'} label={t('dash.f.outstanding')} tone="amber" />
        <Figure icon={<Bell />} value={fmtNum(f?.unread)} label={t('dash.f.unread')} tone={f?.unread ? 'blue' : 'grey'} />
      </div>
      <h2 className="mb-2 text-sm font-semibold text-zinc-500">{t('dash.charts')}</h2>
      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <Card title={t('dash.c.vehicles')}><Bars data={kv(c.vehicles, 'vehicle.status', (k) => ({ active: 'green', maintenance: 'amber', retired: 'grey' } as any)[k])} empty={none} /></Card>
        <Card title={t('dash.c.riders')}><Bars data={kv(c.riders, 'rider.status', (k) => ({ active: 'green', inactive: 'grey', suspended: 'amber', terminated: 'red' } as any)[k])} empty={none} /></Card>
        <Card title={t('dash.c.doc_kinds')}><Donut data={kv(c.doc_kinds, 'alerts.kind').map((x, i) => ({ ...x, tone: ['brand', 'blue', 'green', 'amber', 'red', 'grey'][i % 6] }))} center={t('dash.docs_word')} empty={none} /></Card>
        <Card title={t('dash.c.compliance')}>{c.compliance?.total ? <Gauge value={Number(c.compliance.valid)} total={Number(c.compliance.total)} label={t('dash.valid_docs')} /> : <p className="py-10 text-center text-sm text-zinc-500">{none}</p>}</Card>
        <Card title={t('dash.c.advances')}><Donut data={kv(c.advances, 'adv.s', (k) => ({ pending: 'blue', approved: 'blue', disbursed: 'amber', repaying: 'amber', settled: 'green', rejected: 'grey', cancelled: 'grey' } as any)[k])} center={t('common.total')} empty={none} /></Card>
        <Card title={t('dash.c.ratings')} subtitle={c.ratings?.month && <span className="num">{c.ratings.month}</span>}><Columns data={(c.ratings?.rows ?? []).map((r: any) => ({ label: r.k, value: Number(r.n), tone: SEG[r.k] }))} empty={none} /></Card>
        <Card title={t('dash.c.deliveries')} className="lg:col-span-2">
          {c.deliveries?.length ? (
            <div className="flex items-end gap-1" style={{ height: 180 }}>
              {(() => { const max = Math.max(1, ...c.deliveries.map((x: any) => Number(x.completed))); return c.deliveries.map((x: any) => (
                <div key={x.k} className="flex flex-1 flex-col items-center gap-1" title={`${x.k}: ${x.completed} / ${x.cancelled}`}>
                  <span className="text-[10px] text-zinc-500 num">{fmtNum(x.completed)}</span>
                  <div className="flex w-full items-end justify-center gap-0.5" style={{ height: 130 }}>
                    <div className="w-1/2 max-w-4 rounded-t bg-emerald-500" style={{ height: `${(x.completed / max) * 100}%` }} />
                    <div className="w-1/2 max-w-4 rounded-t bg-red-400" style={{ height: `${(x.cancelled / max) * 100}%` }} />
                  </div>
                  <span className="text-[10px] text-zinc-500 num">{String(x.k).slice(5)}</span>
                </div>)); })()}
            </div>
          ) : <p className="py-10 text-center text-sm text-zinc-500">{none}</p>}
        </Card>
        <Card title={t('dash.c.photos')}><Bars data={kv(c.photos, 'brand.v')} empty={none} /></Card>
        <Card title={t('dash.c.sync')}><Donut data={kv(c.sync, 'sync.o', (k) => ({ succeeded: 'green', failed: 'red', skipped: 'grey', needs_sign_in: 'amber' } as any)[k])} empty={none} /></Card>
        <Card title={t('dash.c.expiring')} className="lg:col-span-2"><Line data={(c.expiring ?? []).map((r: any) => ({ label: r.k, value: Number(r.n) }))} empty={none} /></Card>
      </div>
      <Card title={t('dash.events')} pad={false}>
        {!d.events?.length ? <p className="p-4 text-sm text-zinc-500">{t('dash.no_events')}</p> : (
          <ul className="divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
            {d.events.map((e: any) => (
              <li key={e.id} className="flex items-start gap-3 px-4 py-2.5">
                <span className={cx('mt-1.5 size-2 shrink-0 rounded-full', DOT[e.severity] ?? 'bg-zinc-300 dark:bg-zinc-600')} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2"><code className="text-xs font-semibold" dir="ltr">{e.action}</code>
                    {e.actor_name && <span className="text-xs text-zinc-500">{e.actor_name}</span>}
                    {e.entity_type && <span className="text-xs text-zinc-400" dir="ltr">{e.entity_type} #{e.entity_id}</span>}</div>
                  {e.details && <div className="truncate text-xs text-zinc-500" title={e.details} dir="auto">{e.details}</div>}
                </div>
                <span className="shrink-0 text-xs text-zinc-500 num">{fmtDateTime(e.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
