import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Bike, Building2, Car, ChevronDown, FileBadge, FileText, Fuel, Globe, IdCard, KeyRound, LayoutDashboard, LogOut, Menu, Moon, Paperclip,
  ScrollText, Settings, Shield, ShieldBan, Sun, User, UserPlus, Users, Wrench, X, Handshake, ClipboardList, MonitorSmartphone, History,
} from 'lucide-react';
import { get, patch, post } from './api';
import { useAuth } from './auth';
import { LANGS, useI18n } from './i18n';
import { cx } from './ui/kit';

type Item = { to: string; label: string; perm: string[]; icon?: ReactNode; badge?: string[]; end?: boolean; children?: Item[] };
type Section = { key: string; label: string; items: Item[] };
type Badges = Record<string, { expired: number; soon: number }>;

// Sections ordered by how often they are used each day (guide 1.3). Items without permission do not appear.
function useSections(): Section[] {
  const { t } = useI18n();
  const i = (to: string, label: string, perm: string | string[], icon?: ReactNode, badge?: string[], children?: Item[], end?: boolean): Item =>
    ({ to, label: t(label), perm: Array.isArray(perm) ? perm : [perm], icon, badge, children, end });
  return [
    { key: 'main', label: t('nav.main'), items: [i('/admin', 'nav.dashboard', 'dashboard.view', <LayoutDashboard />, undefined, undefined, true)] },
    { key: 'riders', label: t('nav.riders'), items: [
      i('/admin/riders', 'nav.rider_list', 'riders.view', <Users />, undefined, undefined, true),
      i('/admin/rider-applicants', 'nav.applicants', 'applicants.view', <UserPlus />),
      i('/admin/riders/docs', 'nav.rider_documents', ['id_documents.view', 'driving_licenses.view', 'health_certs.view', 'driver_cards.view', 'ajeer_permits.view'], <IdCard />,
        ['id', 'license', 'health', 'driver_card', 'ajeer'], [
          i('/admin/riders/id-documents', 'docs.id', 'id_documents.view', undefined, ['id']),
          i('/admin/riders/driving-licenses', 'docs.license', 'driving_licenses.view', undefined, ['license']),
          i('/admin/riders/health-certificates', 'docs.health', 'health_certs.view', undefined, ['health']),
          i('/admin/riders/driver-cards', 'docs.driver_card', 'driver_cards.view', undefined, ['driver_card']),
          i('/admin/riders/ajeer-permits', 'docs.ajeer', 'ajeer_permits.view', undefined, ['ajeer']),
        ]),
    ] },
    { key: 'fleet', label: t('nav.fleet'), items: [
      i('/admin/vehicles', 'nav.vehicles', 'vehicles.view', <Car />),
      i('/admin/operation-cards', 'nav.operation_cards', 'operation_cards.view', <FileBadge />, ['operation_cards']),
      i('/admin/vehicle-registrations', 'nav.vehicle_registrations', 'vehicle_registrations.view', <FileText />, ['vehicle_registrations']),
      i('/admin/insurance', 'nav.insurance', ['insurance_companies.view', 'insurance_policies.view', 'vehicle_insurance.view'], <Shield />, ['insurance_policies', 'vehicle_insurance'], [
        i('/admin/insurance/companies', 'nav.insurance_companies', 'insurance_companies.view'),
        i('/admin/insurance/policies', 'nav.insurance_policies', 'insurance_policies.view', undefined, ['insurance_policies']),
        i('/admin/insurance/vehicles', 'nav.vehicle_insurance', 'vehicle_insurance.view', undefined, ['vehicle_insurance']),
      ]),
      i('/admin/vehicle-assignments', 'nav.vehicle_assignments', 'vehicle_assignments.view', <Bike />),
      i('/admin/fuel-cards', 'nav.fuel_cards', 'fuel_cards.view', <Fuel />),
      i('/admin/oil-changes', 'nav.oil_changes', 'oil_changes.view', <Wrench />, ['oil_changes']),
    ] },
    { key: 'docs', label: t('nav.documents_renewals'), items: [
      i('/admin/transport-licenses', 'nav.transport_licenses', 'transport_licenses.view', <ScrollText />, ['transport_licenses']),
    ] },
    { key: 'performance', label: t('nav.performance'), items: [
      i('/admin/companies', 'nav.companies', 'companies.view', <Building2 />),
      i('/admin/contracts', 'nav.contracts', 'contracts.view', <Handshake />),
    ] },
    { key: 'admin', label: t('nav.administration'), items: [
      i('/admin/users', 'nav.users', 'users.view', <User />),
      i('/admin/roles', 'nav.roles', ['roles.view', 'permissions.view'], <KeyRound />),
      i('/admin/sessions', 'nav.sessions', 'sessions.view', <MonitorSmartphone />),
      i('/admin/blocked-ips', 'nav.blocked_ips', 'blocked_ips.view', <ShieldBan />),
    ] },
    { key: 'system', label: t('nav.system'), items: [
      i('/admin/settings', 'nav.settings', ['system_settings.view', 'platform_settings.view', 'secrets.view'], <Settings />),
      i('/admin/settings/organization', 'nav.organization', 'organization.view', <Building2 />),
      i('/admin/attachments', 'nav.attachments', 'attachments.view', <Paperclip />),
      i('/admin/logs/audit', 'nav.activity_log', ['audit_log.view', 'logs.view'], <ClipboardList />),
      i('/admin/logs/login', 'nav.login_attempts', 'login_log.view', <History />),
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
    <span title={t('nav.badge_title', { expired, soon })}
      className={cx('ms-auto rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none num', expired ? 'bg-red-600 text-white' : 'bg-amber-400 text-amber-950')}>
      {n > 99 ? '99+' : n}
    </span>
  );
}

function Sidebar({ collapsed, onNavigate, badges }: { collapsed: boolean; onNavigate: () => void; badges: Badges }) {
  const { can, org } = useAuth();
  const sections = useSections();
  const loc = useLocation();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const visible = (it: Item) => can(...it.perm);
  const linkCls = ({ isActive }: { isActive: boolean }) => cx('flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition [&_svg]:size-4 [&_svg]:shrink-0',
    isActive ? 'bg-brand text-white' : 'text-zinc-300 hover:bg-white/10 hover:text-white');
  return (
    <nav className="scroll-thin flex h-full flex-col overflow-y-auto bg-zinc-900 px-2 py-3 text-zinc-100 dark:bg-zinc-950">
      <Link to="/admin" onClick={onNavigate} className="mb-4 flex items-center gap-2 px-2">
        {org?.logos?.logo ? <img src="/api/public/logo/logo" alt="" className="h-8 w-8 rounded bg-white object-contain p-0.5" />
          : <span className="flex size-8 items-center justify-center rounded bg-brand font-bold">{(org?.['org.name'] || 'L')[0]}</span>}
        {!collapsed && <span className="truncate text-sm font-semibold">{org?.['org.name'] || org?.['platform.name']}</span>}
      </Link>
      {sections.map((s) => {
        const items = s.items.filter(visible);
        if (!items.length) return null;
        return (
          <div key={s.key} className="mb-3">
            {!collapsed && (
              <div className="mb-1 flex items-center px-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                {s.label}
                <NavBadge keys={items.flatMap((x) => x.badge ?? [])} badges={badges} />
              </div>
            )}
            <div className="space-y-0.5">
              {items.map((it) => it.children ? (
                <div key={it.to}>
                  <button title={collapsed ? it.label : undefined} onClick={() => setOpen({ ...open, [it.to]: !(open[it.to] ?? loc.pathname.startsWith(it.to)) })}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm text-zinc-300 hover:bg-white/10 hover:text-white [&_svg]:size-4">
                    {it.icon}{!collapsed && <><span className="truncate">{it.label}</span><NavBadge keys={it.badge} badges={badges} /><ChevronDown className="!size-3.5 opacity-60" /></>}
                  </button>
                  {(open[it.to] ?? it.children.some((c) => loc.pathname.startsWith(c.to))) && !collapsed && (
                    <div className="ms-6 mt-0.5 space-y-0.5 border-s border-zinc-700 ps-2">
                      {it.children.filter(visible).map((c) => (
                        <NavLink key={c.to} to={c.to} onClick={onNavigate} className={linkCls}><span className="truncate">{c.label}</span><NavBadge keys={c.badge} badges={badges} /></NavLink>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <NavLink key={it.to} to={it.to} end={it.end} onClick={onNavigate} className={linkCls} title={collapsed ? it.label : undefined}>
                  {it.icon}{!collapsed && <><span className="truncate">{it.label}</span><NavBadge keys={it.badge} badges={badges} /></>}
                </NavLink>
              ))}
            </div>
          </div>
        );
      })}
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

export function LangPicker({ compact }: { compact?: boolean }) {
  const { lang, setLang, t } = useI18n();
  const { me } = useAuth();
  return (
    <label className="inline-flex items-center gap-1.5 text-sm" title={t('top.language')}>
      <Globe className="size-4 text-zinc-500" />
      <select className={cx('cursor-pointer rounded-md bg-transparent py-1 text-sm outline-none', compact && 'max-w-24')} value={lang}
        onChange={(e) => {
          const l = e.target.value as typeof lang;
          setLang(l);
          // The choice is saved and remains after signing out.
          if (me) patch('/profile', { locale: l }).catch(() => {});
        }}>
        {LANGS.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
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
  const signOut = async () => { await post('/auth/logout').catch(() => {}); await refresh(); nav('/admin/login'); };

  return (
    <div className="flex min-h-screen">
      <aside className={cx('fixed inset-y-0 start-0 z-40 transition-all lg:sticky lg:top-0 lg:h-screen', collapsed ? 'lg:w-16' : 'lg:w-64', mobile ? 'w-72' : 'hidden lg:block')}>
        <Sidebar collapsed={collapsed && !mobile} onNavigate={() => setMobile(false)} badges={badges} />
      </aside>
      {mobile && <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setMobile(false)} />}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-zinc-200 bg-white/90 px-3 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/90">
          <button className="rounded-lg p-2 text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
            title={window.innerWidth < 1024 ? t('top.open_menu') : t('top.collapse_sidebar')}
            onClick={() => (window.innerWidth < 1024 ? setMobile(!mobile) : setCollapsed(!collapsed))}>
            {mobile ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
          <div className="ms-auto flex items-center gap-1">
            <LangPicker />
            <ThemeToggle />
            <div className="relative">
              <button onClick={() => setMenu(!menu)} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800">
                <span className="flex size-7 items-center justify-center rounded-full bg-brand text-xs font-semibold text-white">{me?.full_name.slice(0, 2)}</span>
                <span className="hidden max-w-40 truncate sm:block">{me?.full_name}</span>
                <ChevronDown className="size-3.5 text-zinc-400" />
              </button>
              {menu && (
                <div className="absolute end-0 mt-1 w-48 rounded-lg border border-zinc-200 bg-white py-1 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900" onMouseLeave={() => setMenu(false)}>
                  <Link to="/admin/profile" onClick={() => setMenu(false)} className="flex items-center gap-2 px-3 py-2 hover:bg-zinc-100 dark:hover:bg-zinc-800"><User className="size-4" />{t('top.profile')}</Link>
                  <button onClick={signOut} className="flex w-full items-center gap-2 px-3 py-2 text-red-600 hover:bg-zinc-100 dark:hover:bg-zinc-800"><LogOut className="size-4" />{t('top.sign_out')}</button>
                </div>
              )}
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1500px] flex-1 p-4 sm:p-6"><Outlet /></main>
      </div>
    </div>
  );
}

