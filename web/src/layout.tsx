import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Activity, BarChart3, BellRing, Building, CalendarDays, Car, ChevronDown, Globe, KeyRound, LayoutDashboard, LogOut, Menu, Moon, Settings, Sun, User, Users, Wallet, X,
} from 'lucide-react';
import { get, patch, post } from './api';
import { useAuth } from './auth';
import { useI18n } from './i18n';
import { cx } from './ui/kit';
import { NotificationBell } from './ui/bell';
import { SyncButton } from './pages/performance/Sync';

type Item = { to: string; label: string; perm: string[]; icon?: ReactNode; badge?: string[]; end?: boolean };
type Section = { key: string; label: string; icon: ReactNode; items: Item[] };
type Badges = Record<string, { expired: number; soon: number }>;
const ALL_BADGES = ['id', 'license', 'health', 'driver_card', 'ajeer', 'operation_cards', 'vehicle_registrations', 'insurance_policies', 'vehicle_insurance', 'transport_licenses', 'oil_changes'];

// Main tabs, each with its pages underneath (one tab open at a time). Pages without permission do not appear,
// a main tab with no visible page is hidden, and a main tab with a single page is a direct link.
function useSections(): Section[] {
  const { t } = useI18n();
  const i = (to: string, label: string, perm: string | string[], badge?: string[], end?: boolean): Item =>
    ({ to, label: t(label), perm: Array.isArray(perm) ? perm : [perm], badge, end });
  return [
    { key: 'main', label: t('nav.dashboard'), icon: <LayoutDashboard />, items: [i('/admin', 'nav.dashboard', 'dashboard.view', undefined, true)] },
    // the platform owner's own pages (only on the owner's account, see OWNER_ONLY)
    { key: 'platform', label: t('nav.platform'), icon: <Building />, items: [
      i('/admin/platform', 'platform.tab.overview', 'dashboard.view', undefined, true),
      i('/admin/platform/companies', 'platform.tab.companies', 'dashboard.view'),
      i('/admin/platform/plans', 'platform.tab.plans', 'dashboard.view'),
      i('/admin/platform/payments', 'platform.tab.payments', 'dashboard.view'),
    ] },
    { key: 'riders', label: t('nav.riders'), icon: <Users />, items: [
      i('/admin/riders', 'nav.rider_list', 'riders.view', undefined, true),
      i('/admin/rider-applicants', 'nav.applicants', 'applicants.view'),
      i('/admin/riders/papers', 'nav.rider_papers', 'riders.view'),
      i('/admin/riders/exited', 'nav.exited', 'riders.view'),
      i('/admin/platform-ids', 'nav.platform_ids', 'platform_ids.view'),
      i('/admin/riders/id-documents', 'docs.id', 'id_documents.view', ['id']),
      i('/admin/riders/driving-licenses', 'docs.license', 'driving_licenses.view', ['license']),
      i('/admin/riders/health-certificates', 'docs.health', 'health_certs.view', ['health']),
      i('/admin/riders/driver-cards', 'docs.driver_card', 'driver_cards.view', ['driver_card']),
      i('/admin/riders/ajeer-permits', 'docs.ajeer', 'ajeer_permits.view', ['ajeer']),
      i('/admin/rider-change-requests', 'nav.change_requests', 'rider_portal.view_requests'),
      i('/admin/rider-issues', 'nav.issues', 'rider_portal.view_issues', ['issues']),
    ] },
    { key: 'attendance', label: t('nav.attendance'), icon: <CalendarDays />, items: [
      i('/admin/leaves', 'nav.leaves', 'leaves.view'),
      i('/admin/absences', 'nav.absences', 'absences.view'),
      i('/admin/live', 'nav.live', 'live_riders.view', undefined, true),
      i('/admin/live/report', 'nav.live_report', 'live_riders.view'),
    ] },
    { key: 'fleet', label: t('nav.fleet'), icon: <Car />, items: [
      i('/admin/vehicles', 'nav.vehicles', 'vehicles.view'),
      i('/admin/vehicle-assignments', 'nav.vehicle_assignments', 'vehicle_assignments.view'),
      i('/admin/operation-cards', 'nav.operation_cards', 'operation_cards.view', ['operation_cards']),
      i('/admin/vehicle-registrations', 'nav.vehicle_registrations', 'vehicle_registrations.view', ['vehicle_registrations']),
      i('/admin/insurance/companies', 'nav.insurance_companies', 'insurance_companies.view'),
      i('/admin/insurance/policies', 'nav.insurance_policies', 'insurance_policies.view', ['insurance_policies']),
      i('/admin/insurance/vehicles', 'nav.vehicle_insurance', 'vehicle_insurance.view', ['vehicle_insurance']),
      i('/admin/fuel-cards', 'nav.fuel_cards', 'fuel_cards.view'),
      i('/admin/oil-changes', 'nav.oil_changes', 'oil_changes.view', ['oil_changes']),
      i('/admin/vehicle-services', 'nav.vehicle_services', 'vehicle_services.view'),
      i('/admin/vehicle-accidents', 'nav.vehicle_accidents', 'vehicle_accidents.view'),
      i('/admin/vehicle-papers', 'nav.vehicle_papers', 'vehicles.view'),
      i('/admin/transport-licenses', 'nav.transport_licenses', 'transport_licenses.view', ['transport_licenses']),
    ] },
    { key: 'docs', label: t('nav.documents_renewals'), icon: <BellRing />, items: [
      i('/admin/alerts', 'nav.alerts', 'alerts.view', ALL_BADGES),
      i('/admin/renewals', 'nav.renewals', 'renewals.view'),
    ] },
    { key: 'performance', label: t('nav.performance'), icon: <Activity />, items: [
      i('/admin/performance', 'nav.daily_performance', 'performance.view'),
      i('/admin/branding', 'nav.branding', 'performance.view'),
      i('/admin/rider-ratings', 'nav.ratings', 'ratings.view'),
      i('/admin/sync', 'nav.sync', 'sync.view'),
      i('/admin/companies', 'nav.companies', 'companies.view'),
      i('/admin/contracts', 'nav.contracts', 'contracts.view'),
    ] },
    { key: 'finance', label: t('nav.finance'), icon: <Wallet />, items: [
      i('/admin/advances', 'nav.advances', 'advances.view'),
      i('/admin/finance/fines', 'nav.fines', 'finance.view'),
      i('/admin/finance/wallet', 'nav.wallet', 'finance.view'),
      i('/admin/finance/billing', 'nav.billing', 'finance.view'),
    ] },
    { key: 'reports', label: t('nav.reports_notifications'), icon: <BarChart3 />, items: [
      i('/admin/reports', 'nav.reports', 'reports.view'),
      i('/admin/notifications', 'nav.notifications', 'notifications.view', undefined, true),
      i('/admin/notifications/preferences', 'nav.notification_prefs', 'notification_prefs.view'),
    ] },
    { key: 'admin', label: t('nav.administration'), icon: <KeyRound />, items: [
      i('/admin/users', 'nav.users', 'users.view'),
      i('/admin/roles', 'nav.roles', ['roles.view', 'permissions.view']),
      i('/admin/sessions', 'nav.sessions', 'sessions.view'),
      i('/admin/blocked-ips', 'nav.blocked_ips', 'blocked_ips.view'),
    ] },
    { key: 'system', label: t('nav.system'), icon: <Settings />, items: [
      i('/admin/settings', 'nav.settings', ['system_settings.view', 'platform_settings.view', 'secrets.view'], undefined, true),
      i('/admin/settings/organization', 'nav.organization', 'organization.view'),
      i('/admin/branches', 'nav.branches', 'branches.view'),
      i('/admin/designations', 'nav.designations', 'designations.view'),
      i('/admin/attachments', 'nav.attachments', 'attachments.view'),
      i('/admin/email/templates', 'nav.email_templates', ['email_templates.view', 'smtp.view']),
      i('/admin/email/log', 'nav.email_log', 'email_log.view'),
      i('/admin/logs/audit', 'nav.activity_log', ['audit_log.view', 'logs.view']),
      i('/admin/logs/login', 'nav.login_attempts', 'login_log.view'),
      i('/admin/logs/errors', 'nav.system_errors', 'logs.view'),
      i('/admin/cron-jobs', 'nav.cron_jobs', 'cron_jobs.view'),
      i('/admin/billing', 'nav.billing_plan', 'subscription.view'),
      i('/admin/backups', 'nav.backups', 'backups.view'),
      i('/admin/languages', 'nav.languages', 'languages.view'),
    ] },
  ];
}

