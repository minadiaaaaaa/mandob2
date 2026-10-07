import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, X } from 'lucide-react';
import { ApiError, get } from '../api';
import { useI18n } from '../i18n';
import { Button, Checkbox, cx, Field, useErrorText, useUi } from './kit';

// ---------- form state: only changed fields are sent on edit ----------
export function useForm<T extends Record<string, any>>(initial: T) {
  const [base, setBase] = useState<T>(initial);
  const [values, setValues] = useState<T>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [errorParams, setErrorParams] = useState<Record<string, any>>({});
  const [busy, setBusy] = useState(false);
  const set = useCallback((k: keyof T & string, v: any) => {
    setValues((s) => ({ ...s, [k]: v }));
    setErrors((e) => { if (!e[k]) return e; const n = { ...e }; delete n[k]; return n; });
  }, []);
  const reset = useCallback((v: T) => { setBase(v); setValues(v); setErrors({}); }, []);
  const changed = useMemo(() => Object.keys(values).filter((k) => norm(values[k]) !== norm(base[k])), [values, base]);
  const changes = useMemo(() => Object.fromEntries(changed.map((k) => [k, values[k]])), [changed, values]);
  const errText = useErrorText();
  const { toast } = useUi();
  // Runs a submit; validation errors land under their fields, anything else becomes a toast.
  const submit = useCallback(async <R,>(fn: () => Promise<R>): Promise<R | undefined> => {
    setBusy(true);
    try { return await fn(); }
    catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) { setErrors(e.fields); setErrorParams(e.params); }
      else toast(errText(e), 'red');
      return undefined;
    } finally { setBusy(false); }
  }, [errText, toast]);
  return { values, set, setValues, errors, errorParams, setErrors, reset, changed, changes, busy, submit };
}
const norm = (v: unknown) => (v === undefined || v === null || v === '' ? '' : typeof v === 'boolean' ? (v ? '1' : '0') : String(v));
export type Form = ReturnType<typeof useForm<any>>;

// The error under a field, in the user's language.
export function useFieldError(form: Form) {
  const { t, has } = useI18n();
  return (k: string) => {
    const code = form.errors[k];
    if (!code) return undefined;
    return has(`err.${code}`) ? t(`err.${code}`, form.errorParams) : t('err.invalid');
  };
}

type Base = { form: Form; name: string; label: ReactNode; required?: boolean; hint?: ReactNode; disabled?: boolean; className?: string };
export function TextInput({ form, name, label, required, hint, disabled, className, type = 'text', placeholder, dir, list, maxLength }: Base & { type?: string; placeholder?: string; dir?: 'ltr' | 'rtl'; list?: string; maxLength?: number }) {
  const err = useFieldError(form)(name);
  return (
    <Field label={label} required={required} error={err} hint={hint} className={className}>
      <input className="input" type={type} value={form.values[name] ?? ''} disabled={disabled} placeholder={placeholder} dir={dir} list={list} maxLength={maxLength}
        aria-invalid={!!err} onChange={(e) => form.set(name, e.target.value)} />
    </Field>
  );
}
export function TextArea({ form, name, label, required, hint, disabled, className, rows = 3, maxLength }: Base & { rows?: number; maxLength?: number }) {
  const err = useFieldError(form)(name);
  return (
    <Field label={label} required={required} error={err} hint={hint} className={className}>
      <textarea className="input" rows={rows} maxLength={maxLength} value={form.values[name] ?? ''} disabled={disabled} aria-invalid={!!err} onChange={(e) => form.set(name, e.target.value)} />
    </Field>
  );
}
export function SelectInput({ form, name, label, required, hint, disabled, className, options, empty = true, onChange }: Base & { options: { value: string | number; label: ReactNode; disabled?: boolean }[]; empty?: boolean | string; onChange?: (v: string) => void }) {
  const err = useFieldError(form)(name);
  const { t } = useI18n();
  return (
    <Field label={label} required={required} error={err} hint={hint} className={className}>
      <select className="input" value={form.values[name] ?? ''} disabled={disabled} aria-invalid={!!err}
        onChange={(e) => { form.set(name, e.target.value); onChange?.(e.target.value); }}>
        {empty && <option value="">{typeof empty === 'string' ? empty : t('common.choose')}</option>}
        {options.map((o) => <option key={o.value} value={o.value} disabled={o.disabled}>{o.label as string}</option>)}
      </select>
    </Field>
  );
}
export function CheckInput({ form, name, label, disabled }: { form: Form; name: string; label: ReactNode; disabled?: boolean }) {
  return <Checkbox checked={!!form.values[name] && form.values[name] !== '0'} disabled={disabled} onChange={(v) => form.set(name, v)} label={label} />;
}

