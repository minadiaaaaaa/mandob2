import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BarChart3, Car, FileCheck2, IdCard, Receipt, ShieldCheck, Users, Wallet } from 'lucide-react';
import { get } from '../api';
import { useAuth } from '../auth';
import { useI18n } from '../i18n';
import { LangPicker, ThemeToggle } from '../layout';
import { planLimit, type Plan } from '../plans';
import { Button, cx } from '../ui/kit';

// The public page of the platform: it presents Mandoob to delivery companies and leads them to register their
// company (14 days free) or sign in. Riders get a small link to their own sign-in. It shows no company data.
const SHOWN_LIMITS = ['riders', 'vehicles', 'users', 'branches'] as const;

export default function PublicSite() {
  const { t, lang } = useI18n();
  const { org } = useAuth();
  const [server, setServer] = useState<'checking' | 'online' | 'offline'>('checking');
  const [plans, setPlans] = useState<Plan[]>([]);
  useEffect(() => {
    get('/public/org').then(() => setServer('online')).catch(() => setServer('offline'));
    get<Plan[]>('/public/plans').then(setPlans).catch(() => setPlans([]));
  }, []);
  const o = (org ?? { logos: {} }) as Record<string, string> & { logos: Record<string, number> };
  const brand = o['platform.name'] || o['org.name'] || 'Mandoob';
  const pname = (p: Plan) => (lang === 'ar' ? p.name_ar : p.name_en);
  const price = (p: Plan) => (p.key === 'free' ? t('billing.free_price') : p.price_monthly > 0 ? `${Number(p.price_monthly).toLocaleString('en-US')} ${t('billing.sar')}` : t('billing.price_on_request'));
  const modules = [
    [Users, 'public.m.riders'], [Car, 'public.m.fleet'], [FileCheck2, 'public.m.documents'], [IdCard, 'public.m.cards'],
    [ShieldCheck, 'public.m.insurance'], [BarChart3, 'public.m.performance'], [Wallet, 'public.m.finance'], [Receipt, 'public.m.invoices'],
  ] as const;
  const steps = ['public.step1', 'public.step2', 'public.step3'] as const;
  const register = (size?: 'sm') => <Link to="/signup"><Button variant="primary" size={size}>{t('public.register_company')}</Button></Link>;
  const signIn = (size?: 'sm') => <Link to="/admin/login"><Button size={size}>{t('public.company_sign_in')}</Button></Link>;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/90 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/90">
        <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-3">
          {o.logos?.logo ? <img src="/api/public/logo/logo" alt="" className="h-9" /> : <span className="flex size-9 items-center justify-center rounded-lg bg-brand font-bold text-white">{brand[0]}</span>}
          <span className="font-semibold">{brand}</span>
          <div className="ms-auto flex items-center gap-1">
            <LangPicker compact /><ThemeToggle />
            <span className="hidden sm:inline">{signIn('sm')}</span>
            {register('sm')}
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-4 py-16 text-center">
        <span className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
          <span className={cx('size-2 rounded-full', server === 'online' ? 'bg-emerald-500' : server === 'offline' ? 'bg-red-500' : 'bg-amber-400')} />
          {t('public.saas_badge')}
        </span>
        <h1 className="mx-auto mt-5 max-w-3xl text-3xl font-bold tracking-tight sm:text-4xl">{t('public.saas_hero')}</h1>
        <p className="mx-auto mt-4 max-w-2xl text-zinc-600 dark:text-zinc-400">{t('public.saas_sub')}</p>
        <div className="mt-7 flex flex-wrap justify-center gap-3">{register()}{signIn()}</div>
        <p className="mt-5 text-sm text-zinc-500">{t('public.rider_q')} <Link to="/rider/login" className="font-medium text-brand hover:underline">{t('public.rider_sign_in_id')}</Link></p>
      </section>

      <section id="modules" className="mx-auto max-w-6xl px-4 pb-14">
        <h2 className="mb-5 text-center text-xl font-semibold">{t('public.what_manages')}</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {modules.map(([Icon, k]) => (
            <div key={k} className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
              <Icon className="mb-3 size-6 text-brand" /><h3 className="font-semibold">{t(k)}</h3><p className="mt-1 text-sm text-zinc-500">{t(`${k}_d`)}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-14">
        <h2 className="mb-5 text-center text-xl font-semibold">{t('public.how_title')}</h2>
        <ol className="grid gap-4 md:grid-cols-3">
          {steps.map((k, i) => (
            <li key={k} className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
              <span className="num flex size-8 items-center justify-center rounded-full bg-brand/10 font-semibold text-brand">{i + 1}</span>
              <h3 className="mt-3 font-semibold">{t(k)}</h3><p className="mt-1 text-sm text-zinc-500">{t(`${k}_d`)}</p>
            </li>
          ))}
        </ol>
      </section>

      {plans.length > 0 && (
        <section id="plans" className="mx-auto max-w-6xl px-4 pb-14">
          <h2 className="text-center text-xl font-semibold">{t('public.plans_title')}</h2>
          <p className="mb-5 mt-1 text-center text-sm text-zinc-500">{t('public.plans_sub')}</p>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {plans.map((p) => (
              <div key={p.key} className="flex flex-col rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
                <h3 className="font-semibold">{pname(p)}</h3>
                <div className="mt-2">
                  <span className="num text-2xl font-bold">{price(p)}</span>
                  {p.key !== 'free' && p.price_monthly > 0 && <span className="text-xs text-zinc-500"> / {t('billing.per_month')}</span>}
                </div>
                <ul className="mt-4 flex-1 space-y-1.5 text-sm text-zinc-600 dark:text-zinc-400">
                  {SHOWN_LIMITS.map((k) => <li key={k}><span className="num font-medium text-zinc-900 dark:text-zinc-100">{planLimit(p, k) ?? '∞'}</span> {t(`billing.${k}`)}</li>)}
                  {p.features.map((k) => <li key={k} className="text-xs">✓ {t(`feature.${k}`)}</li>)}
                </ul>
                <Link to="/signup" className="mt-4"><Button className="w-full" variant={p.key === 'free' ? 'secondary' : 'primary'}>{t('public.register_company')}</Button></Link>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="mx-auto max-w-6xl px-4 pb-16">
        <div className="rounded-2xl bg-brand/5 p-8 text-center ring-1 ring-brand/20">
          <h2 className="text-xl font-semibold">{t('public.cta_title')}</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-zinc-600 dark:text-zinc-400">{t('signup.trial_note')}</p>
          <div className="mt-5 flex flex-wrap justify-center gap-3">{register()}{signIn()}</div>
        </div>
      </section>

      <footer className="border-t border-zinc-200 py-6 text-center text-xs text-zinc-500 dark:border-zinc-800">
        © {new Date().getFullYear()} {brand} · <Link to="/rider/login" className="hover:underline">{t('public.rider_sign_in')}</Link>
      </footer>
    </div>
  );
}