function NavBadge({ keys, badges }: { keys?: string[]; badges: Badges }) {
  const { t } = useI18n();
  if (!keys) return null;
  const expired = keys.reduce((s, k) => s + (badges[k]?.expired ?? 0), 0);
  const soon = keys.reduce((s, k) => s + (badges[k]?.soon ?? 0), 0);
  if (!expired && !soon) return null;
  const n = expired || soon;
  return (
    <span title={keys.length === 1 && keys[0] === 'issues' ? t('nav.unread_conversations', { n: expired }) : t('nav.badge_title', { expired, soon })}
      className={cx('ms-auto rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none num', expired ? 'bg-red-600 text-white' : 'bg-amber-400 text-amber-950')}>
      {n > 99 ? '99+' : n}
    </span>
  );
}

// Pages about the whole platform appear only on the owner's account; a company's own subscription page only on companies.
// the owner's pages are /admin/platform and below it (not every path that starts with those letters, e.g. /admin/platform-ids)
const OWNER_ONLY = (to: string) => to === '/admin/platform' || to.startsWith('/admin/platform/') ||['/admin/backups', '/admin/blocked-ips', '/admin/languages'].includes(to);
const COMPANY_ONLY = (to: string) => to === '/admin/billing';

// The main tab a path belongs to: the longest matching page, so /admin/live/report is not counted as /admin/live.
const owns = (it: Item, path: string) => path === it.to || path === it.to + '/' || (!it.end && path.startsWith(it.to + '/'));
function activeSection(sections: Section[], path: string) {
  let best: { key: string; len: number } | null = null;
  for (const s of sections) for (const it of s.items) if (owns(it, path) && (!best || it.to.length > best.len)) best = { key: s.key, len: it.to.length };
  if (!best) for (const s of sections) for (const it of s.items) if (path.startsWith(it.to + '/') && (!best || it.to.length > best.len)) best = { key: s.key, len: it.to.length };
  return best?.key ?? null;
}

