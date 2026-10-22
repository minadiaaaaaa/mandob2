import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { Eye, EyeOff, RefreshCw } from 'lucide-react';
import { ApiError, get, post } from '../api';
import { useAuth } from '../auth';
import { useI18n } from '../i18n';
import { LangPicker, ThemeToggle } from '../layout';
import { Alert, Button, Field, useErrorText } from '../ui/kit';

type Challenge = { id: string; code: string; ttl: number };

// Sign-in: username or email, password, and the short code shown on this screen.
export default function Login() {
  const { t } = useI18n();
  const { me, refresh, org } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const errText = useErrorText();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [code, setCode] = useState('');
  const [ch, setCh] = useState<Challenge | null>(null);
  const [left, setLeft] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const newCode = useCallback(async () => {
    try { const c = await get<Challenge>('/auth/challenge'); setCh(c); setLeft(c.ttl); setCode(''); }
    catch { setErr(t('err.challenge_failed')); }
  }, [t]);
  useEffect(() => { newCode(); }, [newCode]);
  useEffect(() => {
    if (left <= 0) return;
    const h = setInterval(() => setLeft((l) => l - 1), 1000);
    return () => clearInterval(h);
  }, [left > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  if (me) return <Navigate to={params.get('next') || '/admin'} replace />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password || !code) { setErr(t('err.fill_required')); return; }
    setBusy(true); setErr(null);
    try {
      await post('/auth/login', { username, password, challengeId: ch?.id, code });
      await refresh();
      nav(params.get('next') || '/admin', { replace: true });
    } catch (e) {
      setErr(errText(e));
      // After any rejection the password is cleared and a new code is issued.
      setPassword('');
      const next = e instanceof ApiError ? e.params.challenge : null;
      if (next) { setCh(next); setLeft(next.ttl); setCode(''); } else newCode();
    } finally { setBusy(false); }
  };
  const mm = `${String(Math.floor(Math.max(left, 0) / 60)).padStart(2, '0')}:${String(Math.max(left, 0) % 60).padStart(2, '0')}`;

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-br from-zinc-100 to-zinc-200 dark:from-zinc-950 dark:to-zinc-900">
      <div className="flex justify-end gap-1 p-3"><LangPicker /><ThemeToggle /></div>
      <div className="flex flex-1 items-center justify-center p-4">
        <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-6 shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
          <div className="mb-5 text-center">
            {org?.logos?.logo ? <img src="/api/public/logo/logo" alt="" className="mx-auto mb-3 h-14 object-contain" />
              : <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-xl bg-brand text-lg font-bold text-white">{(org?.['org.name'] || 'L')[0]}</div>}
            <h1 className="text-lg font-semibold">{t('login.title')}</h1>
            <p className="mt-1 text-xs text-zinc-500">{t('login.subtitle')}</p>
          </div>
          <div className="space-y-3">
            <Field label={t('login.username')}><input className="input" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} dir="ltr" /></Field>
            <Field label={t('login.password')}>
              <div className="relative">
              <input className="input ps-9 focus:ring-1 focus:ring-brand/20" type={show ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} dir="ltr" />
                <button type="button" className="absolute end-2 top-1/2 -translate-y-1/2 rounded p-1 text-zinc-400 transition hover:text-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand" aria-label={show ? t('login.hide_password') : t('login.show_password')} aria-pressed={show} title={show ? t('login.hide_password') : t('login.show_password')} onClick={() => setShow(!show)}>
                  {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </Field>
            <div>
              <div className="mb-1 flex items-center justify-between text-xs font-medium text-zinc-700 dark:text-zinc-300">
                <span>{t('login.manual_code')}</span>
                <button type="button" onClick={newCode} className="inline-flex items-center gap-1 text-brand hover:underline"><RefreshCw className="size-3" />{ch ? t('login.new_code') : t('login.get_code')}</button>
              </div>
              <div className="flex gap-2">
                <div className="flex w-36 shrink-0 flex-col items-center justify-center rounded-lg bg-zinc-900 px-2 py-1.5 text-white select-none dark:bg-zinc-800">
                  <span className="font-mono text-lg font-bold tracking-[0.3em]" dir="ltr">{ch?.code ?? '······'}</span>
                  <span className={`text-[10px] ${left <= 15 ? 'text-red-300' : 'text-zinc-400'}`}>{left > 0 ? t('login.expires_in', { time: mm }) : t('login.code_expired')}</span>
                </div>
                <input className="input font-mono uppercase tracking-widest" placeholder={t('login.retype_code')} maxLength={6} value={code} disabled={left <= 0}
                  onChange={(e) => setCode(e.target.value)} dir="ltr" />
              </div>
            </div>
            {err && <Alert tone="red">{err}</Alert>}
            <Button type="submit" variant="primary" className="w-full" loading={busy} disabled={left <= 0}>{busy ? t('login.signing_in') : t('login.sign_in')}</Button>
          </div>
          <p className="mt-4 text-center text-xs text-zinc-500">{t('login.never_share')}</p>
          <p className="mt-1 text-center text-xs"><Link to="/" className="text-brand hover:underline">{t('login.back_to_site')}</Link></p>
        </form>
      </div>
    </div>
  );
}
