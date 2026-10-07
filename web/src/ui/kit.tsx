import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, Info, Loader2, X, XCircle } from 'lucide-react';
import { ApiError } from '../api';
import { useI18n } from '../i18n';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');
export type Tone = 'green' | 'amber' | 'red' | 'blue' | 'grey' | 'none';

const TONE_TEXT: Record<Tone, string> = {
  green: 'text-emerald-700 dark:text-emerald-400', amber: 'text-amber-700 dark:text-amber-400', red: 'text-red-700 dark:text-red-400',
  blue: 'text-blue-700 dark:text-blue-400', grey: 'text-zinc-500 dark:text-zinc-400', none: '',
};
const TONE_BADGE: Record<Tone, string> = {
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-400',
  amber: 'bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-400',
  red: 'bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-500/10 dark:text-red-400',
  blue: 'bg-blue-50 text-blue-700 ring-blue-600/20 dark:bg-blue-500/10 dark:text-blue-400',
  grey: 'bg-zinc-100 text-zinc-600 ring-zinc-500/20 dark:bg-zinc-800 dark:text-zinc-300',
  none: 'bg-zinc-100 text-zinc-700 ring-zinc-500/10 dark:bg-zinc-800 dark:text-zinc-200',
};
export const toneText = (t: Tone) => TONE_TEXT[t];

// ---------- errors from the API, in the user's language ----------
export function useErrorText() {
  const { t, has } = useI18n();
  return useCallback((e: unknown) => {
    if (e instanceof ApiError) {
      const key = `err.${e.code}`;
      const params = { ...e.params };
      if (params.perm) params.perm = permLabel(t, String(params.perm));
      return has(key) ? t(key, params) : t('err.server_error');
    }
    return t('err.server_error');
  }, [t, has]);
}
export const permLabel = (t: (k: string) => string, perm: string) => {
  const [m, a] = perm.split('.');
  return `${t(`perm.m.${m}`)} › ${t(`perm.a.${a}`)}`;
};

