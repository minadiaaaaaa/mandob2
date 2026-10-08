import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Activity, AlertTriangle, CalendarDays, Camera, ChevronLeft, ChevronRight, Clock, Download, FilePen, FileText, Gauge as GaugeIcon, MessagesSquare, RefreshCw, Star, Timer, UserRound, X,
} from 'lucide-react';
import { download, get } from '../../api';
import { fmtDate, fmtDateTime, fmtNum, useI18n } from '../../i18n';
import { Alert, Badge, Button, Card, cx, Details, Loading, PageHeader, StatCard, useAction, type Tone } from '../../ui/kit';
import { Bars, Columns, Donut, Line } from '../../ui/charts';
import { riderFile, useRider } from './shell';

// ---------- shared ----------
export const DOCS = ['id', 'license', 'health', 'driver_card', 'ajeer'];
export const rateTone = (r: number | null | undefined): Tone => (r == null ? 'none' : r >= 0.9 ? 'green' : r >= 0.75 ? 'amber' : 'red');
const lostTone = (h: number): Tone => (h < 1 ? 'green' : h < 2.5 ? 'amber' : 'red');
const pct = (r: number | null | undefined, d = 1) => (r == null ? '—' : `${fmtNum(Number(r) * 100, d)}%`);
const SEG_TONE: Record<string, Tone> = { A: 'green', B: 'green', C: 'blue', D: 'amber', E: 'amber', F: 'red' };
export const RESULT_TONE: Record<string, Tone> = { fine: 'green', pending: 'blue', blurred: 'amber', unreadable: 'amber', no_face: 'red', failed: 'red' };
const RESULTS = ['fine', 'pending', 'blurred', 'unreadable', 'no_face', 'failed'];
const CARD_TONE: Record<string, Tone> = { visible: 'green', unclear: 'amber', not_visible: 'red' };
const SOURCE_TONE: Record<string, Tone> = { direct: 'green', unclear: 'amber', screen: 'red' };
export const ITEM_TONE: Record<string, Tone> = { missing: 'red', expired: 'red', expiring: 'amber', pending: 'blue', valid: 'green', done: 'green' };
const today = () => new Date().toLocaleDateString('en-CA');
const shift = (d: string, n: number) => new Date(Date.parse(d) + n * 86400000).toISOString().slice(0, 10);
export function useMonthName() {
  const { lang } = useI18n();
  return useCallback((m: string) => { try { return new Intl.DateTimeFormat(`${lang}-u-nu-latn`, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${m}-01T00:00:00Z`)); } catch { return m; } }, [lang]);
}
function useLoad<T>(path: string | null, query?: Record<string, any>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const key = JSON.stringify([path, query]);
  const load = useCallback(() => { if (!path) return; setError(null); get<T>(path, query).then(setData).catch(setError); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);
  return { data, error, reload: load };
}

// The full-size viewer: previous / next with the arrows, Esc closes.
export function Viewer({ items, index, onIndex, onClose, caption }: { items: { src: string; mime?: string }[]; index: number; onIndex: (i: number) => void; onClose: () => void; caption?: ReactNode }) {
  const { t, dir } = useI18n();
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [index]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      const next = (e.key === 'ArrowRight') !== (dir === 'rtl') ? 1 : -1;
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') onIndex(Math.min(items.length - 1, Math.max(0, index + next)));
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [index, items.length, onClose, onIndex, dir]);
  const it = items[index];
  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black/90 text-white" role="dialog">
      <div className="flex items-center gap-2 p-3">
        <span className="text-sm num">{index + 1} / {items.length}</span>
        <button className="ms-auto rounded-lg p-2 hover:bg-white/10" title={t('rp.close')} onClick={onClose}><X className="size-5" /></button>
      </div>
      <div className="relative flex flex-1 items-center justify-center overflow-hidden px-12">
        {it.mime === 'application/pdf' ? <iframe src={it.src} className="h-full w-full rounded bg-white" />
          : broken ? <div className="text-sm text-zinc-300">{t('rp.image_unavailable')}</div>
          : <img src={it.src} alt="" className="max-h-full max-w-full object-contain" onError={() => setBroken(true)} />}
        {index > 0 && <button className="absolute start-2 rounded-full bg-white/10 p-2 hover:bg-white/20" title={t('rp.previous')} onClick={() => onIndex(index - 1)}><ChevronLeft className="size-6 rtl:rotate-180" /></button>}
        {index < items.length - 1 && <button className="absolute end-2 rounded-full bg-white/10 p-2 hover:bg-white/20" title={t('rp.next')} onClick={() => onIndex(index + 1)}><ChevronRight className="size-6 rtl:rotate-180" /></button>}
      </div>
      {caption && <div className="p-3 text-center text-sm">{caption}</div>}
    </div>
  );
}

// "Period" with preset buttons, then the two date fields.
type Preset = [key: string, from: () => string, to: () => string];
function PeriodFilter({ presets, from, to, onChange }: { presets: Preset[]; from: string; to: string; onChange: (from: string, to: string) => void }) {
  const { t } = useI18n();
  const active = presets.find(([, f, tt]) => f() === from && tt() === to)?.[0] ?? 'custom';
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="flex flex-wrap gap-1 rounded-xl bg-zinc-100 p-1 dark:bg-zinc-800">
        {presets.map(([k, f, tt]) => (
          <button key={k} onClick={() => onChange(f(), tt())} className={cx('rounded-lg px-3 py-1.5 text-xs font-medium', active === k ? 'bg-white shadow-sm dark:bg-zinc-900' : 'text-zinc-600 dark:text-zinc-300')}>{t(`rp.period.${k}`)}</button>
        ))}
        <span className={cx('rounded-lg px-3 py-1.5 text-xs font-medium', active === 'custom' ? 'bg-white shadow-sm dark:bg-zinc-900' : 'text-zinc-500')}>{t('rp.period.custom')}</span>
      </div>
      <label className="flex flex-col text-xs text-zinc-500">{t('rp.from')}<input type="date" className="input mt-0.5 h-9 w-40" value={from} onChange={(e) => onChange(e.target.value, to)} /></label>
      <label className="flex flex-col text-xs text-zinc-500">{t('rp.to')}<input type="date" className="input mt-0.5 h-9 w-40" value={to} onChange={(e) => onChange(from, e.target.value)} /></label>
    </div>
  );
}
const P7: Preset = ['7', () => shift(today(), -6), today];
const P30: Preset = ['30', () => shift(today(), -29), today];

// ======================================================================== 12.4 overview
export function Overview() {
  const { t } = useI18n();
  const { me } = useRider();
  const nav = useNavigate();
  const month = useMonthName();
  const { data: d, reload } = useLoad<any>('/portal/overview');
  const [details, setDetails] = useState(() => window.innerWidth >= 1024);
  const h = new Date().getHours();
  const greet = h < 12 ? 'rp.ov.morning' : h < 17 ? 'rp.ov.afternoon' : 'rp.ov.evening';
  if (!d) return <Loading />;
  const w = d.week, m = d.month;
  const photos = Object.fromEntries(d.photos.map((p: any) => [p.result, Number(p.n)]));
  const rejected = ['blurred', 'unreadable', 'no_face', 'failed'].reduce((s, k) => s + (photos[k] ?? 0), 0);
  const r = d.ratings[0];
  return (
    <div className="space-y-5">
      <PageHeader title={t(greet, { name: me.alias || me.full_name.split(' ')[0] })} actions={<Button icon={<RefreshCw className="size-4" />} onClick={reload}>{t('rp.refresh')}</Button>} />
      {d.completion.missing > 0 && (
        <button onClick={() => nav('/rider/profile')} className="flex w-full items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-start text-red-900 hover:bg-red-100 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100">
          <AlertTriangle className="size-6 shrink-0" />
          <div className="flex-1"><div className="font-semibold">{t('rp.ov.missing', { n: d.completion.missing })}</div>
            <div className="mt-1.5 h-1.5 rounded-full bg-red-200 dark:bg-red-900"><div className="h-1.5 rounded-full bg-red-600" style={{ width: `${d.completion.percent}%` }} /></div></div>
          <span className="text-sm font-semibold num">{d.completion.percent}%</span>
        </button>
      )}
      <Card title={t('rp.ov.last7')}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Figure label={t('rp.ov.orders')} value={fmtNum(w.completed)} />
          <Figure label={t('rp.ov.absent_days')} value={fmtNum(w.absent)} tone={w.absent ? 'red' : 'green'} />
          <Figure label={t('rp.ov.hours_worked')} value={fmtNum(w.hours, 1)} sub={t('rp.ov.of_required', { n: fmtNum(w.planned, 1) })} />
          <Figure label={t('rp.ov.hours_lost')} value={fmtNum(w.lost, 1)} tone={lostTone(Number(w.lost))} />
        </div>
      </Card>
      <div className="text-center"><Button variant="ghost" size="sm" onClick={() => setDetails(!details)}>{details ? t('rp.hide_details') : t('rp.show_details')}</Button></div>
      {details && (
        <>
          <div>
            <h2 className="mb-2 text-sm font-semibold text-zinc-500">{t('rp.ov.key30')}</h2>
            <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4 [&>*]:min-w-0">
              <StatCard icon={<Activity />} label={t('rp.ov.completed')} value={fmtNum(m.completed)} onClick={() => nav('/rider/performance')} />
              <StatCard icon={<Clock />} label={t('rp.ov.att_rate')} value={pct(m.att)} tone={rateTone(m.att)} onClick={() => nav('/rider/performance')} />
              <StatCard icon={<GaugeIcon />} label={t('rp.ov.acc_rate')} value={pct(m.acc)} tone={rateTone(m.acc)} onClick={() => nav('/rider/performance')} />
              <StatCard icon={<Timer />} label={t('rp.ov.work_hours')} value={fmtNum(m.hours, 1)} onClick={() => nav('/rider/performance')} />
              <StatCard icon={<Star />} label={t('rp.ov.latest_rating')} value={r ? r.segment ?? pct(r.final_score) : '—'} tone={r?.segment ? SEG_TONE[r.segment] : 'none'} onClick={() => nav('/rider/ratings')} />
              <StatCard icon={<Camera />} label={t('rp.ov.photos')} value={`${fmtNum(photos.fine ?? 0)} / ${fmtNum(rejected)}`} tone={rejected ? 'amber' : 'none'} onClick={() => nav('/rider/attendance')} />
              <StatCard icon={<FilePen />} label={t('rp.ov.requests')} value={fmtNum(d.requests_pending)} tone={d.requests_pending ? 'amber' : 'none'} onClick={() => nav('/rider/requests')} />
              <StatCard icon={<MessagesSquare />} label={t('rp.ov.issues')} value={fmtNum(d.issues_open)} tone={d.issues_open ? 'red' : 'none'} onClick={() => nav('/rider/issues')} />
            </div>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title={t('rp.ov.chart_deliveries')}>
              <Columns data={d.daily.map((x: any) => ({ label: x.day.slice(8), value: Number(x.completed ?? 0) }))} empty={t('rp.no_data')} />
              {d.daily.length > 0 && <div className="mt-4"><div className="mb-1 text-xs text-zinc-500">{t('rp.ov.att_rate')}</div>
                <Line data={d.daily.filter((x: any) => x.att != null).map((x: any) => ({ label: x.day.slice(5), value: Number(x.att) * 100 }))} format={(n) => `${fmtNum(n)}%`} height={90} /></div>}
            </Card>
            <Card title={t('rp.ov.chart_photos')}>
              <Donut data={RESULTS.filter((k) => photos[k]).map((k) => ({ label: t(`rp.res.${k}`), value: photos[k], tone: RESULT_TONE[k], key: k }))} empty={t('rp.no_data')}
                onPick={(x: any) => nav(`/rider/attendance?result=${x.key}`)} />
            </Card>
          </div>
          <Card title={t('rp.ov.monthly')} actions={<Link to="/rider/ratings" className="text-xs text-brand hover:underline">{t('rp.open')}</Link>}>
            {!r ? <p className="text-sm text-zinc-500">{t('rp.rat.none')}</p> : (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-4">
                  <SegmentBadge seg={r.segment} big />
                  <div><div className="text-sm text-zinc-500">{month(r.month)}</div><div className="text-2xl font-semibold num">{pct(r.final_score)}</div></div>
                  <div className="grid flex-1 grid-cols-2 gap-2 text-sm sm:grid-cols-3">
                    <Mini label={t('rp.rat.on_time')} value={pct(r.on_time)} /><Mini label={t('rp.rat.fail_rate')} value={pct(r.fail_rate_score)} />
                    <Mini label={t('rp.rat.verification')} value={pct(r.verification_rate)} />
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5" dir="ltr">
                  {[...d.ratings].reverse().map((x: any) => <span key={x.month} title={month(x.month)}><SegmentBadge seg={x.segment} label={x.month.slice(2).replace('-', '/')} /></span>)}
                </div>
              </div>
            )}
          </Card>
        </>
      )}
      <Card title={t('rp.ov.quick')}>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {([['/rider/profile', 'rp.nav.profile', UserRound], ['/rider/attendance', 'rp.nav.attendance', Camera], ['/rider/performance', 'rp.nav.performance', Activity],
            ['/rider/requests', 'rp.nav.requests', FilePen], ['/rider/leaves', 'rp.nav.leaves', CalendarDays], ['/rider/issues', 'rp.nav.issues', MessagesSquare]] as const).map(([to, k, Icon]) => (
            <Link key={to} to={to} className="flex items-center gap-2 rounded-xl border border-zinc-200 p-3 text-sm hover:border-brand hover:text-brand dark:border-zinc-800"><Icon className="size-4" />{t(k)}</Link>
          ))}
        </div>
      </Card>
    </div>
  );
}
function Figure({ label, value, sub, tone = 'none' }: { label: string; value: ReactNode; sub?: ReactNode; tone?: Tone }) {
  const color = { green: 'text-emerald-600', amber: 'text-amber-600', red: 'text-red-600', blue: 'text-blue-600', grey: '', none: '' }[tone];
  return <div className="rounded-xl bg-zinc-50 p-3 dark:bg-zinc-800/50"><div className="text-xs text-zinc-500">{label}</div><div className={cx('mt-1 text-2xl font-semibold num', color)}>{value}</div>{sub && <div className="text-xs text-zinc-500">{sub}</div>}</div>;
}
const Mini = ({ label, value }: { label: string; value: ReactNode }) => <div><div className="text-xs text-zinc-500">{label}</div><div className="font-medium num">{value}</div></div>;
export function SegmentBadge({ seg, big, label }: { seg: string | null; big?: boolean; label?: string }) {
  const c = { green: 'bg-emerald-500', blue: 'bg-blue-500', amber: 'bg-amber-500', red: 'bg-red-500', grey: 'bg-zinc-400', none: 'bg-zinc-400' }[seg ? SEG_TONE[seg] ?? 'none' : 'none'];
  return <span className={cx('inline-flex flex-col items-center justify-center rounded-lg font-bold text-white', c, big ? 'size-14 text-2xl' : 'min-w-9 px-1.5 py-1 text-xs')}>
    {seg ?? '—'}{label && <span className="text-[9px] font-normal opacity-90 num">{label}</span>}</span>;
}

// ======================================================================== 12.5 my profile
export function Profile() {
  const { t, lang } = useI18n();
  const nav = useNavigate();
  const { data: p } = useLoad<any>('/portal/profile');
  const [view, setView] = useState<number | null>(null);
  if (!p) return <Loading />;
  const c = p.completion;
  const target = (key: string, status: string, reqId: number | null) => status === 'pending' && reqId ? '/rider/requests'
    : key === 'photo' ? '/rider/requests?type=photo' : key === 'phone' ? '/rider/requests?type=contact' : `/rider/requests?type=document&doc=${key}`;
  const images = p.files.filter((f: any) => f.mime.startsWith('image/') || f.mime === 'application/pdf');
  const remaining = (days: number | null) => days == null ? <Badge tone="grey">{t('rp.pf.no_expiry')}</Badge>
    : days < 0 ? <Badge tone="red">{t('rp.pf.expired_ago', { n: -days })}</Badge> : days === 0 ? <Badge tone="red">{t('rp.pf.expires_today')}</Badge>
    : <Badge tone={days <= 30 ? 'amber' : 'green'}>{t('rp.pf.days_left', { n: days })}</Badge>;
  const np = <span className="text-zinc-400">{t('rp.not_provided')}</span>;
  return (
    <div className="space-y-5">
      <PageHeader title={t('rp.nav.profile')} subtitle={t('rp.pf.subtitle')} />
      <Card title={c.missing ? t('rp.pf.n_missing', { n: c.missing }) : t('rp.pf.complete')} actions={<span className="text-sm font-semibold num">{c.percent}%</span>}>
        <div className="mb-3 h-2 rounded-full bg-zinc-100 dark:bg-zinc-800"><div className={cx('h-2 rounded-full', c.missing ? 'bg-amber-500' : 'bg-emerald-500')} style={{ width: `${c.percent}%` }} /></div>
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {c.items.map((i: any) => (
            <li key={i.key} className="flex items-center gap-3 py-2 text-sm">
              <span className="flex-1">{t(`rp.item.${i.key}`)}</span>
              <Badge tone={ITEM_TONE[i.status]}>{i.status === 'expiring' ? t('rp.st.expiring', { n: i.days }) : t(`rp.st.${i.status}`)}</Badge>
              {i.status !== 'valid' && i.status !== 'done' && <Button size="sm" onClick={() => nav(target(i.key, i.status, i.request_id))}>
                {t(i.status === 'pending' ? 'rp.track' : i.status === 'missing' ? 'rp.add_now' : 'rp.renew_now')}</Button>}
            </li>
          ))}
        </ul>
      </Card>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <div className="flex flex-col items-center text-center">
            {p.photo_id ? <button onClick={() => setView(-1)}><img src={riderFile(p.photo_id)} alt="" className="size-28 rounded-full object-cover ring-4 ring-brand/15" /></button>
              : <div className="flex size-28 items-center justify-center rounded-full bg-zinc-100 text-3xl font-semibold text-zinc-400 dark:bg-zinc-800">{p.full_name.slice(0, 2)}</div>}
            <h2 className="mt-3 text-lg font-semibold">{p.full_name}</h2>
            {p.alias && <div className="text-sm text-zinc-500">{p.alias}</div>}
            <div className="mt-1 text-sm text-zinc-500">{t('rp.rider_id')}: <span className="num">{p.id}</span></div>
            <Badge className="mt-2" tone={p.status === 'active' ? 'green' : 'grey'}>{t(`rp.status.${p.status}`)}</Badge>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Button size="sm" onClick={() => nav('/rider/requests?type=contact')}>{t('rp.pf.update_contact')}</Button>
              <Button size="sm" onClick={() => nav('/rider/requests?type=photo')}>{t('rp.pf.update_photo')}</Button>
            </div>
          </div>
        </Card>
        <div className="space-y-4 lg:col-span-2">
          <Card title={t('rp.pf.personal')}>
            <Details rows={[[t('rp.pf.phone'), p.phone ? <span className="num" dir="ltr">{p.phone}</span> : np, true], [t('rp.pf.email'), p.email ?? np, true],
              [t('rp.pf.holder_phone'), p.account_holder_phone ? <span className="num" dir="ltr">{p.account_holder_phone}</span> : np, true],
              [t('rp.pf.id_number'), p.national_id ? <span className="num" dir="ltr">{p.national_id}</span> : np, true], [t('rp.pf.nationality'), p.nationality ?? np, true],
              [t('rp.pf.birth_date'), p.birth_date ? <span className="num">{fmtDate(p.birth_date)}</span> : np, true]]} />
          </Card>
          <Card title={t('rp.pf.work')}>
            <Details rows={[[t('rp.pf.company'), p.company_name ?? np, true], [t('rp.pf.city'), (lang === 'ar' || lang === 'ur' ? p.city_ar ?? p.city_en : p.city_en ?? p.city_ar) ?? np, true],
              [t('rp.pf.contract'), p.contract_name ?? np, true], [t('rp.pf.start_date'), p.hire_date ? <span className="num">{fmtDate(p.hire_date)}</span> : np, true]]} />
          </Card>
        </div>
      </div>
      <Card title={t('rp.pf.documents')}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {DOCS.map((k) => {
            const d = p.documents.find((x: any) => x.doc_type === k);
            return (
              <div key={k} className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
                <div className="mb-2 flex items-center justify-between gap-2"><span className="font-medium">{t(`rp.doc.${k}`)}</span>{d ? remaining(d.days_left == null ? null : Number(d.days_left)) : <Badge tone="red">{t('rp.st.missing')}</Badge>}</div>
                {d && <Details cols={1} rows={[[t('rp.pf.number'), d.doc_number ? <span className="num" dir="ltr">{d.doc_number}</span> : np, true],
                  [t('rp.pf.issue_date'), d.issue_date ? <span className="num">{fmtDate(d.issue_date)}</span> : np, true], [t('rp.pf.expiry_date'), d.expiry_date ? <span className="num">{fmtDate(d.expiry_date)}</span> : np, true]]} />}
                <Button size="sm" className="mt-3 w-full" onClick={() => nav(`/rider/requests?type=document&doc=${k}`)}>{t('rp.pf.request_update')}</Button>
              </div>
            );
          })}
        </div>
      </Card>
      <Card title={t('rp.pf.attachments')}>
        {!p.files.length ? <p className="text-sm text-zinc-500">{t('rp.pf.no_files')}</p> : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-8">
            {p.files.map((f: any) => f.mime.startsWith('image/')
              ? <button key={f.id} onClick={() => setView(images.indexOf(f))} className="aspect-square overflow-hidden rounded-lg bg-zinc-100 dark:bg-zinc-800"><img src={riderFile(f.id)} alt={f.file_name} className="size-full object-cover" /></button>
              : <a key={f.id} href={riderFile(f.id)} target="_blank" rel="noreferrer" className="flex aspect-square flex-col items-center justify-center gap-1 rounded-lg bg-zinc-100 p-2 text-center text-[10px] dark:bg-zinc-800"><FileText className="size-6 text-zinc-400" /><span className="line-clamp-2">{f.file_name}</span></a>)}
          </div>
        )}
      </Card>
      {view !== null && <Viewer items={view === -1 ? [{ src: riderFile(p.photo_id) }] : images.map((f: any) => ({ src: riderFile(f.id), mime: f.mime }))}
        index={Math.max(0, view)} onIndex={setView} onClose={() => setView(null)} />}
    </div>
  );
}

// ======================================================================== 12.6 attendance photos
export function Attendance() {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const [from, setFrom] = useState(shift(today(), -29));
  const [to, setTo] = useState(today());
  const result = params.get('result') ?? '';
  const [page, setPage] = useState(1);
  const [view, setView] = useState<number | null>(null);
  const bad = from > to;
  const { data } = useLoad<any>(bad ? null : '/portal/attendance', { from, to, result: result || undefined, page });
  const setResult = (r: string) => { setPage(1); setParams(r ? { result: r } : {}, { replace: true }); };
  const counts = Object.fromEntries((data?.counts ?? []).map((c: any) => [c.result, Number(c.n)]));
  const pages = data ? Math.max(1, Math.ceil(data.total / 24)) : 1;
  return (
    <div className="space-y-4">
      <PageHeader title={t('rp.nav.attendance')} subtitle={t('rp.att.subtitle')} />
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <PeriodFilter presets={[P7, P30, ['90', () => shift(today(), -89), today]]} from={from} to={to} onChange={(f, tt) => { setFrom(f); setTo(tt); setPage(1); }} />
          <label className="flex flex-col text-xs text-zinc-500">{t('rp.att.result')}
            <select className="input mt-0.5 h-9 w-44" value={result} onChange={(e) => setResult(e.target.value)}>
              <option value="">{t('rp.all')}</option>{RESULTS.map((r) => <option key={r} value={r}>{t(`rp.res.${r}`)}</option>)}
            </select></label>
        </div>
      </Card>
      {bad ? <Alert tone="amber">{t('err.start_after_end')}</Alert> : !data ? <Loading /> : (
        <>
          <div className="scroll-thin flex gap-2 overflow-x-auto pb-1">
            {RESULTS.map((r) => (
              <button key={r} onClick={() => setResult(result === r ? '' : r)} className={cx('flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-sm',
                result === r ? 'border-brand bg-brand/5' : 'border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900')}>
                <Badge tone={RESULT_TONE[r]}>{t(`rp.res.${r}`)}</Badge><span className="font-semibold num">{fmtNum(counts[r] ?? 0)}</span>
              </button>
            ))}
          </div>
          {!data.rows.length ? <Card><p className="py-8 text-center text-sm text-zinc-500">{t('rp.att.none')}</p></Card> : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {data.rows.map((ph: any, i: number) => (
                <div key={ph.id} className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
                  <button className="block aspect-[4/3] w-full bg-zinc-100 dark:bg-zinc-800" onClick={() => setView(i)}><Photo src={ph.photo_url} /></button>
                  <div className="space-y-1.5 p-2.5 text-xs">
                    <div className="text-zinc-500 num">{fmtDateTime(ph.captured_at)}</div>
                    <div className="flex flex-wrap gap-1">
                      <Badge tone={RESULT_TONE[ph.result]}>{t(`rp.res.${ph.result}`)}</Badge>
                      {ph.card_review !== 'none' && <Badge tone={CARD_TONE[ph.card_review]}>{t(`rp.card.${ph.card_review}`)}</Badge>}
                      {ph.source_review !== 'none' && <Badge tone={SOURCE_TONE[ph.source_review]}>{t(`rp.src.${ph.source_review}`)}</Badge>}
                    </div>
                    {ph.override_result && <p className="text-zinc-600 dark:text-zinc-400">{t('rp.att.changed')} {t('rp.att.changed_from', { from: t(`rp.res.${ph.check_result}`) })}</p>}
                    {ph.card_note && <p className="text-zinc-600 dark:text-zinc-400"><b>{t('rp.att.note')}</b> {ph.card_note}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
          {pages > 1 && <div className="flex items-center justify-center gap-3 text-sm">
            <Button size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>{t('rp.previous')}</Button><span className="num">{page} / {pages}</span>
            <Button size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>{t('rp.next')}</Button></div>}
          {view !== null && <Viewer items={data.rows.map((r: any) => ({ src: r.photo_url }))} index={view} onIndex={setView} onClose={() => setView(null)}
            caption={<span className="num">{fmtDateTime(data.rows[view].captured_at)} · {t(`rp.res.${data.rows[view].result}`)}</span>} />}
        </>
      )}
    </div>
  );
}
function Photo({ src }: { src: string }) {
  const { t } = useI18n();
  const [broken, setBroken] = useState(false);
  return broken ? <span className="flex size-full items-center justify-center text-xs text-zinc-400">{t('rp.image_unavailable')}</span>
    : <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-full object-cover" onError={() => setBroken(true)} />;
}

// ======================================================================== 12.7 performance
const DAY_TONE: Record<string, Tone> = { present: 'green', partial: 'amber', absent: 'red', leave: 'grey' };
export function Performance() {
  const { t } = useI18n();
  const run = useAction();
  const [from, setFrom] = useState(shift(today(), -29));
  const [to, setTo] = useState(today());
  const [group, setGroup] = useState<'day' | 'month'>('day');
  const [details, setDetails] = useState(false);
  const bad = from > to;
  const { data } = useLoad<any>(bad ? null : '/portal/performance', { from, to, group });
  const month0 = () => today().slice(0, 8) + '01';
  const lastMonth: Preset = ['last_month', () => { const d = new Date(month0()); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 10); }, () => shift(month0(), -1)];
  const presets: Preset[] = [['today', today, today], P7, P30, ['this_month', month0, today], lastMonth];
  const tot = data?.total;
  const rows: any[] = data?.rows ?? [];
  const head = ['date', 'completed', 'accepted', 'declined', 'cancelled', 'offered', 'att', 'acc', 'actual', 'planned', 'break', 'lost', 'no_shows', 'shifts'];
  const cells = (r: any) => [r.completed, r.accepted, r.declined, r.cancelled, r.notified].map((v) => fmtNum(v))
    .concat([<span className={cx({ green: 'text-emerald-600', amber: 'text-amber-600', red: 'text-red-600', none: '' }[rateTone(r.att) as 'green'])}>{pct(r.att, 2)}</span>,
      <span className={cx({ green: 'text-emerald-600', amber: 'text-amber-600', red: 'text-red-600', none: '' }[rateTone(r.acc) as 'green'])}>{pct(r.acc, 2)}</span>,
      fmtNum(r.actual, 1), fmtNum(r.planned, 1), fmtNum(r.break_hours, 1), <span className={Number(r.lost) >= 1 ? 'text-red-600' : ''}>{fmtNum(r.lost, 1)}</span>, fmtNum(r.no_shows), fmtNum(r.shifts)] as any);
  return (
    <div className="space-y-4">
      <PageHeader title={t('rp.nav.performance')} subtitle={t('rp.perf.subtitle')}
        actions={<Button icon={<Download className="size-4" />} disabled={!rows.length} onClick={() => run(() => download('/portal/performance/export', { from, to, group }))}>{t('rp.perf.export')}</Button>} />
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <PeriodFilter presets={presets} from={from} to={to} onChange={(f, tt) => { setFrom(f); setTo(tt); }} />
          <label className="flex flex-col text-xs text-zinc-500">{t('rp.perf.group')}
            <select className="input mt-0.5 h-9 w-32" value={group} onChange={(e) => setGroup(e.target.value as 'day')}><option value="day">{t('rp.perf.by_day')}</option><option value="month">{t('rp.perf.by_month')}</option></select></label>
        </div>
      </Card>
      {bad ? <Alert tone="amber">{t('err.start_after_end')}</Alert> : !data ? <Loading /> : !Number(tot.n) && !data.absence.days.length ? <Card><p className="py-8 text-center text-sm text-zinc-500">{t('rp.perf.none')}</p></Card> : (
        <>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6 [&>*]:min-w-0">
            <StatCard label={t('rp.perf.completed_deliveries')} value={fmtNum(tot.completed)} />
            <StatCard label={t('rp.perf.avg_att')} value={pct(tot.att)} tone={rateTone(tot.att)} />
            <StatCard label={t('rp.perf.avg_acc')} value={pct(tot.acc)} tone={rateTone(tot.acc)} />
            <StatCard label={t('rp.perf.actual_hours')} value={fmtNum(tot.actual, 1)} sub={t('rp.ov.of_required', { n: fmtNum(tot.planned, 1) })} />
            <StatCard label={t('rp.perf.declined_cancelled')} value={fmtNum(Number(tot.declined) + Number(tot.cancelled))} tone={Number(tot.declined) + Number(tot.cancelled) ? 'amber' : 'none'} />
            <StatCard label={t('rp.perf.shifts')} value={fmtNum(tot.shifts)} />
          </div>
          <Card title={t('rp.perf.absence')}>
            {data.absence.too_long ? <Alert tone="amber">{t('rp.perf.too_long')}</Alert> : (
              <>
                <div className="mb-3 grid grid-cols-3 gap-2">
                  <Figure label={t('rp.perf.absent_days')} value={fmtNum(data.absence.absent)} tone={data.absence.absent ? 'red' : 'green'} />
                  <Figure label={t('rp.perf.present_days')} value={fmtNum(data.absence.present)} />
                  <Figure label={t('rp.perf.wasted')} value={fmtNum(data.absence.wasted, 1)} tone={lostTone(data.absence.wasted)} />
                </div>
                {!data.absence.days.length ? <p className="text-sm text-zinc-500">{t('rp.perf.no_days')}</p> : (
                  <div className="scroll-thin max-h-96 overflow-auto">
                    <table className="w-full text-sm"><thead className="sticky top-0 bg-white text-xs text-zinc-500 dark:bg-zinc-900"><tr>
                      {['date', 'status', 'required', 'actual', 'wasted', 'shifts'].map((h) => <th key={h} className="p-2 text-start font-medium">{t(`rp.perf.col.${h}`)}</th>)}</tr></thead>
                      <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">{data.absence.days.map((d: any) => (
                        <tr key={d.day}><td className="p-2 num">{d.day}</td>
                          <td className="p-2"><Badge tone={DAY_TONE[d.status]}>{t(`rp.day.${d.status}`)}</Badge>{d.reason && <span className="ms-1 text-xs text-zinc-500">{t(`rp.reason.${d.reason}`) === `rp.reason.${d.reason}` ? d.reason : t(`rp.reason.${d.reason}`)}</span>}</td>
                          <td className="p-2 num">{fmtNum(d.planned, 1)}</td><td className="p-2 num">{fmtNum(d.actual, 1)}</td>
                          <td className={cx('p-2 num', d.wasted >= 1 && 'text-red-600')}>{fmtNum(d.wasted, 1)}</td><td className="p-2 num">{fmtNum(d.shifts)}</td></tr>))}</tbody></table>
                  </div>
                )}
              </>
            )}
          </Card>
          <div className="text-center"><Button variant="ghost" size="sm" onClick={() => setDetails(!details)}>{details ? t('rp.hide_details') : t('rp.show_details')}</Button></div>
          {details && (
            <>
              <div className="grid gap-4 lg:grid-cols-3">
                <Card title={t('rp.perf.chart_outcome')}><Bars data={[{ label: t('rp.perf.col.completed'), value: Number(tot.completed), tone: 'green' }, { label: t('rp.perf.col.declined'), value: Number(tot.declined), tone: 'amber' },
                  { label: t('rp.perf.col.cancelled'), value: Number(tot.cancelled), tone: 'red' }]} /></Card>
                <Card title={t('rp.perf.chart_rates')}><Line data={[...rows].reverse().filter((r) => r.att != null).map((r) => ({ label: r.label, value: Number(r.att) * 100 }))} format={(n) => `${fmtNum(n)}%`} empty={t('rp.no_data')} height={110} />
                  <div className="mt-2 text-xs text-zinc-500">{t('rp.perf.col.acc')}</div>
                  <Line data={[...rows].reverse().filter((r) => r.acc != null).map((r) => ({ label: r.label, value: Number(r.acc) * 100 }))} format={(n) => `${fmtNum(n)}%`} empty={t('rp.no_data')} height={80} /></Card>
                <Card title={t('rp.perf.chart_hours')}><Columns data={[...rows].reverse().slice(-14).map((r) => ({ label: group === 'day' ? r.label.slice(8) : r.label.slice(2), value: Number(r.actual), tone: Number(r.actual) >= Number(r.planned) ? 'green' : 'amber' }))} empty={t('rp.no_data')} height={110} />
                  <p className="mt-1 text-xs text-zinc-500">{t('rp.perf.hours_note')}</p></Card>
              </div>
              <Card title={t('rp.perf.details')} pad={false}>
                <div className="scroll-thin overflow-x-auto">
                  <table className="w-full whitespace-nowrap text-sm">
                    <thead className="bg-zinc-50 text-xs text-zinc-500 dark:bg-zinc-800/50"><tr>{head.map((h) => <th key={h} className="px-3 py-2 text-start font-medium">{t(`rp.perf.col.${h}`)}</th>)}</tr></thead>
                    <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                      {rows.map((r) => <tr key={r.label}><td className="px-3 py-2 num">{r.label}</td>{cells(r).map((c: ReactNode, i: number) => <td key={i} className="px-3 py-2 num">{c}</td>)}</tr>)}
                      <tr className="bg-zinc-50 font-semibold dark:bg-zinc-800/50"><td className="px-3 py-2">{t('rp.perf.total')}</td>{cells(tot).map((c: ReactNode, i: number) => <td key={i} className="px-3 py-2 num">{c}</td>)}</tr>
                    </tbody>
                  </table>
                </div>
              </Card>
            </>
          )}
        </>
      )}
    </div>
  );
}

// ======================================================================== 12.8 ratings
export function Ratings() {
  const { t } = useI18n();
  const month = useMonthName();
  const { data } = useLoad<any>('/portal/ratings');
  const rows: any[] = useMemo(() => data?.rows ?? [], [data]);
  if (!data) return <Loading />;
  if (!rows.length) return <div><PageHeader title={t('rp.nav.ratings')} /><Card><p className="py-10 text-center text-sm text-zinc-500">{t('rp.rat.none')}</p></Card></div>;
  const r = rows[0];
  const score = Number(r.final_score ?? 0) * 100;
  const color = { green: '#10b981', blue: '#3b82f6', amber: '#f59e0b', red: '#ef4444', grey: '#a1a1aa', none: '#a1a1aa' }[r.segment ? SEG_TONE[r.segment] : 'none'];
  const C = 2 * Math.PI * 52;
  return (
    <div className="space-y-4">
      <PageHeader title={t('rp.nav.ratings')} subtitle={t('rp.rat.subtitle')} />
      <Card>
        <div className="flex flex-wrap items-center gap-6">
          <svg viewBox="0 0 120 120" className="size-36 shrink-0 -rotate-90">
            <circle cx="60" cy="60" r="52" fill="none" strokeWidth="12" className="stroke-zinc-100 dark:stroke-zinc-800" />
            <circle cx="60" cy="60" r="52" fill="none" strokeWidth="12" stroke={color} strokeLinecap="round" strokeDasharray={`${(score / 100) * C} ${C}`} />
            <text x="60" y="66" textAnchor="middle" className="rotate-90 fill-current text-lg font-semibold" style={{ transformOrigin: '60px 60px' }}>{fmtNum(score, 1)}%</text>
          </svg>
          <div className="min-w-0 flex-1 space-y-1">
            <div className="text-xs text-zinc-500">{r.month === data.current_month ? t('rp.rat.current') : t('rp.rat.latest')}</div>
            <div className="text-xl font-semibold">{month(r.month)}</div>
            <div className="text-sm text-zinc-500">{[r.city, r.contract].filter(Boolean).join(' · ')}</div>
            <div className="flex items-center gap-2 pt-1"><SegmentBadge seg={r.segment} /><span className="text-sm">{r.segment ? t(`rp.seg.${r.segment}`) : '—'}</span></div>
          </div>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Figure label={t('rp.rat.on_time')} value={pct(r.on_time)} sub={t('rp.rat.on_time_d')} />
          <Figure label={t('rp.rat.fail_rate')} value={pct(r.fail_rate_score)} sub={t('rp.rat.fail_rate_d')} />
          <Figure label={t('rp.rat.verification')} value={pct(r.verification_rate)} sub={t('rp.rat.verification_d')} />
          <Figure label={t('rp.rat.completed_gross')} value={`${fmtNum(r.completed)} / ${fmtNum(r.gross_orders)}`} sub={t('rp.rat.in_time_failed', { in: fmtNum(r.completed_in_time), failed: fmtNum(r.failed_by_rider) })} />
        </div>
        <p className="mt-3 text-xs text-zinc-500">{t('rp.rat.formula')}</p>
      </Card>
      <Card title={t('rp.rat.over_time')}>
        <Columns data={[...rows].reverse().map((x) => ({ label: x.month.slice(2).replace('-', '/'), value: Math.round(Number(x.final_score ?? 0) * 1000) / 10, tone: x.segment ? SEG_TONE[x.segment] : 'grey' }))} height={120} />
      </Card>
      <Card title={t('rp.rat.history')} pad={false}>
        <table className="hidden w-full text-sm md:table">
          <thead className="bg-zinc-50 text-xs text-zinc-500 dark:bg-zinc-800/50"><tr>{['month', 'segment', 'final', 'on_time', 'fail_rate', 'verification', 'completed_gross'].map((h) => <th key={h} className="px-3 py-2 text-start font-medium">{t(`rp.rat.col.${h}`)}</th>)}</tr></thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">{rows.map((x) => (
            <tr key={x.month}><td className="px-3 py-2">{month(x.month)}</td><td className="px-3 py-2"><SegmentBadge seg={x.segment} /></td><td className="px-3 py-2 num">{pct(x.final_score)}</td>
              <td className="px-3 py-2 num">{pct(x.on_time)}</td><td className="px-3 py-2 num">{pct(x.fail_rate_score)}</td><td className="px-3 py-2 num">{pct(x.verification_rate)}</td>
              <td className="px-3 py-2 num">{fmtNum(x.completed)} / {fmtNum(x.gross_orders)}</td></tr>))}</tbody>
        </table>
        <ul className="divide-y divide-zinc-100 md:hidden dark:divide-zinc-800">{rows.map((x) => (
          <li key={x.month} className="flex items-center gap-3 p-3"><SegmentBadge seg={x.segment} /><div className="flex-1"><div className="text-sm font-medium">{month(x.month)}</div>
            <div className="text-xs text-zinc-500 num">{t('rp.rat.on_time')} {pct(x.on_time)} · {t('rp.rat.fail_rate')} {pct(x.fail_rate_score)}</div></div><span className="font-semibold num">{pct(x.final_score)}</span></li>))}</ul>
      </Card>
      <Card title={t('rp.rat.segments')}>
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {['A', 'B', 'C', 'D', 'E', 'F'].map((s) => (
            <li key={s} className={cx('flex items-center gap-3 rounded-xl border p-3', s === r.segment ? 'border-brand ring-2 ring-brand/20' : 'border-zinc-200 dark:border-zinc-800')}>
              <SegmentBadge seg={s} /><div className="text-sm"><div className="font-medium">{t(`rp.seg.${s}`)}</div>{s === r.segment && <div className="text-xs text-brand">{t('rp.rat.your_segment')}</div>}</div>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-zinc-500">{t('rp.rat.cutoffs_note')}</p>
      </Card>
    </div>
  );
}
