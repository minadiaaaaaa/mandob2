import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Download, MapPin, RefreshCw, Settings2 } from 'lucide-react';
import { download, get } from '../../api';
import { useAuth } from '../../auth';
import { fmtDateTime, fmtNum, useI18n } from '../../i18n';
import { Alert, Badge, Button, Card, cx, Field, Loading, PageHeader, StatCard, StatGrid, useAction, type Tone } from '../../ui/kit';

const STATUS_TONE: Record<string, Tone> = { working: 'green', ready: 'blue', late: 'red', on_break: 'amber', not_started: 'grey', off_shift: 'grey' };
const STATUS_BG: Record<string, string> = { working: 'bg-emerald-500', ready: 'bg-blue-500', late: 'bg-red-500', on_break: 'bg-amber-500', not_started: 'bg-zinc-400', off_shift: 'bg-zinc-300', unknown: 'bg-zinc-200' };
const LEVEL_TONE: Record<string, Tone> = { high: 'red', medium: 'amber', normal: 'green' };
const dur = (m: number | null | undefined) => (m == null ? '—' : m < 60 ? `${Math.round(m)}m` : `${Math.floor(m / 60)}h ${String(Math.round(m % 60)).padStart(2, '0')}m`);
const map = (lat: number, lng: number) => `https://www.google.com/maps?q=${lat},${lng}`;
function StatusBadge({ s }: { s: string | null }) {
  const { t, has } = useI18n();
  if (!s) return <span className="text-zinc-400">—</span>;
  return <Badge tone={STATUS_TONE[s] ?? 'grey'}>{has(`live.s.${s}`) ? t(`live.s.${s}`) : s}</Badge>;
}

