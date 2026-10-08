import { Component, createContext, useCallback, useContext, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Activity, ArrowLeft, ArrowRight, CalendarDays, Camera, Check, ChevronDown, ChevronsLeft, ChevronsRight, Eye, EyeOff, FilePen, LayoutDashboard, LifeBuoy, LogOut, Mail, Menu,
  MessagesSquare, MoreHorizontal, Phone, ShieldAlert, ShieldCheck, Star, UserRound, X,
} from 'lucide-react';
import { ApiError, get, post, put } from '../../api';
import { useAuth } from '../../auth';
import { useI18n } from '../../i18n';
import { LangPicker, ThemeToggle } from '../../layout';
import { Alert, Button, cx, Field, Spinner, useErrorText } from '../../ui/kit';

// Chapter 12: the rider portal. Phone first; the rider reads and requests, the office approves.
export type RiderMe = { id: number; full_name: string; alias: string | null; status: string; has_password: boolean; verified_email: string | null; locale: string | null; photo_id: number | null; unread_issues: number };
const Ctx = createContext<{ me: RiderMe; refresh: () => Promise<void> }>(null!);
export const useRider = () => useContext(Ctx);
export const riderFile = (id: number) => `/api/portal/files/${id}`;

const NAV: [string, string, typeof Activity, boolean?][] = [
  ['/rider', 'rp.nav.overview', LayoutDashboard, true], ['/rider/profile', 'rp.nav.profile', UserRound], ['/rider/attendance', 'rp.nav.attendance', Camera],
  ['/rider/performance', 'rp.nav.performance', Activity], ['/rider/ratings', 'rp.nav.ratings', Star], ['/rider/requests', 'rp.nav.requests', FilePen],
  ['/rider/leaves', 'rp.nav.leaves', CalendarDays], ['/rider/issues', 'rp.nav.issues', MessagesSquare], ['/rider/security', 'rp.nav.security', ShieldCheck],
  ['/rider/help', 'rp.nav.help', LifeBuoy],
];
const BOTTOM = ['/rider', '/rider/attendance', '/rider/performance', '/rider/issues'];

const store = { get: (k: string, s = localStorage) => { try { return s.getItem(k); } catch { return null; } }, set: (k: string, v: string, s = localStorage) => { try { s.setItem(k, v); } catch { /* blocked */ } } };

function Logo({ className }: { className?: string }) {
  const { org } = useAuth();
  return org?.logos?.logo ? <img src="/api/public/logo/logo" alt="" className={cx('object-contain', className)} />
    : <span className={cx('flex items-center justify-center rounded-lg bg-brand font-bold text-white', className)}>{(org?.['org.name'] || 'L')[0]}</span>;
}

// ---------- a page that fails shows a message and is recorded for the office ----------
class PageBoundary extends Component<{ children: ReactNode; t: (k: string) => string; page: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(e: Error, info: ErrorInfo) { post('/portal/client-error', { page: this.props.page, message: e.message, stack: `${e.stack ?? ''}\n${info.componentStack ?? ''}` }).catch(() => {}); }
  render() {
    if (!this.state.failed) return this.props.children;
    return <div className="py-16 text-center"><p className="font-medium">{this.props.t('rp.page_failed')}</p>
      <Button className="mt-4" onClick={() => this.setState({ failed: false })}>{this.props.t('rp.try_again')}</Button></div>;
  }
}