// ---------- basics ----------
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'warn'; size?: 'sm' | 'md'; loading?: boolean; icon?: ReactNode };
export function Button({ variant = 'secondary', size = 'md', loading, icon, className, children, disabled, ...p }: BtnProps) {
  const v = {
    primary: 'bg-brand text-white hover:brightness-110 shadow-sm',
    secondary: 'bg-white text-zinc-800 ring-1 ring-inset ring-zinc-300 hover:bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-100 dark:ring-zinc-700 dark:hover:bg-zinc-800',
    danger: 'bg-red-600 text-white hover:bg-red-700 shadow-sm',
    warn: 'bg-amber-500 text-white hover:bg-amber-600 shadow-sm',
    ghost: 'text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800',
  }[variant];
  return (
    <button {...p} disabled={disabled || loading}
      className={cx('inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap',
        size === 'sm' ? 'px-2.5 py-1.5 text-xs' : 'px-3.5 py-2 text-sm', v, className)}>
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

// Row actions are icons without text; the name shows on hover.
export function IconButton({ title, tone, className, children, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { title: string; tone?: Tone }) {
  return (
    <button {...p} title={title} aria-label={title}
      className={cx('inline-flex size-8 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-40 dark:hover:bg-zinc-800 dark:hover:text-zinc-100 [&_svg]:size-4',
        tone && TONE_TEXT[tone], className)}>
      {children}
    </button>
  );
}

export function Card({ title, actions, children, className, subtitle, pad = true }: { title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children?: ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={cx('rounded-xl border border-zinc-200/80 bg-white shadow-xs dark:border-zinc-800 dark:bg-zinc-900', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 px-4 py-3 dark:border-zinc-800/80">
          <div>
            <h2 className="text-sm font-semibold">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-zinc-500">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={pad ? 'p-4' : ''}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, actions, back }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: string }) {
  const { dir, t } = useI18n();
  const Arrow = dir === 'rtl' ? ArrowRight : ArrowLeft;
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        {back && <Link to={back} className="mb-1.5 inline-flex items-center gap-1 rounded-md text-xs font-medium text-zinc-500 hover:text-brand"><Arrow className="size-3.5" />{t('common.back')}</Link>}
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{title}</h1>
        {subtitle && <div className="mt-1 text-sm text-zinc-500">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Badge({ tone = 'none', children, className, title }: { tone?: Tone; children: ReactNode; className?: string; title?: string }) {
  return <span title={title} className={cx('inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap', TONE_BADGE[tone], className)}>{children}</span>;
}

const TONE_BAR: Record<Tone, string> = {
  green: 'before:bg-emerald-500', amber: 'before:bg-amber-500', red: 'before:bg-red-500', blue: 'before:bg-blue-500', grey: 'before:bg-zinc-400', none: 'before:bg-zinc-200 dark:before:bg-zinc-700',
};
export function StatCard({ label, value, tone = 'none', sub, onClick, active, icon }: { label: ReactNode; value: ReactNode; tone?: Tone; sub?: ReactNode; onClick?: () => void; active?: boolean; icon?: ReactNode }) {
  const Comp = onClick ? 'button' : 'div';
  return (
    <Comp onClick={onClick} className={cx('relative min-w-36 shrink-0 snap-start sm:min-w-0 overflow-hidden rounded-xl border bg-white px-3.5 py-3 text-start shadow-xs transition dark:bg-zinc-900',
      'before:absolute before:inset-y-0 before:start-0 before:w-[3px]', TONE_BAR[tone],
      active ? 'border-brand ring-2 ring-brand/25' : 'border-zinc-200/80 dark:border-zinc-800', onClick && 'cursor-pointer hover:-translate-y-px hover:border-brand/50 hover:shadow-sm')}>
      <div className="flex items-center gap-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400 [&_svg]:size-3.5">{icon}<span className="truncate">{label}</span></div>
      <div className={cx('mt-1 text-xl font-semibold tracking-tight num', TONE_TEXT[tone])}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-zinc-500">{sub}</div>}
    </Comp>
  );
}
// On phones the cards scroll sideways in one row instead of filling the first screen.
export const StatGrid = ({ children }: { children: ReactNode }) => (
  <div className="scroll-thin -mx-4 mb-5 flex snap-x gap-2.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-[repeat(auto-fit,minmax(7.5rem,1fr))] sm:overflow-visible sm:px-0 sm:pb-0">{children}</div>
);
// "Orange if there is anyone" style cards.
export const toneIf = (n: number | undefined, tone: Tone): Tone => (n ? tone : 'none');

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx('size-5 animate-spin text-zinc-400', className)} />;
}
export function Loading() {
  return <div className="flex justify-center py-16"><Spinner className="size-7" /></div>;
}

export function Alert({ tone = 'blue', children, title, action }: { tone?: Tone; children?: ReactNode; title?: ReactNode; action?: ReactNode }) {
  const Icon = tone === 'red' ? XCircle : tone === 'amber' ? AlertTriangle : tone === 'green' ? CheckCircle2 : Info;
  const c = { red: 'border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300',
    amber: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300',
    green: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300',
    blue: 'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300',
    grey: 'border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300', none: '' }[tone];
  return (
    <div className={cx('flex gap-3 rounded-lg border px-3.5 py-3 text-sm', c)}>
      <Icon className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1">{title && <div className="font-medium">{title}</div>}{children}</div>
      {action}
    </div>
  );
}

// ---------- form fields ----------
export function Field({ label, required, error, hint, children, className }: { label: ReactNode; required?: boolean; error?: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx('block', className)}>
      <span className="mb-1 block text-xs font-medium text-zinc-700 dark:text-zinc-300">{label}{required && <span className="ms-0.5 text-red-600">*</span>}</span>
      {children}
      {error ? <span className="mt-1 block text-xs text-red-600">{error}</span> : hint ? <span className="mt-1 block text-xs text-zinc-500">{hint}</span> : null}
    </label>
  );
}
export function Checkbox({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean }) {
  return (
    <label className={cx('inline-flex items-center gap-2 text-sm', disabled ? 'opacity-60' : 'cursor-pointer')}>
      <input type="checkbox" className="size-4 rounded border-zinc-300 accent-[var(--brand)]" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}
export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean }) {
  return (
    <label className={cx('inline-flex items-center gap-2.5 text-sm', disabled ? 'opacity-60' : 'cursor-pointer')}>
      <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}
        className={cx('relative h-5 w-9 shrink-0 rounded-full transition', checked ? 'bg-brand' : 'bg-zinc-300 dark:bg-zinc-700')}>
        <span className={cx('absolute top-0.5 size-4 rounded-full bg-white shadow transition-all', checked ? 'start-[18px]' : 'start-0.5')} />
      </button>
      {label}
    </label>
  );
}

// ---------- dialogs ----------
export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fade-in fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/50 p-4 backdrop-blur-[2px]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" className={cx('pop-in max-h-[90vh] w-full overflow-auto rounded-2xl bg-white shadow-2xl ring-1 ring-zinc-900/5 dark:bg-zinc-900 dark:ring-white/10', wide ? 'max-w-3xl' : 'max-w-md')}>
        <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
          <h3 className="font-semibold">{title}</h3>
          <IconButton title="×" onClick={onClose}><X /></IconButton>
        </div>
        <div className="p-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-zinc-100 px-4 py-3 dark:border-zinc-800">{footer}</div>}
      </div>
    </div>
  );
}