// ======================================================================== 3.6 live riders
export function LiveBoard() {
  const { t } = useI18n();
  const { can } = useAuth();
  const nav = useNavigate();
  const [d, setD] = useState<any>(null);
  const [filter, setFilter] = useState<string | null>(null);
  const [term, setTerm] = useState('');
  const load = useCallback(() => get('/live').then(setD).catch(() => {}), []);
  useEffect(() => { load(); const h = setInterval(load, 30000); return () => clearInterval(h); }, [load]);
  if (!d) return <Loading />;
  const s = d.stats;
  const match = (b: any) => ({ working: b.status === 'working', late: b.status === 'late' || b.late_min > 0, break: b.status === 'on_break', standing: b.over, wallet: b.wallet_over } as Record<string, boolean>)[filter ?? ''] ?? true;
  const rows = d.rows.filter((b: any) => match(b) && (!term || String(b.rider_id) === term || String(b.name ?? '').includes(term)));
  const card = (k: string, label: string, n: number, tone: Tone) => <StatCard label={label} value={fmtNum(n)} tone={n ? tone : 'none'} onClick={() => setFilter(filter === k ? null : k)} active={filter === k} />;
  return (
    <>
      <PageHeader title={t('live.title')} subtitle={<span>{t('live.last_read')}: <span className="num">{d.last_read ? fmtDateTime(d.last_read) : '—'}</span> · {t('live.radius_x', { n: d.radius })}</span>} actions={<>
        <Button icon={<RefreshCw className="size-4" />} onClick={load}>{t('common.refresh')}</Button>
        <Link to="/admin/live/report"><Button>{t('live.report')}</Button></Link>
        {can('live_riders.manage') && <Link to="/admin/sync"><Button icon={<Settings2 className="size-4" />}>{t('live.session_settings')}</Button></Link>}
      </>} />
      {!d.last_read && <div className="mb-4"><Alert tone="amber">{t('live.not_read')}</Alert></div>}
      <StatGrid>
        <StatCard label={t('live.c.board')} value={fmtNum(s.board)} onClick={() => setFilter(null)} active={!filter} />
        {card('working', t('live.s.working'), s.working, 'green')}{card('late', t('live.s.late'), s.late, 'red')}{card('break', t('live.s.on_break'), s.break, 'amber')}
        {card('standing', t('live.c.standing', { n: d.min_stop }), s.standing, 'red')}{card('wallet', t('live.c.wallet'), s.wallet, 'red')}
      </StatGrid>
      <div className="mb-3 flex items-center gap-2"><input type="search" className="input w-72" placeholder={t('live.search')} value={term} onChange={(e) => setTerm(e.target.value)} /><span className="text-xs text-zinc-500">{t('live.n_shown', { n: rows.length })}</span></div>
      <div className="overflow-x-auto rounded-xl border border-zinc-200/80 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50/80 text-xs text-zinc-500 dark:bg-zinc-800/30"><tr>{['rider', 'status', 'standing', 'shift', 'worked', 'late', 'breaks', 'deliveries', 'wallet', 'location'].map((k) => <th key={k} className="px-3 py-2 text-start font-medium">{t(`live.col.${k}`)}</th>)}</tr></thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {rows.length === 0 && <tr><td colSpan={10} className="p-10 text-center text-zinc-500">{t('table.no_records')}</td></tr>}
            {rows.map((b: any) => (
              <tr key={b.rider_id} onClick={() => nav(`/admin/live/riders/${b.rider_id}`)} className={cx('cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50', b.over && 'bg-red-50/70 dark:bg-red-950/30')}>
                <td className="px-3 py-2"><div className="font-medium">{b.name ?? '—'}</div><div className="text-xs text-zinc-500"><span className="num">#{b.rider_id}</span>{!b.known && ` · ${t('live.not_in_system')}`}</div></td>
                <td className="px-3 py-2"><StatusBadge s={b.status} /><div className="text-xs text-zinc-500 num">{fmtDateTime(b.seen_at).slice(11)}</div></td>
                <td className="px-3 py-2">{b.stale ? <span className="text-xs text-amber-600">{t('live.stale')}</span> : <span className={cx('num', b.over && 'font-semibold text-red-600')}>{dur(b.standing_min)}</span>}</td>
                <td className="px-3 py-2 num text-xs">{b.shift_start ?? '—'}–{b.shift_end ?? '—'}</td>
                <td className="px-3 py-2 num">{dur(b.worked_min)}</td>
                <td className="px-3 py-2 num">{b.late_min ? <span className="text-red-600">{dur(b.late_min)}</span> : '—'}</td>
                <td className="px-3 py-2 num">{b.breaks ?? 0} · {dur(b.break_min)}</td>
                <td className="px-3 py-2 num">{b.completed ?? 0}{b.active_orders ? <span className="text-xs text-zinc-500"> +{b.active_orders}</span> : null}</td>
                <td className="px-3 py-2 num"><span className={cx(b.wallet_over && 'font-semibold text-red-600')}>{b.wallet == null ? '—' : fmtNum(b.wallet, 2)}</span></td>
                <td className="px-3 py-2">{b.lat != null ? <a href={map(b.lat, b.lng)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 text-brand hover:underline"><MapPin className="size-3.5" />{t('live.open_map')}</a> : '—'}
                  {b.loc_age != null && <div className="text-xs text-zinc-500">{t('live.min_ago', { n: b.loc_age })}</div>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ======================================================================== 3.7 the live report
export function LiveReport() {
  const { t } = useI18n();
  const nav = useNavigate();
  const run = useAction();
  const [params, setParams] = useSearchParams();
  const query = Object.fromEntries(params);
  const [d, setD] = useState<any>(null);
  const [term, setTerm] = useState(query.search ?? '');
  useEffect(() => { setD(null); get('/live/report', query).then(setD).catch(() => setD({ rows: [], stats: {} })); }, [params.toString()]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: string, v: string | null) => { const n = new URLSearchParams(params); v ? n.set(k, v) : n.delete(k); setParams(n, { replace: true }); };
  const today = new Intl.DateTimeFormat('en-CA').format(new Date());
  const s = d?.stats ?? {};
  return (
    <>
      <PageHeader title={t('live.report')} back="/admin/live" actions={<Button icon={<Download className="size-4" />} onClick={() => run(() => download('/live/report/export', query))}>{t('live.export')}</Button>} />
      <Card className="mb-4"><div className="flex flex-wrap items-end gap-2">
        <Field label={t('live.day')}><input type="date" className="input" max={today} value={query.day ?? d?.day ?? ''} onChange={(e) => set('day', e.target.value || null)} /></Field>
        <Field label={t('live.min_stop')}><select className="input" value={query.min_stop ?? d?.min_stop ?? ''} onChange={(e) => set('min_stop', e.target.value)}>{[20, 30, 40, 50, 60, 90, 120].map((n) => <option key={n} value={n}>{n}</option>)}</select></Field>
        <Field label={t('live.sort')}><select className="input" value={query.sort ?? 'standing'} onChange={(e) => set('sort', e.target.value)}>{['standing', 'weakest', 'late', 'least_worked', 'idle'].map((k) => <option key={k} value={k}>{t(`live.sort.${k}`)}</option>)}</select></Field>
        <Field label={t('live.idle')}><select className="input" value={query.idle ?? ''} onChange={(e) => set('idle', e.target.value || null)}><option value="">{t('live.any')}</option>{[30, 60, 90, 120, 180, 240].map((n) => <option key={n} value={n}>≥ {n}</option>)}</select></Field>
        <label className="flex h-10 items-center gap-2 text-sm"><input type="checkbox" checked={!!query.standing_only} onChange={(e) => set('standing_only', e.target.checked ? '1' : null)} />{t('live.standing_only')}</label>
        <input type="search" className="input w-56" placeholder={t('live.search')} value={term} onChange={(e) => { setTerm(e.target.value); set('search', e.target.value || null); }} />
      </div></Card>
      <StatGrid>
        <StatCard label={t('live.r.riders')} value={fmtNum(s.riders)} /><StatCard label={t('live.r.over', { n: d?.min_stop ?? '' })} value={fmtNum(s.over)} tone={s.over ? 'amber' : 'none'} />
        <StatCard label={t('live.r.high')} value={fmtNum(s.high)} tone={s.high ? 'red' : 'none'} /><StatCard label={t('live.r.idle')} value={fmtNum(s.idle)} sub={dur(s.idle_min)} />
        <StatCard label={t('live.r.total')} value={dur(s.total)} /><StatCard label={t('live.r.completed')} value={fmtNum(s.completed)} tone="green" />
      </StatGrid>
      {!d ? <Loading /> : (
        <div className="overflow-x-auto rounded-xl border border-zinc-200/80 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50/80 text-xs text-zinc-500 dark:bg-zinc-800/30"><tr>{['rider', 'level', 'stops', 'total', 'longest', 'idle', 'worked', 'late', 'breaks', 'deliveries', 'per_hour', 'attendance'].map((k) => <th key={k} className="px-3 py-2 text-start font-medium">{t(`live.rc.${k}`)}</th>)}</tr></thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {d.rows.length === 0 && <tr><td colSpan={12} className="p-10 text-center text-zinc-500">{t('table.no_records')}</td></tr>}
              {d.rows.map((r: any) => (
                <tr key={r.rider_id} onClick={() => nav(`/admin/live/riders/${r.rider_id}?day=${d.day}`)} className="cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                  <td className="px-3 py-2"><div className="font-medium">{r.name ?? '—'}</div><div className="text-xs text-zinc-500"><span className="num">#{r.rider_id}</span> · {r.known ? <Link onClick={(e) => e.stopPropagation()} className="text-brand" to={`/admin/riders/${r.rider_id}`}>{t('live.rider_file')}</Link> : t('live.not_in_system')}</div></td>
                  <td className="px-3 py-2"><Badge tone={LEVEL_TONE[r.level]}>{t(`live.lvl.${r.level}`)}</Badge>{r.standing_now && <div className="text-xs text-red-600">{t('live.standing_now')}</div>}</td>
                  <td className="px-3 py-2 num">{r.stops}</td><td className="px-3 py-2 num">{dur(r.total)}</td><td className="px-3 py-2 num">{dur(r.longest)}</td>
                  <td className="px-3 py-2 num">{dur(r.idle_min)} <span className="text-xs text-zinc-500">({r.idle_n})</span></td>
                  <td className="px-3 py-2 num">{dur(r.worked_min)}</td><td className="px-3 py-2 num">{r.late_min ? <span className="text-red-600">{dur(r.late_min)}</span> : '—'}</td>
                  <td className="px-3 py-2 num">{r.breaks ?? 0} · {dur(r.break_min)}</td>
                  <td className="px-3 py-2 num">{r.completed ?? 0}{r.cancelled ? <span className="text-xs text-red-500"> / {r.cancelled}</span> : null}</td>
                  <td className="px-3 py-2 num"><span className={cx(r.per_hour != null && r.per_hour < 1 && 'font-semibold text-red-600')}>{r.per_hour == null ? '—' : fmtNum(r.per_hour, 1)}</span></td>
                  <td className="px-3 py-2 num">{r.attendance == null ? '—' : `${Math.floor(r.attendance * 1000) / 10}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ======================================================================== 3.8 a rider's day
export function RiderDay() {
  const { id } = useParams();
  const { t, dir } = useI18n();
  const run = useAction();
  const [params, setParams] = useSearchParams();
  const [d, setD] = useState<any>(null);
  useEffect(() => { setD(null); get(`/live/riders/${id}`, Object.fromEntries(params)).then(setD).catch(() => setD({ error: true })); }, [id, params.toString()]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return <Loading />;
  if (d.error) return <Alert tone="amber">{t('err.server_error')}</Alert>;
  const today = new Intl.DateTimeFormat('en-CA').format(new Date());
  const Prev = dir === 'rtl' ? ChevronRight : ChevronLeft; const Next = dir === 'rtl' ? ChevronLeft : ChevronRight;
  const L = d.live ?? {};
  const long = d.stops.filter((s: any) => s.minutes >= d.min_stop);
  const span = d.first && d.last ? Date.parse(d.last.replace(' ', 'T')) - Date.parse(d.first.replace(' ', 'T')) || 1 : 1;
  // a rough sketch of the route: points scaled into a box
  const pts = d.route as any[];
  const [minLat, maxLat, minLng, maxLng] = pts.length ? [Math.min(...pts.map((p) => p.lat)), Math.max(...pts.map((p) => p.lat)), Math.min(...pts.map((p) => p.lng)), Math.max(...pts.map((p) => p.lng))] : [0, 1, 0, 1];
  const X = (lng: number) => 10 + ((lng - minLng) / (maxLng - minLng || 1)) * 580; const Y = (lat: number) => 10 + ((maxLat - lat) / (maxLat - minLat || 1)) * 280;
  const routeLink = pts.length ? `https://www.google.com/maps/dir/${pts.filter((_, i) => i % Math.ceil(pts.length / 20) === 0).map((p) => `${p.lat},${p.lng}`).join('/')}` : null;
  return (
    <>
      <PageHeader title={d.rider.full_name ?? d.rider.name ?? `#${id}`} back="/admin/live" subtitle={<span className="flex items-center gap-2"><StatusBadge s={d.rider.status} />{d.rider.phone && <span className="num">{d.rider.phone}</span>}</span>} actions={<>
        <Link to={`/admin/live/report?day=${d.day}`}><Button>{t('live.report')}</Button></Link>
        {d.rider.known && <Link to={`/admin/riders/${id}`}><Button>{t('live.rider_file')}</Button></Link>}
      </>} />
      <Card className="mb-4"><div className="flex flex-wrap items-center gap-2">
        <Button size="sm" icon={<Prev className="size-4" />} onClick={() => setParams({ day: d.prev })}>{t('live.prev_day')}</Button>
        <input type="date" className="input w-44" max={today} value={d.day} onChange={(e) => setParams({ day: e.target.value })} />
        <Button size="sm" disabled={d.next > today} onClick={() => setParams({ day: d.next })}>{t('live.next_day')}<Next className="size-4" /></Button>
      </div></Card>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label={t('live.col.worked')} value={dur(L.worked_min)} /><StatCard label={t('live.col.late')} value={dur(L.late_min)} tone={L.late_min ? 'red' : 'none'} />
        <StatCard label={t('live.col.breaks')} value={fmtNum(L.breaks ?? 0)} sub={dur(L.break_min)} /><StatCard label={t('live.stops_over')} value={fmtNum(long.length)} sub={dur(long.reduce((a: number, s: any) => a + s.minutes, 0))} tone={long.length ? 'amber' : 'none'} />
        <StatCard label={t('live.col.deliveries')} value={fmtNum(L.completed ?? 0)} sub={L.worked_min >= 15 ? `${fmtNum((L.completed ?? 0) / (L.worked_min / 60), 1)} / ${t('live.hour')}` : undefined} />
        <StatCard label={t('live.points')} value={fmtNum(d.points)} sub={d.first && <span className="num">{fmtDateTime(d.first).slice(11)} → {fmtDateTime(d.last).slice(11)}</span>} />
      </div>
      {d.performance && <div className="mb-4"><Alert tone="blue">{t('live.perf_line', { att: d.performance.attendance_rate == null ? '—' : `${Math.floor(d.performance.attendance_rate * 1000) / 10}%`, acc: d.performance.acceptance_rate == null ? '—' : `${Math.floor(d.performance.acceptance_rate * 1000) / 10}%`, done: d.performance.completed ?? '—', lost: d.performance.lost_hours ?? '—' })}</Alert></div>}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t('live.where_stood')} pad={false}>
          {!d.stops.length ? <p className="p-4 text-sm text-zinc-500">{t('table.no_records')}</p> : <table className="w-full text-sm"><thead className="bg-zinc-50/80 text-xs text-zinc-500 dark:bg-zinc-800/30"><tr>{['from', 'to', 'duration', 'doing', 'order', 'location'].map((k) => <th key={k} className="px-3 py-2 text-start font-medium">{t(`live.st_col.${k}`)}</th>)}</tr></thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">{d.stops.map((s: any, i: number) => {
              const total = Object.values(s.statuses as Record<string, number>).reduce((a, b) => a + b, 0);
              return (<tr key={i}><td className="px-3 py-2 num text-xs">{fmtDateTime(s.from).slice(11)}</td><td className="px-3 py-2 num text-xs">{s.open ? t('live.still_there') : fmtDateTime(s.to).slice(11)}</td>
                <td className={cx('px-3 py-2 num', s.minutes >= d.min_stop && 'font-semibold text-red-600')}>{dur(s.minutes)}</td>
                <td className="px-3 py-2"><div className="flex h-2.5 w-28 overflow-hidden rounded-full">{Object.entries(s.statuses as Record<string, number>).map(([k, n]) => <div key={k} title={`${t(`live.s.${k}`)}: ${Math.round((n / total) * 100)}%`} className={STATUS_BG[k] ?? 'bg-zinc-300'} style={{ width: `${(n / total) * 100}%` }} />)}</div></td>
                <td className="px-3 py-2"><Badge tone={s.with_order ? 'green' : 'amber'}>{s.with_order ? t('live.with_order') : t('live.no_order')}</Badge></td>
                <td className="px-3 py-2"><a className="text-brand hover:underline" href={map(s.lat, s.lng)} target="_blank" rel="noreferrer">{t('live.open_map')}</a></td></tr>);
            })}</tbody></table>}
        </Card>
        <Card title={t('live.statuses_day')}>
          {!d.timeline.length ? <p className="text-sm text-zinc-500">{t('table.no_records')}</p> : <>
            <div className="flex h-5 overflow-hidden rounded-full" dir="ltr">{d.timeline.map((x: any, i: number) => {
              const w = Math.max(0.5, ((Date.parse(x.to.replace(' ', 'T')) - Date.parse(x.from.replace(' ', 'T')) + 60000) / span) * 100);
              return <div key={i} className={STATUS_BG[x.status] ?? 'bg-zinc-300'} style={{ width: `${w}%` }} title={`${t(`live.s.${x.status}`)} ${fmtDateTime(x.from).slice(11)}–${fmtDateTime(x.to).slice(11)}`} />;
            })}</div>
            <div className="mt-2 flex flex-wrap gap-3 text-xs">{Object.keys(STATUS_TONE).slice(0, 5).map((k) => <span key={k} className="flex items-center gap-1"><span className={cx('size-2.5 rounded-sm', STATUS_BG[k])} />{t(`live.s.${k}`)}</span>)}</div>
          </>}
        </Card>
        <Card title={t('live.route')} className="lg:col-span-2" actions={<>
          {routeLink && <a href={routeLink} target="_blank" rel="noreferrer"><Button size="sm">{t('live.route_maps')}</Button></a>}
          <Button size="sm" icon={<Download className="size-3.5" />} onClick={() => run(() => download(`/live/riders/${id}/points.csv`, { day: d.day }))}>{t('live.all_points')}</Button></>}>
          {pts.length < 2 ? <p className="text-sm text-zinc-500">{t('live.not_enough')}</p> : (
            <svg viewBox="0 0 600 300" className="h-auto max-h-80 w-full rounded-lg bg-zinc-50 dark:bg-zinc-950">
              <polyline points={pts.map((p) => `${X(p.lng)},${Y(p.lat)}`).join(' ')} fill="none" stroke="var(--brand)" strokeWidth="2" strokeOpacity=".6" />
              {d.stops.map((s: any, i: number) => <a key={i} href={map(s.lat, s.lng)} target="_blank" rel="noreferrer"><circle cx={X(s.lng)} cy={Y(s.lat)} r={Math.min(18, 4 + s.minutes / 10)} className={s.minutes >= d.min_stop ? 'fill-red-500/50' : 'fill-amber-400/50'}><title>{dur(s.minutes)}</title></circle></a>)}
              <circle cx={X(pts[0].lng)} cy={Y(pts[0].lat)} r="6" className="fill-emerald-500" /><circle cx={X(pts[pts.length - 1].lng)} cy={Y(pts[pts.length - 1].lat)} r="6" className="fill-zinc-800 dark:fill-zinc-200" />
            </svg>
          )}
        </Card>
      </div>
    </>
  );
}