export function PortalLayout() {
  const { t, setLang } = useI18n();
  const nav = useNavigate();
  const loc = useLocation();
  const [me, setMe] = useState<RiderMe | null>(null);
  const [collapsed, setCollapsed] = useState(() => store.get('lsp.rp.collapsed') === '1');
  const [drawer, setDrawer] = useState(false);
  const [menu, setMenu] = useState(false);
  const [dismissed, setDismissed] = useState(() => store.get('lsp.rp.secure_dismissed', sessionStorage) === '1');
  const first = useRef(true);
  const refresh = useCallback(async () => {
    try {
      const m = await get<RiderMe>('/portal/me');
      setMe(m);
      // the language saved in the account wins after sign-in
      if (first.current) { first.current = false; if (m.locale) setLang(m.locale); }
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) nav(`/rider/login?next=${encodeURIComponent(loc.pathname + loc.search)}${me ? '&ended=1' : ''}`, { replace: true });
    }
  }, [nav, setLang]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, [refresh]);
  // the unread counter next to "Issues" follows new replies
  useEffect(() => { const h = setInterval(refresh, 30000); return () => clearInterval(h); }, [refresh]);
  useEffect(() => {
    const off = () => nav('/rider/login?ended=1', { replace: true });
    window.addEventListener('lsp:rider-unauthorized', off);
    return () => window.removeEventListener('lsp:rider-unauthorized', off);
  }, [nav]);
  useEffect(() => { store.set('lsp.rp.collapsed', collapsed ? '1' : '0'); }, [collapsed]);
  useEffect(() => { setDrawer(false); setMenu(false); }, [loc.pathname]);
  if (!me) return <div className="flex min-h-screen items-center justify-center"><Spinner /></div>;

  const signOut = async () => { await post('/portal/logout').catch(() => {}); nav('/rider/login', { replace: true }); };
  const saveLang = (l: string) => { put('/portal/locale', { locale: l }).catch(() => {}); };
  const secured = !!me.verified_email && me.has_password;
  const link = (to: string, label: string, Icon: typeof Activity, end?: boolean, small?: boolean) => (
    <NavLink key={to} to={to} end={end} title={small ? t(label) : undefined}
      className={({ isActive }) => cx('flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition',
        isActive ? 'bg-brand/10 font-semibold text-brand' : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800')}>
      <Icon className="size-[18px] shrink-0" />{!small && <span className="flex-1 truncate">{t(label)}</span>}
      {to === '/rider/issues' && me.unread_issues > 0 && <span className={cx('rounded-full bg-red-600 px-1.5 text-[10px] font-semibold leading-4 text-white num', small && 'absolute ms-4 -mt-4')}>{me.unread_issues}</span>}
    </NavLink>
  );
  const menuItems = (small = false) => (
    <>
      <div className="space-y-0.5">{NAV.map(([to, label, Icon, end]) => link(to, label, Icon, end, small))}</div>
      <button onClick={signOut} title={small ? t('rp.sign_out') : undefined} className="mt-4 flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30">
        <LogOut className="size-[18px]" />{!small && t('rp.sign_out')}
      </button>
    </>
  );
  const account = (
    <div className="relative">
      <button onClick={() => setMenu(!menu)} aria-expanded={menu} className="flex items-center gap-2 rounded-xl px-1.5 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-800">
        {me.photo_id ? <img src={riderFile(me.photo_id)} alt="" className="size-8 rounded-full object-cover" />
          : <span className="flex size-8 items-center justify-center rounded-full bg-brand text-xs font-semibold text-white">{me.full_name.slice(0, 2)}</span>}
        <ChevronDown className="size-3.5 text-zinc-400" />
      </button>
      {menu && (
        <div className="pop-in absolute end-0 z-50 mt-1 w-56 overflow-hidden rounded-xl border border-zinc-200 bg-white py-1 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          <div className="border-b border-zinc-100 px-3 py-2 dark:border-zinc-800"><div className="truncate font-medium">{me.full_name}</div>
            <div className="text-xs text-zinc-500">{t('rp.rider_id')}: <span className="num">{me.id}</span></div></div>
          <Link to="/rider/profile" className="flex items-center gap-2 px-3 py-2 hover:bg-zinc-100 dark:hover:bg-zinc-800"><UserRound className="size-4" />{t('rp.nav.profile')}</Link>
          <Link to="/rider/security" className="flex items-center gap-2 px-3 py-2 hover:bg-zinc-100 dark:hover:bg-zinc-800"><ShieldCheck className="size-4" />{t('rp.nav.security')}</Link>
          <button onClick={signOut} className="flex w-full items-center gap-2 px-3 py-2 text-red-600 hover:bg-zinc-100 dark:hover:bg-zinc-800"><LogOut className="size-4" />{t('rp.sign_out')}</button>
        </div>
      )}
    </div>
  );
  return (
    <Ctx.Provider value={{ me, refresh }}>
      <div className="flex min-h-screen bg-zinc-50 dark:bg-zinc-950">
        {/* side menu on wide screens */}
        <aside className={cx('sticky top-0 hidden h-screen shrink-0 flex-col border-e border-zinc-200 bg-white p-3 transition-all lg:flex dark:border-zinc-800 dark:bg-zinc-900', collapsed ? 'w-[4.5rem]' : 'w-64')}>
          <div className="mb-4 flex items-center gap-2.5 px-1.5">
            <Logo className="size-9 shrink-0" />
            {!collapsed && <span className="truncate font-semibold">{t('rp.title')}</span>}
          </div>
          <nav className="scroll-thin flex-1 overflow-y-auto">{menuItems(collapsed)}</nav>
          <button onClick={() => setCollapsed(!collapsed)} className="mt-2 flex items-center gap-2 rounded-xl px-3 py-2 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">
            {collapsed ? <ChevronsRight className="size-4 rtl:rotate-180" /> : <><ChevronsLeft className="size-4 rtl:rotate-180" />{t('rp.collapse')}</>}
          </button>
        </aside>
        {drawer && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <div className="absolute inset-0 bg-black/40" onClick={() => setDrawer(false)} />
            <div className="pop-in absolute inset-y-0 start-0 flex w-72 flex-col bg-white p-3 shadow-xl dark:bg-zinc-900">
              <div className="mb-4 flex items-center gap-2.5 px-1.5"><Logo className="size-9" /><span className="flex-1 truncate font-semibold">{t('rp.title')}</span>
                <button onClick={() => setDrawer(false)} title={t('rp.close')} className="rounded-lg p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800"><X className="size-5" /></button></div>
              <nav className="scroll-thin flex-1 overflow-y-auto">{menuItems()}</nav>
            </div>
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col pb-16 lg:pb-0">
          <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-zinc-200/80 bg-white/85 px-3 backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-900/85">
            <button className="rounded-lg p-2 hover:bg-zinc-100 lg:hidden dark:hover:bg-zinc-800" title={t('rp.open_menu')} onClick={() => setDrawer(true)}><Menu className="size-5" /></button>
            <Logo className="size-8 lg:hidden" />
            <span className="hidden truncate font-medium lg:block">{t('rp.hello', { name: me.alias || me.full_name })}</span>
            <div className="ms-auto flex items-center gap-1"><LangPicker compact onPick={saveLang} /><ThemeToggle />{account}</div>
          </header>
          {!secured && !dismissed && (
            <div className="flex flex-wrap items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
              <ShieldAlert className="size-4 shrink-0" /><span className="flex-1">{t('rp.secure.bar')}</span>
              <Link to="/rider/security"><Button size="sm" variant="warn">{t('rp.secure.now')}</Button></Link>
              <Button size="sm" variant="ghost" onClick={() => { setDismissed(true); store.set('lsp.rp.secure_dismissed', '1', sessionStorage); }}>{t('rp.dismiss')}</Button>
            </div>
          )}
          <main className="mx-auto w-full max-w-6xl flex-1 p-4 sm:p-6">
            <PageBoundary key={loc.pathname} t={t} page={loc.pathname}><Outlet /></PageBoundary>
          </main>
        </div>
        {/* bottom bar on the phone */}
        <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-zinc-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden dark:border-zinc-800 dark:bg-zinc-900/95">
          {BOTTOM.map((to) => { const [, label, Icon, end] = NAV.find((n) => n[0] === to)!; return (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => cx('relative flex flex-col items-center gap-0.5 py-2 text-[11px]', isActive ? 'font-semibold text-brand' : 'text-zinc-500')}>
              <Icon className="size-5" /><span className="max-w-full truncate px-1">{t(label)}</span>
              {to === '/rider/issues' && me.unread_issues > 0 && <span className="absolute top-1 ms-6 rounded-full bg-red-600 px-1 text-[9px] font-semibold leading-4 text-white num">{me.unread_issues}</span>}
            </NavLink>
          ); })}
          <button onClick={() => setDrawer(true)} className="flex flex-col items-center gap-0.5 py-2 text-[11px] text-zinc-500"><MoreHorizontal className="size-5" />{t('rp.more')}</button>
        </nav>
      </div>
    </Ctx.Provider>
  );
}

// ---------- sign in (12.2) ----------
function PublicFrame({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const { org } = useAuth();
  const phone = org?.['org.support_phone'], email = org?.['org.support_email'];
  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-br from-zinc-100 to-zinc-200 dark:from-zinc-950 dark:to-zinc-900">
      <div className="flex items-center gap-1 p-3">
        <Link to="/" className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm text-zinc-600 hover:bg-white/60 dark:text-zinc-300 dark:hover:bg-zinc-800"><ArrowLeft className="size-4 rtl:rotate-180" />{t('rp.back_to_site')}</Link>
        <div className="ms-auto flex items-center gap-1"><LangPicker compact /><ThemeToggle /></div>
      </div>
      <div className="flex flex-1 items-center justify-center p-4">
        <div className="w-full max-w-sm">
          <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
            <div className="mb-5 text-center"><Logo className="mx-auto mb-3 size-12 text-lg" /><div className="text-sm text-zinc-500">{org?.['org.name'] || org?.['platform.name']}</div></div>
            {children}
          </div>
          {(phone || email) && (
            <div className="mt-4 rounded-xl bg-white/70 p-3 text-center text-xs text-zinc-600 dark:bg-zinc-900/70 dark:text-zinc-400">
              <div className="mb-1 font-medium">{t('rp.need_help')}</div>
              <div className="flex flex-wrap justify-center gap-3">
                {phone && <a href={`tel:${phone}`} className="inline-flex items-center gap-1 hover:text-brand"><Phone className="size-3.5" /><span className="num" dir="ltr">{phone}</span></a>}
                {email && <a href={`mailto:${email}`} className="inline-flex items-center gap-1 hover:text-brand"><Mail className="size-3.5" />{email}</a>}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
const digits = (s: string) => s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6f0)).replace(/\D/g, '');

export function RiderLogin() {
  const { t } = useI18n();
  const nav = useNavigate();
  const errText = useErrorText();
  const [params] = useSearchParams();
  const [id, setId] = useState('');
  const [step, setStep] = useState<'id' | 'password'>('id');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const pw = useRef<HTMLInputElement>(null);
  useEffect(() => { get('/portal/me').then(() => nav('/rider', { replace: true })).catch(() => {}); }, [nav]);
  useEffect(() => { if (step === 'password') pw.current?.focus(); }, [step]);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id) { setErr(t('rp.login.enter_id')); return; }
    setBusy(true); setErr(null);
    try {
      const r = await post<{ step?: string; first?: boolean }>('/portal/login', { rider_id: id, password: step === 'password' ? password : undefined });
      if (r.step === 'password') { setStep('password'); return; }
      nav(r.first ? '/rider/security?welcome=1' : params.get('next') || '/rider', { replace: true });
    } catch (e) { setErr(errText(e)); setPassword(''); } finally { setBusy(false); }
  };
  return (
    <PublicFrame>
      <form onSubmit={submit} className="space-y-3">
        <h1 className="text-center text-lg font-semibold">{step === 'id' ? t('rp.login.title') : t('rp.login.enter_password')}</h1>
        {params.get('ended') && <Alert tone="amber">{t('rp.login.ended')}</Alert>}
        {step === 'id' ? (
          <>
            <Field label={t('rp.rider_id')}><input className="input text-center text-lg tracking-widest num" inputMode="numeric" autoComplete="username" maxLength={20} dir="ltr" autoFocus
              value={id} onChange={(e) => setId(digits(e.target.value))} placeholder="102345" /></Field>
            {err && <Alert tone="red">{err}</Alert>}
            <Button type="submit" variant="primary" className="w-full" loading={busy}>{t('rp.login.continue')}</Button>
            <p className="rounded-lg bg-zinc-50 p-3 text-xs text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-400">{t('rp.login.first_time')}</p>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between rounded-lg bg-zinc-50 px-3 py-2 text-sm dark:bg-zinc-800/60">
              <span>{t('rp.rider_id')}: <b className="num">{id}</b></span>
              <button type="button" className="text-brand hover:underline" onClick={() => { setStep('id'); setPassword(''); setErr(null); }}>{t('rp.login.change')}</button>
            </div>
            <Field label={t('rp.password')}>
              <div className="relative">
                <input ref={pw} className="input pe-9" type={show ? 'text' : 'password'} autoComplete="current-password" dir="ltr" value={password} onChange={(e) => setPassword(e.target.value)} />
                <button type="button" className="absolute end-2 top-2 text-zinc-400" title={show ? t('login.hide_password') : t('login.show_password')} onClick={() => setShow(!show)}>{show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button>
              </div>
            </Field>
            {err && <Alert tone="red">{err}</Alert>}
            <Button type="submit" variant="primary" className="w-full" loading={busy}>{t('rp.login.sign_in')}</Button>
            <p className="text-center text-sm"><Link to={`/rider/forgot-password?id=${id}`} className="text-brand hover:underline">{t('rp.login.forgot')}</Link></p>
          </>
        )}
      </form>
    </PublicFrame>
  );
}

// ---------- password fields with their requirements and strength (12.3, 12.12) ----------
export const passwordOk = (p: string) => p.length >= 8 && p.length <= 72 && /[A-Za-z]/.test(p) && /\d/.test(p);
export function PasswordFields({ value, confirm, onChange, onConfirm, errors }: { value: string; confirm: string; onChange: (v: string) => void; onConfirm: (v: string) => void; errors?: Record<string, string | undefined> }) {
  const { t } = useI18n();
  const [show, setShow] = useState(false);
  const rules: [string, boolean][] = [['rp.pw.length', value.length >= 8 && value.length <= 72], ['rp.pw.letter', /[A-Za-z]/.test(value)], ['rp.pw.digit', /\d/.test(value)], ['rp.pw.match', !!value && value === confirm]];
  const score = [value.length >= 8, /[A-Za-z]/.test(value) && /\d/.test(value), value.length >= 12, /[^A-Za-z0-9]/.test(value) || /[a-z]/.test(value) && /[A-Z]/.test(value)].filter(Boolean).length;
  const strength = ['weak', 'weak', 'fair', 'good', 'strong'][score];
  return (
    <div className="space-y-3">
      <Field label={t('rp.pw.new')} error={errors?.password}>
        <div className="relative">
          <input className="input pe-9" type={show ? 'text' : 'password'} autoComplete="new-password" dir="ltr" maxLength={72} value={value} onChange={(e) => onChange(e.target.value)} />
          <button type="button" className="absolute end-2 top-2 text-zinc-400" onClick={() => setShow(!show)} title={show ? t('login.hide_password') : t('login.show_password')}>{show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button>
        </div>
      </Field>
      {value && (
        <div className="flex items-center gap-2 text-xs">
          <div className="flex flex-1 gap-1">{[1, 2, 3, 4].map((i) => <span key={i} className={cx('h-1.5 flex-1 rounded-full', i <= score ? ['bg-red-500', 'bg-red-500', 'bg-amber-500', 'bg-blue-500', 'bg-emerald-500'][score] : 'bg-zinc-200 dark:bg-zinc-700')} />)}</div>
          <span className="w-14 text-end">{t(`rp.pw.${strength}`)}</span>
        </div>
      )}
      <Field label={t('rp.pw.confirm')} error={errors?.confirm}><input className="input" type={show ? 'text' : 'password'} autoComplete="new-password" dir="ltr" maxLength={72} value={confirm} onChange={(e) => onConfirm(e.target.value)} /></Field>
      <div className="rounded-lg bg-zinc-50 p-3 text-xs dark:bg-zinc-800/60">
        <div className="mb-1 font-medium">{t('rp.pw.requirements')}</div>
        <ul className="space-y-1">{rules.map(([k, okk]) => <li key={k} className={cx('flex items-center gap-1.5', okk ? 'text-emerald-600' : 'text-zinc-500')}>{okk ? <Check className="size-3.5" /> : <span className="size-3.5 text-center">•</span>}{t(k)}</li>)}</ul>
      </div>
    </div>
  );
}

// A countdown for "Resend code".
export function useCountdown() {
  const [left, setLeft] = useState(0);
  useEffect(() => { if (left <= 0) return; const h = setTimeout(() => setLeft(left - 1), 1000); return () => clearTimeout(h); }, [left]);
  return [left, setLeft] as const;
}
export function useFieldText() {
  const { t, has } = useI18n();
  return (e: unknown, field: string) => {
    if (!(e instanceof ApiError) || !e.fields[field]) return undefined;
    const k = `err.${e.fields[field]}`;
    return has(k) ? t(k, e.params) : t('err.invalid');
  };
}

// ---------- forgot password (12.3) ----------
export function ForgotPassword() {
  const { t } = useI18n();
  const errText = useErrorText();
  const fieldText = useFieldText();
  const [params] = useSearchParams();
  const [id, setId] = useState(digits(params.get('id') ?? ''));
  const [step, setStep] = useState<'id' | 'code' | 'done'>(params.get('step') === 'code' && params.get('id') ? 'code' : 'id');
  const [code, setCode] = useState('');
  const [pw, setPw] = useState(''); const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string | undefined>>({});
  const [left, setLeft] = useCountdown();
  const send = async () => {
    if (!id) { setErr(t('rp.login.enter_id')); return; }
    setBusy(true); setErr(null);
    try { const r = await post('/portal/forgot', { rider_id: id }); setLeft(r.resend_in); setStep('code'); } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  const reset = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null); setFields({});
    try { await post('/portal/reset', { rider_id: id, code, password: pw, confirm: pw2 }); setStep('done'); }
    catch (e) { const f = { code: fieldText(e, 'code'), password: fieldText(e, 'password'), confirm: fieldText(e, 'confirm') }; setFields(f); if (!f.code && !f.password && !f.confirm) setErr(errText(e)); }
    finally { setBusy(false); }
  };
  return (
    <PublicFrame>
      {step === 'id' && (
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); send(); }}>
          <h1 className="text-center text-lg font-semibold">{t('rp.forgot.title')}</h1>
          <p className="text-center text-sm text-zinc-500">{t('rp.forgot.intro')}</p>
          <Field label={t('rp.rider_id')}><input className="input text-center tracking-widest num" inputMode="numeric" maxLength={20} dir="ltr" value={id} onChange={(e) => setId(digits(e.target.value))} /></Field>
          {err && <Alert tone="red">{err}</Alert>}
          <Button type="submit" variant="primary" className="w-full" loading={busy}>{t('rp.send_code')}</Button>
        </form>
      )}
      {step === 'code' && (
        <form className="space-y-3" onSubmit={reset}>
          <h1 className="text-center text-lg font-semibold">{t('rp.forgot.check_email')}</h1>
          <p className="text-center text-sm text-zinc-500">{t('rp.forgot.sent')}</p>
          <Field label={t('rp.forgot.code')} error={fields.code}><input className="input text-center text-lg tracking-[0.5em] num" inputMode="numeric" maxLength={6} dir="ltr" autoComplete="one-time-code" value={code} onChange={(e) => setCode(digits(e.target.value))} /></Field>
          <PasswordFields value={pw} confirm={pw2} onChange={setPw} onConfirm={setPw2} errors={fields} />
          {err && <Alert tone="red">{err}</Alert>}
          <Button type="submit" variant="primary" className="w-full" loading={busy} disabled={code.length !== 6 || !passwordOk(pw) || pw !== pw2}>{t('rp.forgot.reset')}</Button>
          <p className="text-center text-sm">{left > 0 ? <span className="text-zinc-500">{t('rp.resend_in', { n: left })}</span>
            : <button type="button" className="text-brand hover:underline" onClick={send}>{t('rp.resend')}</button>}</p>
        </form>
      )}
      {step === 'done' && (
        <div className="space-y-4 text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-950"><Check className="size-6" /></div>
          <h1 className="text-lg font-semibold">{t('rp.forgot.done')}</h1>
          <p className="text-sm text-zinc-500">{t('rp.forgot.done_text')}</p>
          <Link to="/rider/login"><Button variant="primary" className="w-full" icon={<ArrowRight className="size-4 rtl:rotate-180" />}>{t('rp.forgot.go_sign_in')}</Button></Link>
        </div>
      )}
    </PublicFrame>
  );
}