export function SidePanel({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode }) {
  if (!open) return null;
  return (
    <div className="fade-in fixed inset-0 z-40 flex justify-end bg-zinc-950/40" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="slide-in flex h-full w-full max-w-lg flex-col bg-white shadow-2xl dark:bg-zinc-900">
        <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
          <h3 className="font-semibold">{title}</h3>
          <IconButton title="×" onClick={onClose}><X /></IconButton>
        </div>
        <div className="scroll-thin flex-1 overflow-y-auto p-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-zinc-100 px-4 py-3 dark:border-zinc-800">{footer}</div>}
      </aside>
    </div>
  );
}

// ---------- confirmation & toasts (app-wide) ----------
type ConfirmOpts = { title: string; body?: ReactNode; confirm?: string; tone?: 'danger' | 'primary' | 'warn'; input?: { label: string; required?: boolean } };
type Toast = { id: number; tone: Tone; text: ReactNode };
const UiCtx = createContext<{ confirm: (o: ConfirmOpts) => Promise<false | { text: string }>; toast: (text: ReactNode, tone?: Tone) => void }>(null!);

export function UiProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [dlg, setDlg] = useState<(ConfirmOpts & { resolve: (v: false | { text: string }) => void }) | null>(null);
  const [text, setText] = useState('');
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const confirm = useCallback((o: ConfirmOpts) => new Promise<false | { text: string }>((resolve) => { setText(''); setDlg({ ...o, resolve }); }), []);
  const toast = useCallback((text: ReactNode, tone: Tone = 'green') => {
    const id = ++seq.current;
    setToasts((l) => [...l, { id, tone, text }]);
    setTimeout(() => setToasts((l) => l.filter((x) => x.id !== id)), 5000);
  }, []);
  const close = (v: false | { text: string }) => { dlg?.resolve(v); setDlg(null); };
  return (
    <UiCtx.Provider value={{ confirm, toast }}>
      {children}
      <Modal open={!!dlg} onClose={() => close(false)} title={dlg?.title}
        footer={<>
          <Button onClick={() => close(false)}>{t('common.cancel')}</Button>
          <Button variant={dlg?.tone === 'primary' ? 'primary' : dlg?.tone === 'warn' ? 'warn' : 'danger'} disabled={!!dlg?.input?.required && !text.trim()} onClick={() => close({ text })}>
            {dlg?.confirm ?? t('common.confirm')}
          </Button>
        </>}>
        {dlg?.body && <div className="text-sm text-zinc-600 dark:text-zinc-300">{dlg.body}</div>}
        {dlg?.input && (
          <Field label={dlg.input.label} required={dlg.input.required} className="mt-3">
            <textarea className="input min-h-20" value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
        )}
      </Modal>
      <div className="pointer-events-none fixed bottom-4 start-4 z-[60] flex flex-col gap-2">
        {toasts.map((x) => (
          <div key={x.id} className="pop-in pointer-events-auto w-80 max-w-[90vw] rounded-lg shadow-lg"><Alert tone={x.tone}>{x.text}</Alert></div>
        ))}
      </div>
    </UiCtx.Provider>
  );
}
export const useUi = () => useContext(UiCtx);

// Runs an action and shows its error as a toast. Returns undefined when it failed.
export function useAction() {
  const { toast } = useUi();
  const errText = useErrorText();
  return useCallback(async <T,>(fn: () => Promise<T>, okText?: ReactNode): Promise<T | undefined> => {
    try {
      const r = await fn();
      if (okText) toast(okText);
      return r;
    } catch (e) {
      toast(errText(e), 'red');
      return undefined;
    }
  }, [toast, errText]);
}

// ---------- read-only details ----------
export function Details({ rows, cols = 2 }: { rows: [ReactNode, ReactNode, boolean?][]; cols?: 1 | 2 | 3 }) {
  const shown = rows.filter(([, v, always]) => always || (v !== null && v !== undefined && v !== '' && v !== '—'));
  return (
    <dl className={cx('grid gap-x-6 gap-y-3', cols === 1 ? 'grid-cols-1' : cols === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2')}>
      {shown.map(([k, v], i) => (
        <div key={i} className="min-w-0">
          <dt className="text-xs text-zinc-500">{k}</dt>
          <dd className="mt-0.5 break-words text-sm">{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Tabs({ tabs, value, onChange }: { tabs: { key: string; label: ReactNode }[]; value: string; onChange: (k: string) => void }) {
  return (
    <div className="scroll-thin mb-4 flex gap-1 overflow-x-auto border-b border-zinc-200 dark:border-zinc-800">
      {tabs.map((tab) => (
        <button key={tab.key} onClick={() => onChange(tab.key)}
          className={cx('-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition',
            value === tab.key ? 'border-brand text-brand' : 'border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200')}>
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export const useFieldId = () => useId();
