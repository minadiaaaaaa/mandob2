// The top of the dashboard (phase 8): company health and profile, the four company cards, then the employees,
// vehicles and finance sections. The numbers come from the server (domain/health.ts).
import { Link } from 'react-router-dom';
import { Activity, Building2, CalendarClock, GitBranch, IdCard, ShieldCheck } from 'lucide-react';
import { fmtDate, fmtMoney, fmtNum, useI18n } from '../i18n';
import { Card, cx } from '../ui/kit';

type Tone = 'green' | 'amber' | 'red' | 'blue' | 'grey';
const TONE: Record<Tone, string> = {
  green: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300',
  amber: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300',
  red: 'border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300',
  blue: 'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300',
  grey: 'border-zinc-200 bg-white text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200',
};
function Tile({ label, value, sub, tone = 'grey', to, icon }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: Tone; to?: string; icon?: React.ReactNode }) {
  const body = <div className={cx('h-full rounded-lg border p-3', TONE[tone], to && 'transition hover:shadow-sm')}>
    <div className="flex items-center gap-1.5 text-xs font-medium opacity-80">{icon}{label}</div>
    <div className="num mt-1 text-xl font-semibold">{value}</div>{sub && <div className="mt-0.5 text-xs opacity-75">{sub}</div>}</div>;
  return to ? <Link to={to} className="block">{body}</Link> : body;
}
const riskTone = (n: number): Tone => (n >= 50 ? 'red' : n >= 20 ? 'amber' : 'green');

