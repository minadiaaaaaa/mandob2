import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BarChart3, Car, FileCheck2, IdCard, ShieldCheck, Users } from 'lucide-react';
import { get } from '../api';
import { useAuth } from '../auth';
import { useI18n } from '../i18n';
import { LangPicker, ThemeToggle } from '../layout';
import { Button, cx } from '../ui/kit';

// The public page: introduces the organization and leads the rider to sign in. It shows no statistics.
export default function PublicSite() {
  const { t } = useI18n();
  const { org } = useAuth();
  const [server, setServer] = useState<'checking' | 'online' | 'offline'>('checking');
  useEffect(() => { get('/public/org').then(() => setServer('online')).catch(() => setServer('offline')); }, []);
  const o = (org ?? { logos: {} }) as Record<string, string> & { logos: Record<string, number> };
  const panel = (title: string, rows: [string, string | undefined][]) => {
    const shown = rows.filter(([, v]) => v);
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
        <h3 className="mb-3 font-semibold">{title}</h3>
        {shown.length ? <dl className="space-y-2 text-sm">{shown.map(([k, v]) => <div key={k} className="flex justify-between gap-3"><dt className="text-zinc-500">{k}</dt><dd className="num text-end">{v}</dd></div>)}</dl>
          : <p className="text-sm text-zinc-500">{t('public.not_entered')}</p>}
      </div>
    );
  };
  const modules = [[Car, 'public.m.fleet'], [FileCheck2, 'public.m.documents'], [Users, 'public.m.riders'], [IdCard, 'public.m.cards'], [ShieldCheck, 'public.m.insurance'], [BarChart3, 'public.m.performance']] as const;
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/90 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/90">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          {o.logos?.logo ? <img src="/api/public/logo/logo" alt="" className="h-9" /> : <span className="flex size-9 items-center justify-center rounded-lg bg-brand font-bold text-white">{(o['org.name'] || 'L')[0]}</span>}
          <div className="leading-tight"><div className="font-semibold">{o['org.name'] || o['platform.name']}</div><div className="text-xs text-zinc-500">{o['org.name_en']}</div></div>
          <div className="ms-auto flex items-center gap-1"><LangPicker compact /><ThemeToggle /><Link to="/rider/login"><Button variant="primary" size="sm">{t('public.rider_sign_in')}</Button></Link></div>
        </div>
      </header>
      <section className="mx-auto max-w-6xl px-4 py-16 text-center">
        <span className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
          <span className={cx('size-2 rounded-full', server === 'online' ? 'bg-emerald-500' : server === 'offline' ? 'bg-red-500' : 'bg-amber-400')} />
          {t(`public.server_${server}`)}
        </span>
        <h1 className="mx-auto mt-5 max-w-2xl text-3xl font-bold tracking-tight sm:text-4xl">{t('public.hero')}</h1>
        <div className="mt-7 flex justify-center gap-3">
          <Link to="/rider/login"><Button variant="primary">{t('public.rider_sign_in_id')}</Button></Link>
          <a href="#modules"><Button>{t('public.see_what')}</Button></a>
        </div>
      </section>
      <section id="modules" className="mx-auto max-w-6xl px-4 pb-14">
        <h2 className="mb-5 text-center text-xl font-semibold">{t('public.what_manages')}</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {modules.map(([Icon, k]) => (
            <div key={k} className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
              <Icon className="mb-3 size-6 text-brand" /><h3 className="font-semibold">{t(k)}</h3><p className="mt-1 text-sm text-zinc-500">{t(`${k}_d`)}</p>
            </div>
          ))}
        </div>
      </section>
      <section className="mx-auto max-w-6xl px-4 pb-16">
        <h2 className="mb-5 text-center text-xl font-semibold">{t('public.org_details')}</h2>
        {!o['org.name'] ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-center dark:border-amber-900 dark:bg-amber-950/30">
            <p>{t('public.not_set_up')}</p><Link to="/setup"><Button className="mt-3">{t('public.open_wizard')}</Button></Link>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-3">
            {panel(t('public.legal'), [[t('org.cr_number'), o['org.cr_number']], [t('org.tax_number'), o['org.tax_number']], [t('org.unified_number'), o['org.unified_number']]])}
            {panel(t('public.contact'), [[t('org.address'), o['org.address']], [t('org.support_email'), o['org.support_email']], [t('org.support_phone'), o['org.support_phone']], [t('org.website'), o['org.website']]])}
            {panel(t('public.status'), [[t('public.server'), t(`public.server_${server}`)], [t('org.version'), o['org.version']], [t('org.currency'), o['org.currency']], [t('org.timezone'), o['org.timezone']]])}
          </div>
        )}
      </section>
      <footer className="border-t border-zinc-200 py-6 text-center text-xs text-zinc-500 dark:border-zinc-800">
        © {new Date().getFullYear()} {o['org.name']} {o['org.cr_number'] && `· ${t('org.cr_number')}: ${o['org.cr_number']}`} {o['org.tax_number'] && `· ${t('org.tax_number')}: ${o['org.tax_number']}`}
      </footer>
    </div>
  );
}
