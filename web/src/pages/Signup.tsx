import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check } from 'lucide-react';
import { post } from '../api';
import { useAuth } from '../auth';
import { useI18n } from '../i18n';
import { LangPicker, ThemeToggle } from '../layout';
import { Button } from '../ui/kit';
import { Grid, TextInput, useForm } from '../ui/forms';

// A delivery company opens its own account: 14 days free, then it picks a plan.
export default function Signup() {
  const { t } = useI18n();
  const { org } = useAuth();
  const form = useForm<Record<string, string>>({ company_name: '', company_name_en: '', full_name: '', email: '', phone: '', password: '', confirm: '' });
  const [done, setDone] = useState<{ username: string; trial_days: number } | null>(null);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    form.submit(async () => setDone(await post('/public/signup', form.values)));
  };
  const name = org?.['platform.name'] || org?.['org.system_name'] || 'مندوب';

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
        <Link to="/" className="flex items-center gap-2 font-semibold">
          <span className="flex size-8 items-center justify-center rounded-md bg-brand text-sm font-bold text-white">{name[0]}</span>{name}
        </Link>
        <div className="flex items-center gap-1"><LangPicker /><ThemeToggle /></div>
      </header>
      <main className="mx-auto grid max-w-5xl gap-10 px-4 pb-16 pt-6 lg:grid-cols-[1fr_26rem]">
        <section className="order-2 lg:order-1 lg:pt-8">
          <h1 className="text-3xl font-bold leading-tight tracking-tight">{t('signup.headline')}</h1>
          <p className="mt-3 max-w-md text-zinc-600 dark:text-zinc-400">{t('signup.lead')}</p>
          <ul className="mt-8 space-y-3 text-sm">
            {['signup.point_riders', 'signup.point_fleet', 'signup.point_docs', 'signup.point_finance', 'signup.point_portal'].map((k) => (
              <li key={k} className="flex gap-2.5"><Check className="mt-0.5 size-4 shrink-0 text-brand" /><span>{t(k)}</span></li>
            ))}
          </ul>
          <p className="mt-8 border-s-2 border-brand/40 ps-3 text-sm text-zinc-500">{t('signup.trial_note')}</p>
        </section>
        <section className="order-1 lg:order-2">
          <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
            {done ? (
              <div className="py-6 text-center">
                <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-brand/10 text-brand"><Check className="size-6" /></div>
                <h2 className="mt-4 text-lg font-semibold">{t('signup.done_title')}</h2>
                <p className="mt-2 text-sm text-zinc-500">{t('signup.done_body', { days: done.trial_days })}</p>
                <p className="mt-3 text-sm">{t('signup.your_username')} <b dir="ltr" className="font-mono">{done.username}</b></p>
                <Link to={`/admin/login?u=${encodeURIComponent(done.username)}`}><Button variant="primary" className="mt-5 w-full">{t('signup.go_sign_in')}</Button></Link>
              </div>
            ) : (
              <form onSubmit={submit} className="space-y-3">
                <div>
                  <h2 className="text-lg font-semibold">{t('signup.title')}</h2>
                  <p className="mt-0.5 text-xs text-zinc-500">{t('signup.subtitle')}</p>
                </div>
                <TextInput form={form} name="company_name" label={t('signup.company_name')} required />
                <TextInput form={form} name="company_name_en" label={t('signup.company_name_en')} dir="ltr" />
                <TextInput form={form} name="full_name" label={t('signup.full_name')} required />
                <Grid>
                  <TextInput form={form} name="email" label={t('signup.email')} type="email" dir="ltr" required />
                  <TextInput form={form} name="phone" label={t('signup.phone')} dir="ltr" required />
                </Grid>
                <Grid>
                  <TextInput form={form} name="password" label={t('signup.password')} type="password" dir="ltr" required hint={t('signup.password_hint')} />
                  <TextInput form={form} name="confirm" label={t('signup.confirm')} type="password" dir="ltr" required />
                </Grid>
                <Button type="submit" variant="primary" className="w-full" loading={form.busy}>{t('signup.submit')}</Button>
                <p className="text-center text-xs text-zinc-500">{t('signup.have_account')} <Link to="/admin/login" className="font-medium text-brand hover:underline">{t('signup.sign_in')}</Link></p>
              </form>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