export function CompanyOverview({ c, f }: { c: any; f: any }) {
  const { t } = useI18n();
  if (!c) return null;
  const h = c.health;
  const ring = h.percent >= 80 ? 'text-emerald-600' : h.percent >= 60 ? 'text-amber-500' : 'text-red-600';
  return (
    <div className="mb-6 space-y-4">
      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        <div className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900 md:col-span-1 xl:col-span-2">
          <div className="flex items-center gap-3">
            <svg viewBox="0 0 36 36" className={cx('size-16 shrink-0 -rotate-90', ring)} aria-hidden><circle cx="18" cy="18" r="15.9" fill="none" stroke="currentColor" strokeOpacity=".15" strokeWidth="3.5" />
              <circle cx="18" cy="18" r="15.9" fill="none" stroke="currentColor" strokeWidth="3.5" strokeDasharray={`${h.percent} 100`} strokeLinecap="round" /></svg>
            <div><div className="flex items-center gap-1 text-xs font-medium text-zinc-500"><Activity className="size-3.5" />{t('health.title')}</div>
              <div className="num text-2xl font-semibold">{h.percent}%</div><div className={cx('text-xs font-medium', ring)}>{t(`health.l.${h.label}`)}</div></div>
          </div>
        </div>
        <Tile label={t('health.profile')} value={`${c.profile.percent}%`} sub={t('health.profile_sub')} tone={c.profile.percent >= 80 ? 'green' : 'amber'} to="/admin/settings" icon={<Building2 className="size-3.5" />} />
        <Tile label={t('health.admins')} value={fmtNum(c.cards.admins)} sub={t('health.admins_sub')} to="/admin/users" icon={<ShieldCheck className="size-3.5" />} />
        <Tile label={t('health.days_left')} value={c.cards.days_left == null ? '—' : fmtNum(c.cards.days_left)} sub={t('health.days_left_sub')} tone={c.cards.days_left != null && c.cards.days_left <= 7 ? 'amber' : 'grey'} to="/admin/billing" icon={<CalendarClock className="size-3.5" />} />
        <Tile label={t('health.branches')} value={fmtNum(c.cards.branches)} sub={t('health.designations', { n: c.cards.designations })} to="/admin/branches" icon={<GitBranch className="size-3.5" />} />
      </div>
      <details className="rounded-lg border border-zinc-200 bg-white p-3 text-sm dark:border-zinc-800 dark:bg-zinc-900">
        <summary className="cursor-pointer text-xs font-medium text-zinc-500">{t('health.profile_parts')}</summary>
        <div className="mt-2 grid gap-2 sm:grid-cols-5">{Object.entries(c.profile.sections).map(([k, s]: any) => <div key={k}>
          <div className="flex justify-between text-xs"><span>{t(`health.p.${k}`)}</span><span className="num">{s.score}/{s.weight}</span></div>
          <div className="mt-1 h-1.5 rounded bg-zinc-100 dark:bg-zinc-800"><div className="h-1.5 rounded bg-brand" style={{ width: `${(s.score / s.weight) * 100}%` }} /></div></div>)}</div>
      </details>

      <Card title={t('health.employees')} subtitle={t('health.employees_sub')}>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Tile label={t('health.w.working')} value={fmtNum(c.riders.working)} tone="green" to="/admin/riders?status=active" />
          <Tile label={t('health.w.ready')} value={fmtNum(c.riders.ready)} tone="blue" to="/admin/riders?status=active" />
          <Tile label={t('health.w.waiting')} value={fmtNum(c.riders.waiting)} tone="amber" to="/admin/riders?status=inactive" />
          <Tile label={t('health.w.on_leave')} value={fmtNum(c.riders.on_leave)} tone="grey" to="/admin/leaves" />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Tile label={t('health.missing_papers')} value={fmtNum(c.riders.missing_papers)} tone={c.riders.missing_papers ? 'amber' : 'green'} to="/admin/riders/papers" icon={<IdCard className="size-3.5" />} />
          <Tile label={t('health.soon')} value={fmtNum(c.riders.soon)} tone={c.riders.soon ? 'amber' : 'grey'} to="/admin/renewals" />
          <Tile label={t('health.expired')} value={fmtNum(c.riders.expired)} tone={c.riders.expired ? 'red' : 'grey'} to="/admin/renewals" />
          <Tile label={t('health.risk')} value={`${c.riders.risk}`} sub={t('health.risk_sub')} tone={riskTone(c.riders.risk)} />
        </div>
        {!!c.riders.next.length && <Next rows={c.riders.next} />}
      </Card>

      <Card title={t('health.vehicles')} subtitle={t('health.vehicles_sub')}>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Tile label={t('health.v.working')} value={fmtNum(c.vehicles.working)} tone="green" to="/admin/vehicles" />
          <Tile label={t('health.v.servicing')} value={fmtNum(c.vehicles.servicing)} tone="amber" to="/admin/vehicle-services?status=in_progress" />
          <Tile label={t('health.v.reserved')} value={fmtNum(c.vehicles.reserved)} tone="blue" to="/admin/vehicles" />
          <Tile label={t('health.v.unavailable')} value={fmtNum(c.vehicles.unavailable)} tone="grey" to="/admin/vehicles?status=retired" />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-5">
          <Tile label={t('health.invalid_auth')} value={fmtNum(c.vehicles.invalid_authorization)} tone={c.vehicles.invalid_authorization ? 'red' : 'grey'} to="/admin/operation-cards" />
          <Tile label={t('health.soon')} value={fmtNum(c.vehicles.soon)} tone={c.vehicles.soon ? 'amber' : 'grey'} to="/admin/renewals" />
          <Tile label={t('health.expired')} value={fmtNum(c.vehicles.expired)} tone={c.vehicles.expired ? 'red' : 'grey'} to="/admin/renewals" />
          <Tile label={t('health.oil_due')} value={fmtNum(c.vehicles.oil_due)} sub={t('health.oil_due_sub', { n: c.vehicles.oil_days })} tone={c.vehicles.oil_due ? 'amber' : 'grey'} to="/admin/oil-changes" />
          <Tile label={t('health.risk')} value={`${c.vehicles.risk}`} sub={t('health.risk_sub')} tone={riskTone(c.vehicles.risk)} />
        </div>
        {!!c.vehicles.next.length && <Next rows={c.vehicles.next} />}
      </Card>

      {f && <Card title={t('health.finance')} subtitle={t('health.finance_sub')}>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Tile label={t('fin2.balance')} value={fmtMoney(f.balance)} tone={f.balance < 0 ? 'red' : 'green'} sub={t('fin2.balance_sub', { n: f.accounts })} to="/admin/company-finance?tab=accounts" />
          <Tile label={t('fin2.month_net')} value={fmtMoney(f.flow.net)} tone={f.flow.net < 0 ? 'red' : 'grey'} sub={`${t('fin2.in')} ${fmtMoney(f.flow.inflow)} · ${t('fin2.out')} ${fmtMoney(f.flow.outflow)}`} to="/admin/company-finance?tab=entries" />
          <Tile label={t('fin2.overdue')} value={fmtMoney(f.dues.overdue)} tone={f.dues.overdue_count ? 'red' : 'grey'} sub={t('fin2.n_items', { n: f.dues.overdue_count })} to="/admin/company-finance?tab=obligations" />
          <Tile label={t('health.pending_employee')} value={fmtMoney(f.pending_employee.amount)} tone={f.pending_employee.n ? 'amber' : 'grey'} sub={t('fin2.n_items', { n: f.pending_employee.n })} to="/admin/advances" />
        </div>
        <div className="mt-3 text-sm"><div className="mb-1 text-xs font-medium text-zinc-500">{t('fin2.upcoming')}</div>
          {!f.upcoming.length ? <p className="text-zinc-500">{t('dash.no_data')}</p> : <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">{f.upcoming.map((u: any) => <li key={u.id} className="flex justify-between py-1">
            <span>{u.title}</span><span className="num">{fmtDate(u.due_date)} · {fmtMoney(u.amount)}</span></li>)}</ul>}</div>
      </Card>}
    </div>
  );
}

function Next({ rows }: { rows: any[] }) {
  const { t } = useI18n();
  return <div className="mt-3 text-sm"><div className="mb-1 text-xs font-medium text-zinc-500">{t('health.next_expiries')}</div>
    <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">{rows.map((r, i) => <li key={i} className="flex flex-wrap justify-between gap-2 py-1">
      <span className="truncate">{r.owner} · {t(`alerts.kind.${r.kind}`)}</span><span className={cx('num text-xs', r.d <= 7 ? 'text-red-600' : r.d <= 15 ? 'text-amber-600' : 'text-zinc-500')}>{t('health.in_days', { n: r.d })} · {fmtDate(r.expiry_date)}</span></li>)}</ul></div>;
}