function Sidebar({ collapsed, onNavigate, onExpand, badges }: { collapsed: boolean; onNavigate: () => void; onExpand: () => void; badges: Badges }) {
  const { can, org, me } = useAuth();
  const owner = !!me?.platform_owner;
  const sections = useSections().map((s) => ({ ...s, items: s.items.filter((it) => can(...it.perm) && (owner ? !COMPANY_ONLY(it.to) : !OWNER_ONLY(it.to))) })).filter((s) => s.items.length);
  const loc = useLocation();
  const nav = useNavigate();
  const current = activeSection(sections, loc.pathname);
  // one main tab open at a time; moving to a page elsewhere opens that page's tab
  const [open, setOpen] = useState<string | null>(current);
  useEffect(() => { if (current) setOpen(current); }, [current]);
  const tabCls = (active: boolean) => cx('flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition [&_svg]:size-[18px] [&_svg]:shrink-0',
    active ? 'font-semibold text-zinc-900 dark:text-white [&_svg]:text-brand' : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-white [&_svg]:text-zinc-400');
  const linkCls = ({ isActive }: { isActive: boolean }) => cx('relative flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] transition',
    isActive ? 'bg-brand/[.08] font-medium text-brand before:absolute before:inset-y-1.5 before:-start-[9px] before:w-[2px] before:rounded-full before:bg-brand dark:bg-brand/15 dark:text-emerald-300'
      : 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-white');
  return (
    <nav className="scroll-thin flex h-full flex-col overflow-y-auto border-e border-zinc-200 bg-white px-2 py-3 text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100">
      <Link to="/admin" onClick={onNavigate} className="mb-3 flex items-center gap-2.5 border-b border-zinc-100 px-2 pb-3 dark:border-zinc-800">
        {org?.logos?.logo ? <img src="/api/public/logo/logo" alt="" className="h-8 w-8 rounded bg-white object-contain p-0.5" />
          : <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-brand font-bold text-white">{(org?.['org.name'] || 'L')[0]}</span>}
        {!collapsed && <span className="truncate text-sm font-semibold">{org?.['org.name'] || org?.['platform.name']}</span>}
      </Link>
      <div className="space-y-0.5">
        {sections.map((s) => {
          const badge = [...new Set(s.items.flatMap((x) => x.badge ?? []))];
          const isCurrent = current === s.key;
          if (s.items.length === 1) {
            const it = s.items[0];
            return (
              <NavLink key={s.key} to={it.to} end={it.end} onClick={onNavigate} title={collapsed ? s.label : undefined}
                className={({ isActive }) => cx(tabCls(isActive), isActive && 'bg-brand/[.08] !text-brand dark:!text-emerald-300')}>
                {s.icon}{!collapsed && <><span className="truncate">{s.label}</span><NavBadge keys={badge} badges={badges} /></>}
              </NavLink>
            );
          }
          const expanded = open === s.key && !collapsed;
          return (
            <div key={s.key}>
              <button type="button" aria-expanded={expanded} title={collapsed ? s.label : undefined} className={tabCls(isCurrent)}
                onClick={() => {
                  // icon-only sidebar: widen it and show this tab's pages
                  if (collapsed) { onExpand(); setOpen(s.key); if (!isCurrent) nav(s.items[0].to); return; }
                  setOpen(expanded ? null : s.key);
                }}>
                {s.icon}
                {!collapsed && <>
                  <span className="truncate">{s.label}</span>
                  <span className="ms-auto flex items-center gap-1.5">
                    {!expanded && <NavBadge keys={badge} badges={badges} />}
                    <ChevronDown className={cx('!size-3.5 opacity-60 transition-transform', expanded && 'rotate-180')} />
                  </span>
                </>}
              </button>
              {expanded && (
                <div className="mb-1 ms-[1.3rem] mt-0.5 space-y-0.5 border-s border-zinc-200 ps-2 dark:border-zinc-800">
                  {s.items.map((it) => (
                    <NavLink key={it.to} to={it.to} end={it.end} onClick={onNavigate} className={linkCls}>
                      <span className="truncate">{it.label}</span><NavBadge keys={it.badge} badges={badges} />
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </nav>
  );
}

export function useTheme() {
  const [dark, setDark] = useState(() => { try { return localStorage.getItem('lsp.theme') === 'dark'; } catch { return false; } });
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    try { localStorage.setItem('lsp.theme', dark ? 'dark' : 'light'); } catch { /* ignore */ }
  }, [dark]);
  return [dark, setDark] as const;
}

export function LangPicker({ compact, onPick }: { compact?: boolean; onPick?: (l: string) => void }) {
  const { lang, setLang, t, langs } = useI18n();
  const { me } = useAuth();
  return (
    <label className="inline-flex items-center gap-1.5 text-sm" title={t('top.language')}>
      <Globe className="size-4 text-zinc-500" />
      <select className={cx('cursor-pointer rounded-md bg-transparent py-1 text-sm outline-none', compact && 'max-w-24')} value={lang}
        onChange={(e) => {
          const l = e.target.value as typeof lang;
          setLang(l);
          // The choice is saved and remains after signing out.
          if (onPick) onPick(l);
          else if (me) patch('/profile', { locale: l }).catch(() => {});
        }}>
        {langs.map((l) => <option key={l.code} value={l.code}>{l.flag ? `${l.flag} ` : ''}{l.name}</option>)}
      </select>
    </label>
  );
}
export function ThemeToggle() {
  const { t } = useI18n();
  const [dark, setDark] = useTheme();
  return (
    <button onClick={() => setDark(!dark)} title={dark ? t('top.light_mode') : t('top.dark_mode')} className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">
      {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  );
}

export function AdminLayout() {
  const { t } = useI18n();
  const { me, refresh } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem('lsp.sidebar') === '1'; } catch { return false; } });
  const [mobile, setMobile] = useState(false);
  const [menu, setMenu] = useState(false);
  const [badges, setBadges] = useState<Badges>({});
  useEffect(() => { get<Badges>('/meta/badges').then(setBadges).catch(() => {}); }, [loc.pathname]);
  useEffect(() => { try { localStorage.setItem('lsp.sidebar', collapsed ? '1' : '0'); } catch { /* ignore */ } }, [collapsed]);
  const menuBox = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const h = (e: MouseEvent) => { if (!menuBox.current?.contains(e.target as Node)) setMenu(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [menu]);
  const signOut = async () => { await post('/auth/logout').catch(() => {}); await refresh(); nav('/admin/login'); };

  return (
    <div className="flex min-h-screen">
      <aside className={cx('fixed inset-y-0 start-0 z-40 transition-all lg:sticky lg:top-0 lg:h-screen', collapsed ? 'lg:w-16' : 'lg:w-64', mobile ? 'w-72' : 'hidden lg:block')}>
        <Sidebar collapsed={collapsed && !mobile} onNavigate={() => setMobile(false)} onExpand={() => setCollapsed(false)} badges={badges} />
      </aside>
      {mobile && <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setMobile(false)} />}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-zinc-200/80 bg-white/80 px-3 backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-900/80">
          <button className="rounded-lg p-2 text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
            title={window.innerWidth < 1024 ? t('top.open_menu') : t('top.collapse_sidebar')}
            onClick={() => (window.innerWidth < 1024 ? setMobile(!mobile) : setCollapsed(!collapsed))}>
            {mobile ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
          <div className="ms-auto flex items-center gap-1">
            <LangPicker />
            <ThemeToggle />
            <SyncButton />
            <NotificationBell />
            <div className="relative" ref={menuBox}>
              <button onClick={() => setMenu(!menu)} aria-expanded={menu} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800">
                <span className="flex size-7 items-center justify-center rounded-full bg-brand text-xs font-semibold text-white ring-2 ring-brand/20">{me?.full_name.slice(0, 2)}</span>
                <span className="hidden max-w-40 truncate sm:block">{me?.full_name}</span>
                <ChevronDown className="size-3.5 text-zinc-400" />
              </button>
              {menu && (
                <div className="pop-in absolute end-0 mt-1 w-56 overflow-hidden rounded-xl border border-zinc-200 bg-white py-1 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
                  <div className="border-b border-zinc-100 px-3 py-2 dark:border-zinc-800"><div className="truncate font-medium">{me?.full_name}</div><div className="truncate text-xs text-zinc-500">{me?.role}</div></div>
                  <Link to="/admin/profile" onClick={() => setMenu(false)} className="flex items-center gap-2 px-3 py-2 hover:bg-zinc-100 dark:hover:bg-zinc-800"><User className="size-4" />{t('top.profile')}</Link>
                  <button onClick={signOut} className="flex w-full items-center gap-2 px-3 py-2 text-red-600 hover:bg-zinc-100 dark:hover:bg-zinc-800"><LogOut className="size-4" />{t('top.sign_out')}</button>
                </div>
              )}
            </div>
          </div>
        </header>
        <TrialBanner />
        <main className="mx-auto w-full max-w-[1500px] flex-1 p-4 sm:p-6"><Outlet /></main>
      </div>
    </div>
  );
}


// The company's trial or subscription status, shown above every page when it needs attention.
function TrialBanner() {
  const { t } = useI18n();
  const { me, can } = useAuth();
  const c = me?.company;
  if (!c || (c.state === 'active' && c.days_left > 7)) return null;
  const tone = c.state === 'expired' || c.state === 'suspended' ? 'border-red-200 bg-red-50 text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200'
    : c.days_left <= 3 ? 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200'
    : 'border-zinc-200 bg-white text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300';
  const text = c.state === 'trial' ? t('banner.trial', { n: c.days_left }) : c.state === 'active' ? t('banner.renew_soon', { n: c.days_left })
    : c.state === 'suspended' ? t('banner.suspended') : t('banner.expired');
  return (
    <div className={cx('no-print flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b px-4 py-2 text-sm', tone)}>
      <span>{text}</span>
      {can('subscription.view') && c.state !== 'suspended' && <Link to="/admin/billing" className="font-semibold underline-offset-2 hover:underline">{t('banner.choose_plan')}</Link>}
    </div>
  );
}