// "2 field(s) will be saved" / "Nothing changed" next to the save button of edit screens.
export function SaveBar({ form, label, onCancel, editing = true, extra = 0 }: { form: Form; label?: string; onCancel?: () => void; editing?: boolean; extra?: number }) {
  const { t } = useI18n();
  const n = form.changed.length + extra;
  return (
    <div className="sticky bottom-0 z-10 -mx-4 mt-6 flex flex-wrap items-center justify-end gap-3 border-t border-zinc-200 bg-white/90 px-4 py-3 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90">
      {editing && <span className="text-xs text-zinc-500">{n ? t('form.fields_will_save', { n }) : t('form.nothing_changed')}</span>}
      {onCancel && <Button type="button" onClick={onCancel}>{t('common.cancel')}</Button>}
      <Button type="submit" variant="primary" loading={form.busy} disabled={editing && !n}>{label ?? t('common.save')}</Button>
    </div>
  );
}

// ---------- searchable picker: riders, vehicles... with keyboard support ----------
export type ComboOption = { value: string | number; label: string; sub?: string; disabled?: boolean; note?: string; search?: string };
const fold = (s: string) => s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace(/[أإآ]/g, 'ا').replace(/\s+/g, '').toLowerCase();

export function Combo({ value, onChange, options, placeholder, disabled, countLabel, clearTitle, invalid, onSearch }: {
  value: string | number | null | undefined; onChange: (v: string | number | null) => void; options: ComboOption[]; placeholder?: string; disabled?: boolean;
  countLabel?: (shown: number, total: number) => string; clearTitle?: string; invalid?: boolean; onSearch?: (term: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const [hi, setHi] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const cur = options.find((o) => String(o.value) === String(value ?? ''));
  const shown = useMemo(() => {
    const f = fold(term);
    if (!f) return options;
    // letters joined or separated, digits before or after the letters, Arabic or Latin digits
    return options.filter((o) => {
      const hay = fold(`${o.label} ${o.sub ?? ''} ${o.search ?? ''}`);
      if (hay.includes(f)) return true;
      const digits = f.replace(/\D/g, ''); const letters = f.replace(/\d/g, '');
      return (!digits || hay.includes(digits)) && (!letters || hay.includes(letters));
    });
  }, [options, term]);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  const pick = (o: ComboOption) => { if (o.disabled) return; onChange(o.value); setOpen(false); setTerm(''); };
  return (
    <div ref={box} className="relative">
      <div className={cx('input flex items-center gap-1 p-0', disabled && 'opacity-60')} aria-invalid={invalid}>
        <input className="min-w-0 flex-1 bg-transparent px-3 py-2 outline-none" disabled={disabled}
          placeholder={cur ? cur.label : placeholder} value={open ? term : cur?.label ?? ''}
          onFocus={() => { setOpen(true); setHi(0); }}
          onChange={(e) => { setTerm(e.target.value); setOpen(true); setHi(0); onSearch?.(e.target.value); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(h + 1, shown.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
            else if (e.key === 'Enter') { e.preventDefault(); if (shown[hi]) pick(shown[hi]); }
            else if (e.key === 'Escape') setOpen(false);
          }} />
        {cur && !disabled && <button type="button" title={clearTitle} className="p-1 text-zinc-400 hover:text-zinc-700" onClick={() => onChange(null)}><X className="size-4" /></button>}
        <ChevronDown className="me-2 size-4 text-zinc-400" />
      </div>
      {open && !disabled && (
        <div className="absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-zinc-200 bg-white py-1 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          {shown.slice(0, 200).map((o, i) => (
            <button type="button" key={o.value} disabled={o.disabled} onMouseEnter={() => setHi(i)} onClick={() => pick(o)}
              className={cx('flex w-full items-center justify-between gap-3 px-3 py-1.5 text-start', i === hi && 'bg-zinc-100 dark:bg-zinc-800', o.disabled && 'cursor-not-allowed opacity-50')}>
              <span className="min-w-0"><span className="block truncate">{o.label}</span>{o.sub && <span className="block truncate text-xs text-zinc-500">{o.sub}</span>}</span>
              {o.note && <span className="shrink-0 text-xs text-zinc-500">{o.note}</span>}
            </button>
          ))}
          {countLabel && <div className="border-t border-zinc-100 px-3 py-1.5 text-xs text-zinc-500 dark:border-zinc-800">{countLabel(shown.length, options.length)}</div>}
        </div>
      )}
    </div>
  );
}
export function ComboInput({ form, name, label, required, hint, disabled, className, options, placeholder, countLabel }: Base & { options: ComboOption[]; placeholder?: string; countLabel?: (s: number, tot: number) => string }) {
  const err = useFieldError(form)(name);
  return (
    <Field label={label} required={required} error={err} hint={hint} className={className}>
      <Combo value={form.values[name]} onChange={(v) => form.set(name, v ?? '')} options={options} placeholder={placeholder} disabled={disabled} countLabel={countLabel} invalid={!!err} />
    </Field>
  );
}

