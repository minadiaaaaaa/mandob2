import { useEffect, useState } from 'react';
import { CheckCircle2, Database, Loader2 } from 'lucide-react';
import { get, post } from '../api';
import { LANGS, useI18n } from '../i18n';
import { Alert, Button, Card, cx, Field, Switch, useErrorText } from '../ui/kit';

// "Platform Setup Wizard": six steps, run once before any account exists.
const STEPS = ['database', 'tables', 'platform', 'admin', 'smtp', 'complete'] as const;
const DOCS = [['logo', 'setup.logo'], ['logo_dark', 'setup.logo_dark'], ['cr', 'setup.cr_scan'], ['tax_cert', 'setup.tax_cert'],
  ['municipality', 'setup.municipality'], ['safety', 'setup.safety'], ['health', 'setup.health'], ['favicon', 'setup.favicon']] as const;

export default function Setup() {
  const { t, lang, setLang } = useI18n();
  const errText = useErrorText();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [installed, setInstalled] = useState(false);
  const [db, setDb] = useState({ host: '127.0.0.1', port: '3306', user: 'root', password: '', database: 'logistics' });
  const [tested, setTested] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [ran, setRan] = useState(false);
  const [pf, setPf] = useState<Record<string, string>>({ platform_name: '', default_language: 'ar', currency: 'SAR', timezone: 'Asia/Riyadh', country: 'SA', primary_color: '#0f766e', secondary_color: '#0f172a', tax_label: 'VAT', tax_rate: '15', tax_enabled: '1' });
  const [files, setFiles] = useState<Record<string, File>>({});
  const [admin, setAdmin] = useState({ full_name: '', email: '', password: '', confirm: '' });
  const [smtp, setSmtp] = useState({ host: '', port: '587', encryption: 'starttls', username: '', password: '', sender_name: '', sender_email: '' });
  const [done, setDone] = useState<{ email: string; database: string } | null>(null);

  useEffect(() => {
    get('/setup/status').then((s) => {
      if (s.db) { setDb({ ...s.db, port: String(s.db.port), password: '' }); }
      if (s.admin) setStep(4); else if (s.tables) setStep(2);
    }).catch((e) => { if (e.code === 'already_installed') setInstalled(true); });
  }, []);

  const go = async (fn: () => Promise<unknown>, next?: number) => {
    setBusy(true); setErr(null);
    try { await fn(); if (next !== undefined) setStep(next); }
    catch (e: any) { setErr(e?.params?.detail ? `${errText(e)} — ${e.params.detail}` : errText(e)); }
    finally { setBusy(false); }
  };

  if (installed) {
    return <div className="flex min-h-screen items-center justify-center p-4"><Alert tone="blue" title={t('setup.already_installed')}><a href="/admin" className="text-brand underline">{t('setup.go_dashboard')}</a></Alert></div>;
  }
  const inp = (obj: any, set: any, k: string, type = 'text') => <input className="input" type={type} value={obj[k] ?? ''} onChange={(e) => set({ ...obj, [k]: e.target.value })} dir={type === 'text' ? undefined : 'ltr'} />;

  return (
    <div className="min-h-screen bg-zinc-100 p-4 dark:bg-zinc-950">
      <div className="mx-auto max-w-3xl">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-semibold">{t('setup.title')}</h1>
          <select className="input w-auto" value={lang} onChange={(e) => setLang(e.target.value as any)}>
            {LANGS.filter((l) => l.code !== 'ur').map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
          </select>
        </div>
        <ol className="mb-5 grid grid-cols-6 gap-1 text-center text-xs">
          {STEPS.map((s, i) => (
            <li key={s} className={cx('rounded-lg px-1 py-2', i === step ? 'bg-brand text-white' : i < step ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-white text-zinc-500 dark:bg-zinc-900')}>
              <span className="num">{i + 1}</span>. {t(`setup.step.${s}`)}
            </li>
          ))}
        </ol>
        {err && <div className="mb-3"><Alert tone="red">{err}</Alert></div>}

        {step === 0 && (
          <Card title={t('setup.step.database')}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('setup.host')} required>{inp(db, setDb, 'host')}</Field>
              <Field label={t('setup.port')}>{inp(db, setDb, 'port')}</Field>
              <Field label={t('setup.username')} required>{inp(db, setDb, 'user')}</Field>
              <Field label={t('setup.password')}>{inp(db, setDb, 'password', 'password')}</Field>
              <Field label={t('setup.database_name')} required hint={t('setup.db_created')}>{inp(db, setDb, 'database')}</Field>
            </div>
            <div className="mt-4 flex gap-2">
              <Button icon={<Database className="size-4" />} loading={busy} onClick={() => go(async () => { await post('/setup/db/test', db); setTested(true); })}>{t('setup.test_connection')}</Button>
              <Button variant="primary" disabled={!tested} loading={busy} onClick={() => go(() => post('/setup/db/save', db), 1)}>{t('setup.save_continue')}</Button>
            </div>
            {tested && <div className="mt-3"><Alert tone="green">{t('setup.connection_ok')}</Alert></div>}
          </Card>
        )}

        {step === 1 && (
          <Card title={t('setup.step.tables')}>
            <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-300">{t('setup.tables_intro')}</p>
            <Button variant="primary" loading={busy} onClick={() => go(async () => { const r = await post('/setup/install'); setLog(r.log); setRan(true); })}>{t('setup.create_tables')}</Button>
            {log.length > 0 && (
              <pre className="mt-3 rounded-lg bg-zinc-900 p-3 text-xs text-emerald-300" dir="ltr">{log.map((l) => `✓ ${l}`).join('\n')}{'\n'}{t('setup.tables_ok')}</pre>
            )}
            <div className="mt-4 flex gap-2">
              <Button onClick={() => setStep(0)}>{t('setup.back')}</Button>
              <Button variant="primary" disabled={!ran} onClick={() => setStep(2)}>{t('setup.continue')}</Button>
            </div>
          </Card>
        )}

        {step === 2 && (
          <Card title={t('setup.step.platform')}>
            <div className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t('setup.platform_name')} required>{inp(pf, setPf, 'platform_name')}</Field>
                <Field label={t('setup.company_name')}>{inp(pf, setPf, 'company_name')}</Field>
                <Field label={t('setup.description')} className="sm:col-span-2">{inp(pf, setPf, 'description')}</Field>
                <Field label={t('setup.tax_number')}>{inp(pf, setPf, 'tax_number')}</Field>
                <Field label={t('setup.address')}>{inp(pf, setPf, 'address')}</Field>
                <Field label={t('setup.support_email')}>{inp(pf, setPf, 'support_email', 'email')}</Field>
                <Field label={t('setup.support_phone')}>{inp(pf, setPf, 'support_phone')}</Field>
                <Field label={t('setup.website')}>{inp(pf, setPf, 'website')}</Field>
              </div>
              <div>
                <h3 className="mb-2 text-sm font-semibold">{t('setup.legal_identity')}</h3>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label={t('setup.name_en')}>{inp(pf, setPf, 'name_en')}</Field>
                  <Field label={t('setup.unified_number')}>{inp(pf, setPf, 'unified_number')}</Field>
                  <Field label={t('setup.cr_number')}>{inp(pf, setPf, 'cr_number')}</Field>
                </div>
              </div>
              <div>
                <h3 className="mb-2 text-sm font-semibold">{t('setup.logo_docs')}</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  {DOCS.map(([k, label]) => (
                    <Field key={k} label={t(label)}><input type="file" accept="image/*,application/pdf" className="input py-1.5 text-xs" onChange={(e) => { const f = e.target.files?.[0]; if (f) setFiles({ ...files, [k]: f }); }} /></Field>
                  ))}
                </div>
              </div>
              <div>
                <h3 className="mb-2 text-sm font-semibold">{t('setup.regional')}</h3>
                <div className="grid gap-3 sm:grid-cols-4">
                  <Field label={t('setup.default_language')}>
                    <select className="input" value={pf.default_language} onChange={(e) => setPf({ ...pf, default_language: e.target.value })}>{LANGS.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}</select>
                  </Field>
                  <Field label={t('setup.currency')}>{inp(pf, setPf, 'currency')}</Field>
                  <Field label={t('setup.timezone')}>{inp(pf, setPf, 'timezone')}</Field>
                  <Field label={t('setup.country')}>{inp(pf, setPf, 'country')}</Field>
                </div>
              </div>
              <div>
                <h3 className="mb-2 text-sm font-semibold">{t('setup.appearance_tax')}</h3>
                <div className="grid gap-3 sm:grid-cols-4">
                  <Field label={t('setup.primary_color')}><input type="color" className="input h-10 p-1" value={pf.primary_color} onChange={(e) => setPf({ ...pf, primary_color: e.target.value })} /></Field>
                  <Field label={t('setup.secondary_color')}><input type="color" className="input h-10 p-1" value={pf.secondary_color} onChange={(e) => setPf({ ...pf, secondary_color: e.target.value })} /></Field>
                  <Field label={t('setup.tax_label')}>{inp(pf, setPf, 'tax_label')}</Field>
                  <Field label={t('setup.tax_rate')}>{inp(pf, setPf, 'tax_rate')}</Field>
                </div>
                <div className="mt-2"><Switch checked={pf.tax_enabled === '1'} onChange={(v) => setPf({ ...pf, tax_enabled: v ? '1' : '0' })} label={t('setup.enable_tax')} /></div>
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              <Button onClick={() => setStep(1)}>{t('setup.back')}</Button>
              <Button variant="primary" loading={busy} onClick={() => go(() => {
                const fd = new FormData();
                for (const [k, v] of Object.entries(pf)) if (v) fd.append(k, v);
                for (const [k, f] of Object.entries(files)) fd.append(k, f);
                return post('/setup/platform', fd);
              }, 3)}>{t('setup.save_continue')}</Button>
            </div>
          </Card>
        )}

        {step === 3 && (
          <Card title={t('setup.step.admin')}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('setup.full_name')} required>{inp(admin, setAdmin, 'full_name')}</Field>
              <Field label={t('setup.email')} required hint={t('setup.username_from_email')}>{inp(admin, setAdmin, 'email', 'email')}</Field>
              <Field label={t('setup.password')} required hint={t('setup.password_hint')}>{inp(admin, setAdmin, 'password', 'password')}</Field>
              <Field label={t('setup.confirm_password')} required>{inp(admin, setAdmin, 'confirm', 'password')}</Field>
            </div>
            <div className="mt-4 flex gap-2">
              <Button onClick={() => setStep(2)}>{t('setup.back')}</Button>
              <Button variant="primary" loading={busy} onClick={() => go(() => post('/setup/admin', admin), 4)}>{t('setup.create_admin')}</Button>
            </div>
          </Card>
        )}

        {step === 4 && (
          <Card title={t('setup.step.smtp')}>
            <p className="mb-3 text-sm text-zinc-500">{t('setup.smtp_optional')}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('setup.smtp_server')}>{inp(smtp, setSmtp, 'host')}</Field>
              <Field label={t('setup.port')}>{inp(smtp, setSmtp, 'port')}</Field>
              <Field label={t('setup.encryption')}>
                <select className="input" value={smtp.encryption} onChange={(e) => setSmtp({ ...smtp, encryption: e.target.value })}>
                  <option value="starttls">STARTTLS (587)</option><option value="ssl">SSL/TLS (465)</option><option value="none">—</option>
                </select>
              </Field>
              <Field label={t('setup.username')}>{inp(smtp, setSmtp, 'username')}</Field>
              <Field label={t('setup.password')}>{inp(smtp, setSmtp, 'password', 'password')}</Field>
              <Field label={t('setup.sender_name')}>{inp(smtp, setSmtp, 'sender_name')}</Field>
              <Field label={t('setup.sender_email')}>{inp(smtp, setSmtp, 'sender_email', 'email')}</Field>
            </div>
            <div className="mt-4 flex gap-2">
              <Button onClick={() => setStep(3)}>{t('setup.back')}</Button>
              <Button onClick={() => go(async () => setDone(await post('/setup/complete')), 5)}>{t('setup.skip')}</Button>
              <Button variant="primary" loading={busy} onClick={() => go(async () => { await post('/setup/smtp', smtp); setDone(await post('/setup/complete')); }, 5)}>{t('setup.save_continue')}</Button>
            </div>
          </Card>
        )}

        {step === 5 && (
          <Card>
            <div className="py-6 text-center">
              {busy ? <Loader2 className="mx-auto size-8 animate-spin" /> : <CheckCircle2 className="mx-auto size-12 text-emerald-500" />}
              <h2 className="mt-3 text-lg font-semibold">{t('setup.installed')}</h2>
              {done && <p className="mt-1 text-sm text-zinc-500">{done.email} · {done.database}</p>}
              <a href="/admin/login"><Button variant="primary" className="mt-4">{t('setup.go_dashboard')}</Button></a>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