// Riders are searched on the server (name, alias, rider id, mobile, ID number); the first 30 matches are listed.
type RiderOpt = { id: number; full_name: string; national_id: string | null; phone: string | null; company_name: string | null; status: string };
export function RiderPicker({ value, onChange, activeOnly, disabled, invalid, placeholder }: {
  value: string | number | null | undefined; onChange: (id: number | null, rider: RiderOpt | null) => void; activeOnly?: boolean; disabled?: boolean; invalid?: boolean; placeholder?: string;
}) {
  const { t } = useI18n();
  const [term, setTerm] = useState('');
  const [rows, setRows] = useState<RiderOpt[]>([]);
  const [picked, setPicked] = useState<RiderOpt | null>(null);
  useEffect(() => {
    const h = setTimeout(() => {
      get<RiderOpt[]>('/riders-options', { search: term, active: activeOnly ? 1 : undefined }).then(setRows).catch(() => setRows([]));
    }, 200);
    return () => clearTimeout(h);
  }, [term, activeOnly]);
  // the chosen rider stays labelled even when a later search no longer lists them
  useEffect(() => {
    if (value && picked?.id !== Number(value)) {
      get<RiderOpt[]>('/riders-options', { search: String(value) }).then((rs) => setPicked(rs.find((x) => String(x.id) === String(value)) ?? null)).catch(() => {});
    }
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const all = picked && !rows.some((r) => r.id === picked.id) ? [picked, ...rows] : rows;
  const options = all.map((r) => ({ value: r.id, label: r.full_name, sub: [`#${r.id}`, r.national_id, r.company_name].filter(Boolean).join(' · '), search: `${r.id} ${r.national_id ?? ''} ${r.phone ?? ''}` }));
  return (
    <Combo value={value} options={options} disabled={disabled} invalid={invalid} placeholder={placeholder ?? t('pick.rider_hint')} onSearch={setTerm} clearTitle={t('common.clear')}
      countLabel={(n) => (n >= 30 ? t('pick.first_30') : '')}
      onChange={(v) => { const r = all.find((x) => String(x.id) === String(v)) ?? null; setPicked(r); onChange(v == null ? null : Number(v), r); }} />
  );
}
export function RiderInput({ form, name, label, required, hint, disabled, className, activeOnly }: Base & { activeOnly?: boolean }) {
  const err = useFieldError(form)(name);
  return (
    <Field label={label} required={required} error={err} hint={hint} className={className}>
      <RiderPicker value={form.values[name]} onChange={(id) => form.set(name, id ?? '')} activeOnly={activeOnly} disabled={disabled} invalid={!!err} />
    </Field>
  );
}

// A table filter on one rider, searched on the server. `name` lets the filter bar know it is in use.
export function RiderFilter({ list, name = 'rider' }: { list: { query: Record<string, string | undefined>; set: (k: string, v: string | null) => void }; name?: string }) {
  const { t } = useI18n();
  return <div className="w-60"><RiderPicker value={list.query[name]} onChange={(id) => list.set(name, id ? String(id) : null)} placeholder={t('adv.rider')} /></div>;
}

export const Grid = ({ children, cols = 2 }: { children: ReactNode; cols?: 2 | 3 | 4 }) => (
  <div className={cx('grid gap-4', cols === 2 ? 'sm:grid-cols-2' : cols === 3 ? 'sm:grid-cols-2 lg:grid-cols-3' : 'sm:grid-cols-2 lg:grid-cols-4')}>{children}</div>
);
