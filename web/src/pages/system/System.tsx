import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Download, ExternalLink, KeyRound, Plus, RefreshCw, Trash2, Upload } from 'lucide-react';
import { del, get, patch, post, put } from '../../api';
import { useAuth } from '../../auth';
import { fmtBytes, fmtDateTime, fmtNum, LANGS, useI18n } from '../../i18n';
import { Alert, Badge, Button, Card, Checkbox, cx, Details, Field, IconButton, Loading, Modal, PageHeader, SidePanel, StatCard, StatGrid, Switch, Tabs, useAction, useUi, type Tone } from '../../ui/kit';
import { DataTable, FilterBar, FilterDate, FilterSelect, useList, type Column } from '../../ui/table';
import { ExportButton } from '../../ui/common';

// ======================================================================== settings
const TABS = [
  { key: 'organization', perm: 'organization.view' }, { key: 'platform', perm: 'platform_settings.view' },
  { key: 'system', perm: 'system_settings.view' }, { key: 'private', perm: 'secrets.view' },
] as const;

export function Settings() {
  const { tab } = useParams();
  const { t } = useI18n();
  const { can } = useAuth();
  const nav = useNavigate();
  const tabs = TABS.filter((x) => can(x.perm));
  const cur = (tabs.find((x) => x.key === tab) ?? tabs[0])?.key;
  if (!cur) return <Alert tone="amber">{t('err.forbidden')}</Alert>;
  return (
    <>
      <PageHeader title={t('settings.title')} />
      <Tabs tabs={tabs.map((x) => ({ key: x.key, label: t(`settings.tab.${x.key}`) }))} value={cur} onChange={(k) => nav(`/admin/settings/${k}`)} />
      <p className="mb-4 text-sm text-zinc-500">{t(`settings.intro.${cur}`)}</p>
      {cur === 'organization' && <OrgTab />}
      {cur === 'platform' && <PlatformTab />}
      {cur === 'system' && <SystemTab />}
      {cur === 'private' && <PrivateTab />}
    </>
  );
}

// A group of fields saved together with "{n} unsaved changes", "Discard edits" and "Save changes".
function useGroupForm(path: string) {
  const [base, setBase] = useState<Record<string, string> | null>(null);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [extra, setExtra] = useState<any>(null);
  const load = useCallback(() => get(path).then((r) => { setBase(r.values); setVals(r.values); setExtra(r); }), [path]);
  useEffect(() => { load(); }, [load]);
  const changed = base ? Object.keys(vals).filter((k) => (vals[k] ?? '') !== (base[k] ?? '')) : [];
  return { base, vals, set: (k: string, v: string) => setVals({ ...vals, [k]: v }), changed, discard: () => base && setVals(base), load, extra };
}
function SaveRow({ changed, onSave, onDiscard, busy, readOnly }: { changed: number; onSave: () => void; onDiscard: () => void; busy?: boolean; readOnly?: boolean }) {
  const { t } = useI18n();
  if (readOnly) return <Alert tone="blue">{t('settings.view_only')}</Alert>;
  return (
    <div className="sticky bottom-0 z-10 -mx-4 mt-4 flex items-center justify-end gap-3 border-t border-zinc-200 bg-white/90 px-4 py-3 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90">
      <span className="text-xs text-zinc-500">{t('settings.unsaved', { n: changed })}</span>
      <Button onClick={onDiscard} disabled={!changed}>{t('settings.discard')}</Button>
      <Button variant="primary" onClick={onSave} disabled={!changed} loading={busy}>{t('common.save_changes')}</Button>
    </div>
  );
}
function GroupField({ g, k, label, hint, warn, type = 'text', options, ro }: { g: ReturnType<typeof useGroupForm>; k: string; label: string; hint?: string; warn?: string; type?: string; options?: [string, string][]; ro?: boolean }) {
  const { t } = useI18n();
  const changed = g.changed.includes(k);
  return (
    <Field label={<span className="flex items-center gap-1.5">{label}{changed && <Badge tone="amber">{t('settings.changed')}</Badge>}</span>} hint={warn ? undefined : hint}>
      {type === 'bool' ? <Switch checked={g.vals[k] === '1'} disabled={ro} onChange={(v) => g.set(k, v ? '1' : '0')} />
        : options ? <select className="input" disabled={ro} value={g.vals[k] ?? ''} onChange={(e) => g.set(k, e.target.value)}>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        : type === 'color' ? <input type="color" className="input h-10 p-1" disabled={ro} value={g.vals[k] || '#000000'} onChange={(e) => g.set(k, e.target.value)} />
        : <input className="input" type={type} disabled={ro} value={g.vals[k] ?? ''} onChange={(e) => g.set(k, e.target.value)} />}
      {warn && <span className="mt-1 block text-xs text-amber-700">{warn}</span>}
    </Field>
  );
}
const TIMEZONES = ['Asia/Riyadh', 'Asia/Dubai', 'Asia/Kuwait', 'Asia/Qatar', 'Asia/Bahrain', 'Asia/Muscat', 'Africa/Cairo', 'Asia/Amman', 'Asia/Beirut', 'Asia/Baghdad', 'Europe/Istanbul', 'Asia/Karachi', 'Asia/Dhaka', 'Asia/Kolkata', 'Europe/London', 'UTC'];
const CURRENCIES = ['SAR', 'AED', 'KWD', 'QAR', 'BHD', 'OMR', 'EGP', 'JOD', 'USD', 'EUR', 'GBP', 'PKR', 'BDT', 'INR', 'TRY', 'IQD', 'LBP', 'MAD'];
const DATE_FORMATS = ['YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY', 'DD-MM-YYYY', 'D MMM YYYY'];

function OrgTab() {
  const { t } = useI18n();
  const { can, refreshOrg } = useAuth();
  const run = useAction();
  const g = useGroupForm('/settings/organization');
  const [busy, setBusy] = useState(false);
  if (!g.base) return <Loading />;
  const ro = !can('organization.update');
  const save = async () => {
    setBusy(true);
    const ok = await run(() => patch('/settings/organization', Object.fromEntries(g.changed.map((k) => [k, g.vals[k]]))), t('settings.saved'));
    setBusy(false);
    if (ok) { await g.load(); refreshOrg(); }
  };
  const f = (k: string, label: string, extra: Partial<Parameters<typeof GroupField>[0]> = {}) => <GroupField g={g} k={k} label={t(label)} ro={ro} {...extra} />;
  return (
    <div className="space-y-4">
      <Card title={t('org.sec.identity')}><div className="grid gap-4 sm:grid-cols-2">
        {f('system_name', 'org.system_name', { hint: t('org.system_name_hint') })}{f('version', 'org.version', { hint: t('org.version_hint') })}
        {f('name', 'org.name', { hint: t('org.name_hint') })}{f('name_en', 'org.name_en', { hint: t('org.name_en_hint') })}
      </div></Card>
      <Card title={t('org.sec.legal')}><div className="grid gap-4 sm:grid-cols-3">
        {f('unified_number', 'org.unified_number', { hint: t('org.unified_hint') })}{f('cr_number', 'org.cr_number')}{f('tax_number', 'org.tax_number', { hint: t('org.tax_hint') })}
      </div></Card>
      <Card title={t('org.sec.contact')}><div className="grid gap-4 sm:grid-cols-2">
        {f('support_email', 'org.support_email', { type: 'email' })}{f('support_phone', 'org.support_phone', { hint: t('org.phone_hint') })}
        {f('website', 'org.website', { hint: t('org.website_hint') })}{f('address', 'org.address')}
      </div></Card>
      <Card title={t('org.sec.regional')}><div className="grid gap-4 sm:grid-cols-4">
        {f('default_language', 'org.default_language', { options: LANGS.map((l) => [l.code, l.name]) })}
        {f('timezone', 'org.timezone', { options: TIMEZONES.map((z) => [z, z]) })}
        {f('currency', 'org.currency', { options: CURRENCIES.map((c) => [c, c]) })}
        {f('date_format', 'org.date_format', { options: DATE_FORMATS.map((d) => [d, d]) })}
      </div></Card>
      <Card title={t('org.sec.maintenance')}><div className="space-y-3">
        {f('maintenance', 'org.maintenance', { type: 'bool', warn: t('org.maintenance_warn') })}{f('maintenance_message', 'org.maintenance_message', { hint: t('org.maintenance_msg_hint') })}
      </div></Card>
      <SaveRow changed={g.changed.length} onSave={save} onDiscard={g.discard} busy={busy} readOnly={ro} />
      {can('attachments.view') && <OrgDocuments docs={g.extra?.docs ?? []} reload={async () => { await g.load(); refreshOrg(); }} />}
    </div>
  );
}

const ORG_DOCS: [string, string[]][] = [['visual', ['logo', 'logo_dark', 'favicon']], ['statutory', ['cr', 'tax_cert', 'municipality', 'health', 'safety']], ['other', ['contracts', 'other']]];
function OrgDocuments({ docs, reload }: { docs: any[]; reload: () => void }) {
  const { t } = useI18n();
  const { can } = useAuth();
  const run = useAction();
  const { confirm } = useUi();
  const [busy, setBusy] = useState<string | null>(null);
  const upload = (type: string) => {
    const inp = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/jpeg,image/png,image/webp,image/gif,application/pdf' });
    inp.onchange = async () => {
      const f = inp.files?.[0]; if (!f) return;
      const fd = new FormData(); fd.append('file', f); fd.append('entity_type', 'organization'); fd.append('entity_id', '1'); fd.append('attachment_type', type);
      setBusy(type); if (await run(() => post('/attachments', fd), t('files.uploaded'))) reload(); setBusy(null);
    };
    inp.click();
  };
  return (
    <Card title={t('org.documents')}>
      <div className="space-y-5">{ORG_DOCS.map(([group, types]) => (
        <div key={group}><h3 className="mb-2 text-sm font-semibold">{t(`org.docs.${group}`)}</h3>
          <div className="grid gap-3 md:grid-cols-2">{types.map((type) => {
            const files = docs.filter((d) => d.attachment_type === type);
            const cur = files.find((d) => d.is_current);
            return (
              <div key={type} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
                <div className="flex items-center gap-2"><span className="text-sm font-medium">{t(`org.doc.${type}`)}</span>
                  {can('attachments.upload') && <Button size="sm" className="ms-auto" loading={busy === type} icon={<Upload className="size-3.5" />} onClick={() => upload(type)}>{cur ? t('org.replace_file') : t('org.upload_file')}</Button>}</div>
                <p className="mt-0.5 text-xs text-zinc-500">{t(`org.doc.${type}_hint`)}</p>
                {cur && <div className="mt-2 flex items-center gap-2 text-sm">
                  {cur.mime.startsWith('image/') && <img src={`/api/attachments/${cur.id}/file`} className="h-10 rounded border bg-white object-contain" alt="" />}
                  <span className="min-w-0 flex-1 truncate">{cur.file_name}</span><Badge tone="green">{t('org.published')}</Badge>
                  <a href={`/api/attachments/${cur.id}/file`} target="_blank" rel="noreferrer"><IconButton title={t('files.preview')}><ExternalLink /></IconButton></a>
                  {can('attachments.download') && <a href={`/api/attachments/${cur.id}/file?download=1`}><IconButton title={t('files.download')}><Download /></IconButton></a>}
                  {can('attachments.delete') && <IconButton title={t('files.delete')} tone="red" onClick={async () => { if (await confirm({ title: t('files.delete_q'), confirm: t('files.delete_permanently') }) && await run(() => del(`/attachments/${cur.id}`))) reload(); }}><Trash2 /></IconButton>}
                </div>}
                {files.length > 1 && <details className="mt-2 text-xs"><summary className="cursor-pointer text-zinc-500">{t('org.earlier_versions')}</summary>
                  <ul className="mt-1 space-y-1">{files.filter((d) => !d.is_current).map((d) => <li key={d.id} className="flex items-center gap-2"><span className="flex-1 truncate">{d.file_name} · <span className="num">{fmtDateTime(d.created_at)}</span></span>
                    {can('attachments.upload') && <Button size="sm" variant="ghost" onClick={async () => { if (await run(() => post(`/attachments/${d.id}/current`))) reload(); }}>{t('org.make_current')}</Button>}</li>)}</ul></details>}
              </div>
            );
          })}</div>
        </div>
      ))}</div>
    </Card>
  );
}

function PlatformTab() {
  const { t } = useI18n();
  const { can, refreshOrg } = useAuth();
  const run = useAction();
  const g = useGroupForm('/settings/platform');
  const [busy, setBusy] = useState(false);
  if (!g.base) return <Loading />;
  const ro = !can('platform_settings.update');
  const f = (k: string, extra: Partial<Parameters<typeof GroupField>[0]> = {}) => <GroupField g={g} k={k} label={t(`plat.${k}`)} ro={ro} {...extra} />;
  const org = g.extra?.org ?? {};
  return (
    <div className="space-y-4">
      <Card title={t('plat.sec.appearance')}><div className="grid gap-4 sm:grid-cols-4">{f('name')}{f('tagline')}{f('primary_color', { type: 'color', hint: t('plat.primary_hint') })}{f('secondary_color', { type: 'color' })}</div></Card>
      <Card title={t('plat.sec.regional')}><div className="grid gap-4 sm:grid-cols-3">
        {f('currency', { options: CURRENCIES.map((c) => [c, c]), hint: t('plat.currency_hint') })}{f('locale', { options: LANGS.map((l) => [l.code, l.name]) })}
        {f('timezone', { options: TIMEZONES.map((z) => [z, z]) })}{f('country', { options: ['SA', 'AE', 'KW', 'QA', 'BH', 'OM', 'EG', 'JO', 'LB', 'IQ', 'TR', 'PK', 'BD', 'IN', 'GB', 'US', 'MA'].map((c) => [c, c]) })}
        {f('date_format', { options: DATE_FORMATS.map((d) => [d, d]) })}{f('time_format', { options: [['24', t('plat.24h')], ['12', t('plat.12h')]] })}
        {f('number_format', { options: ['1,234.56', '1.234,56', '1 234,56', '1234.56'].map((d) => [d, d]) })}
      </div></Card>
      <Card title={t('plat.sec.seo')}><div className="grid gap-4 sm:grid-cols-3">{f('meta_title', { hint: t('plat.meta_title_hint') })}{f('meta_keywords')}{f('meta_description', { hint: t('plat.meta_desc_hint') })}</div></Card>
      <Card title={t('plat.sec.registration')}><div className="grid gap-4 sm:grid-cols-3">
        {f('self_registration', { type: 'bool', warn: t('plat.self_reg_warn') })}{f('email_verification', { type: 'bool', hint: t('plat.email_ver_hint') })}{f('two_factor', { type: 'bool', warn: t('plat.two_factor_warn') })}
      </div></Card>
      <Card title={t('plat.sec.security')}>
        <Alert tone="amber">{t('plat.security_warning')}</Alert>
        <div className="mt-3 grid gap-4 sm:grid-cols-3">{f('session_timeout', { type: 'number' })}{f('min_password', { type: 'number' })}{f('max_login_attempts', { type: 'number' })}
          {f('lockout_minutes', { type: 'number' })}{f('max_upload_mb', { type: 'number' })}{f('allowed_file_types')}</div>
      </Card>
      <Card title={t('plat.sec.finance')}><div className="grid gap-4 sm:grid-cols-3">
        {f('tax_enabled', { type: 'bool' })}{f('tax_rate', { type: 'number' })}{f('tax_label')}{f('invoice_prefix')}{f('invoice_start', { type: 'number', warn: t('plat.invoice_warn') })}
      </div></Card>
      <Card title={t('plat.sec.maintenance')}><div className="grid gap-4 sm:grid-cols-2">{f('maintenance', { type: 'bool' })}{f('maintenance_message')}</div></Card>
      <Card title={t('plat.sec.contact')} subtitle={t('plat.contact_note')}><Details cols={3} rows={[[t('org.name'), org.name], [t('org.tax_number'), org.tax_number], [t('org.support_email'), org.support_email], [t('org.support_phone'), org.support_phone], [t('org.website'), org.website], [t('org.address'), org.address]]} /></Card>
      <SaveRow changed={g.changed.length} readOnly={ro} busy={busy} onDiscard={g.discard} onSave={async () => {
        setBusy(true);
        if (await run(() => patch('/settings/platform', Object.fromEntries(g.changed.map((k) => [k, g.vals[k]]))), t('settings.saved'))) { await g.load(); refreshOrg(); }
        setBusy(false);
      }} />
    </div>
  );
}

function SystemTab() {
  const { t, has } = useI18n();
  const { can } = useAuth();
  const run = useAction();
  const [rows, setRows] = useState<any[] | null>(null);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [cat, setCat] = useState('all');
  const [q, setQ] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => get('/settings/system').then((r) => { setRows(r); setVals(Object.fromEntries(r.map((x: any) => [x.key, x.value ?? '']))); setErrors({}); }), []);
  useEffect(() => { load(); }, [load]);
  const changed = useMemo(() => (rows ?? []).filter((r) => (vals[r.key] ?? '') !== (r.value ?? '')).map((r) => r.key), [rows, vals]);
  if (!rows) return <Loading />;
  const ro = !can('system_settings.update');
  const cats = [...new Set(rows.map((r) => r.category))];
  const shown = rows.filter((r) => (cat === 'all' || r.category === cat) && (!q || r.key.includes(q.toLowerCase())));
  return (
    <div>
      <Alert tone="amber" title={t('sys.before_edit')}>{t('sys.before_edit_text')}</Alert>
      <div className="my-3 flex flex-wrap items-center gap-1">
        {['all', ...cats].map((c) => <button key={c} onClick={() => setCat(c)} className={cx('rounded-full px-3 py-1 text-xs ring-1 ring-inset', cat === c ? 'bg-brand text-white ring-brand' : 'bg-white ring-zinc-300 dark:bg-zinc-900 dark:ring-zinc-700')}>{c === 'all' ? t('common.all') : has(`sys.cat.${c}`) ? t(`sys.cat.${c}`) : c}</button>)}
        <input className="input ms-auto w-60 py-1.5" placeholder={t('sys.search_key')} value={q} onChange={(e) => setQ(e.target.value)} dir="ltr" />
      </div>
      <Card pad={false}>
        <table className="w-full text-sm"><thead className="bg-zinc-50 text-xs text-zinc-500 dark:bg-zinc-900"><tr><th className="px-3 py-2 text-start">{t('sys.key')}</th><th className="px-3 py-2 text-start">{t('sys.description')}</th><th className="px-3 py-2 text-start">{t('sys.type')}</th><th className="w-72 px-3 py-2 text-start">{t('sys.value')}</th></tr></thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">{shown.map((r) => (
            <tr key={r.key} className="align-top">
              <td className="px-3 py-2 font-mono text-xs" dir="ltr">{r.key}{changed.includes(r.key) && <Badge tone="amber" className="ms-1">{t('settings.changed')}</Badge>}{!r.editable && <Badge className="ms-1">{t('sys.not_editable')}</Badge>}</td>
              <td className="px-3 py-2 text-xs text-zinc-600 dark:text-zinc-300">{has(`sys.d.${r.key}`) ? t(`sys.d.${r.key}`) : r.description}</td>
              <td className="px-3 py-2 text-xs">{t(`sys.t.${r.type}`)}</td>
              <td className="px-3 py-2">
                {r.type === 'bool' ? <Switch checked={vals[r.key] === '1'} disabled={ro || !r.editable} onChange={(v) => setVals({ ...vals, [r.key]: v ? '1' : '0' })} />
                  : r.type === 'json' ? <textarea className="input font-mono text-xs" dir="ltr" disabled={ro || !r.editable} value={vals[r.key]} onChange={(e) => setVals({ ...vals, [r.key]: e.target.value })} />
                  : <input className="input py-1.5 font-mono text-xs" dir="ltr" disabled={ro || !r.editable} value={vals[r.key]} aria-invalid={!!errors[r.key]} onChange={(e) => setVals({ ...vals, [r.key]: e.target.value })} />}
                <span className={cx('mt-0.5 block text-[11px]', errors[r.key] ? 'text-red-600' : 'text-zinc-500')}>{errors[r.key] ? t(`err.${errors[r.key]}`) : t(`sys.hint.${r.key.endsWith('_cron') ? 'cron' : r.type}`)}</span>
              </td>
            </tr>
          ))}</tbody></table>
      </Card>
      <SaveRow changed={changed.length} readOnly={ro} busy={busy} onDiscard={() => setVals(Object.fromEntries(rows.map((x) => [x.key, x.value ?? ''])))} onSave={async () => {
        setBusy(true);
        try { await patch('/settings/system', { values: Object.fromEntries(changed.map((k) => [k, vals[k]])) }); await load(); run(async () => true, t('settings.saved')); }
        catch (e: any) { setErrors(e.fields ?? {}); run(() => Promise.reject(e)); }
        finally { setBusy(false); }
      }} />
    </div>
  );
}

function PrivateTab() {
  const { t } = useI18n();
  const { can } = useAuth();
  const run = useAction();
  const { confirm } = useUi();
  const [rows, setRows] = useState<any[] | null>(null);
  const [edit, setEdit] = useState<null | { name: string; value: string; description: string; encrypted: boolean; locked: boolean }>(null);
  const load = useCallback(() => get('/settings/private').then(setRows), []);
  useEffect(() => { load(); }, [load]);
  if (!rows) return <Loading />;
  return (
    <div className="space-y-3">
      <Alert tone="amber" title={t('keys.sensitive')}>{t('keys.sensitive_text')}</Alert>
      <Card title={t('keys.recorded')} actions={<><Button size="sm" icon={<RefreshCw className="size-3.5" />} onClick={load}>{t('common.refresh')}</Button>
        {can('secrets.create') && <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setEdit({ name: '', value: '', description: '', encrypted: true, locked: false })}>{t('keys.add')}</Button>}</>}>
        {!rows.length ? <p className="text-sm text-zinc-500">{t('table.no_records')}</p> : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">{rows.map((r) => (
            <li key={r.name} className="flex flex-wrap items-center gap-2 py-2.5">
              <KeyRound className="size-4 text-zinc-400" /><span className="font-mono text-sm" dir="ltr">{r.name}</span>
              {!!r.encrypted && <Badge tone="blue">{t('keys.encrypted')}</Badge>}<Badge tone={r.is_set ? 'green' : 'amber'}>{r.is_set ? t('keys.set') : t('keys.not_set')}</Badge>
              <span className="text-xs text-zinc-500">{r.description}</span><span className="ms-auto text-xs text-zinc-500">{t('keys.updated')}: <span className="num">{fmtDateTime(r.updated_at)}</span></span>
              {can('secrets.update') && <Button size="sm" onClick={() => setEdit({ name: r.name, value: '', description: r.description ?? '', encrypted: !!r.encrypted, locked: true })}>{t('keys.replace')}</Button>}
              {can('secrets.delete') && <Button size="sm" variant="ghost" className="text-red-600" onClick={async () => { if (await confirm({ title: t('keys.delete_q'), confirm: t('files.delete_permanently') }) && await run(() => del(`/settings/private/${encodeURIComponent(r.name)}`))) load(); }}>{t('common.delete')}</Button>}
            </li>
          ))}</ul>
        )}
      </Card>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.locked ? t('keys.replace') : t('keys.add')} footer={<><Button onClick={() => setEdit(null)}>{t('common.cancel')}</Button>
        <Button variant="primary" disabled={!edit?.name || !edit?.value} onClick={async () => { if (await run(() => put(`/settings/private/${encodeURIComponent(edit!.name)}`, edit), t('keys.saved'))) { setEdit(null); load(); } }}>{t('common.save_changes')}</Button></>}>
        {edit && <div className="space-y-3">
          <Field label={t('keys.name')} required hint={t('keys.name_hint')}><input className="input font-mono" dir="ltr" disabled={edit.locked} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
          <Field label={t('keys.new_value')} required><input className="input font-mono" dir="ltr" type="password" autoComplete="off" value={edit.value} onChange={(e) => setEdit({ ...edit, value: e.target.value })} /></Field>
          <Field label={t('keys.description')} hint={t('keys.description_hint')}><input className="input" value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></Field>
          <Checkbox checked={edit.encrypted} onChange={(v) => setEdit({ ...edit, encrypted: v })} label={t('keys.encrypt')} />
        </div>}
      </Modal>
    </div>
  );
}

// ======================================================================== attachments
export function AttachmentsIndex() {
  const { t } = useI18n();
  const { can } = useAuth();
  const run = useAction();
  const { confirm } = useUi();
  const list = useList('/attachments-index');
  const s = list.stats ?? { top: [] };
  const f = list.data?.facets ?? { entity_types: [], attachment_types: [] };
  const columns: Column<any>[] = [
    { key: 'file', header: t('att.file'), sort: 'file', render: (r) => <div className="flex items-center gap-2">
      {r.mime.startsWith('image/') ? <img src={`/api/attachments/${r.id}/file`} className="size-9 rounded border object-cover" alt="" loading="lazy" /> : <span className="flex size-9 items-center justify-center rounded border text-[10px] font-bold text-red-600">PDF</span>}
      <div className="min-w-0"><div className="truncate">{r.file_name}</div>{r.note && <div className="truncate text-xs text-zinc-500">{r.note}</div>}</div></div> },
    { key: 'record', header: t('att.record'), render: (r) => <div><span className="num">#{r.entity_id}</span><div className="text-xs text-zinc-500">{t(`att.type.${r.entity_type}`)}</div></div> },
    { key: 'type', header: t('att.attachment_type'), render: (r) => (r.attachment_type ? t(`org.doc.${r.attachment_type}`) : '—') },
    { key: 'size', header: t('att.size'), sort: 'size', render: (r) => <span className="num">{fmtBytes(r.size)}</span> },
    { key: 'current', header: t('att.current'), render: (r) => (r.is_current ? <Badge tone="green">{t('files.current')}</Badge> : '—') },
    { key: 'uploaded', header: t('att.uploaded'), sort: 'uploaded', render: (r) => <span className="num text-xs">{fmtDateTime(r.created_at)}</span> },
    { key: 'actions', header: t('common.actions'), render: (r) => <div className="flex">
      <a href={`/api/attachments/${r.id}/file`} target="_blank" rel="noreferrer"><IconButton title={t('files.preview')}><ExternalLink /></IconButton></a>
      {can('attachments.download') && <a href={`/api/attachments/${r.id}/file?download=1`}><IconButton title={t('files.download')}><Download /></IconButton></a>}
      {can('attachments.delete') && <IconButton title={t('files.delete')} tone="red" onClick={async () => { if (await confirm({ title: t('att.delete_q', { name: r.file_name }) }) && await run(() => del(`/attachments/${r.id}`), t('files.deleted'))) list.reload(); }}><Trash2 /></IconButton>}</div> },
  ];
  return (
    <>
      <PageHeader title={t('att.title')} />
      <StatGrid>
        <StatCard label={t('att.files')} value={fmtNum(s.files)} /><StatCard label={t('att.space')} value={fmtBytes(Number(s.bytes) || 0)} />
        {s.top.map((x: any) => <StatCard key={x.entity_type} label={t(`att.type.${x.entity_type}`)} value={fmtNum(x.files)} sub={fmtBytes(Number(x.bytes))} />)}
      </StatGrid>
      <FilterBar list={list} placeholder={t('att.search_hint')}>
        <FilterSelect list={list} name="entity_type" label={t('att.record_type')} options={f.entity_types.map((v: string) => ({ value: v, label: t(`att.type.${v}`) }))} />
        <FilterSelect list={list} name="attachment_type" label={t('att.attachment_type')} options={f.attachment_types.map((v: string) => ({ value: v, label: t(`org.doc.${v}`) }))} />
        <FilterSelect list={list} name="kind" label={t('att.kind')} options={[{ value: 'image', label: t('att.images') }, { value: 'pdf', label: t('att.pdfs') }]} />
        <FilterSelect list={list} name="current" label={t('att.current')} options={[{ value: 'current', label: t('att.current_only') }, { value: 'not', label: t('att.not_current') }]} />
        <FilterDate list={list} name="from" label={t('common.from_date')} /><FilterDate list={list} name="to" label={t('common.to_date')} />
      </FilterBar>
      <DataTable list={list} columns={columns} />
    </>
  );
}

// ======================================================================== activity log
const SEV: Record<string, Tone> = { info: 'blue', warning: 'amber', error: 'red', critical: 'red' };
export function AuditLog() {
  const { t } = useI18n();
  const { can } = useAuth();
  const list = useList('/logs/audit');
  const [open, setOpen] = useState<any>(null);
  const [all, setAll] = useState(false);
  const f = list.data?.facets ?? { actions: [], entity_types: [] };
  const columns: Column<any>[] = [
    { key: 'time', header: t('audit.time'), sort: 'time', render: (r) => <span className="num text-xs">{fmtDateTime(r.created_at)}</span> },
    { key: 'action', header: t('audit.action'), render: (r) => <span className="font-mono text-xs" dir="ltr">{r.action}</span> },
    { key: 'actor', header: t('audit.actor'), render: (r) => <div>{r.actor_name ?? '—'}<div className="text-xs text-zinc-500">{t(`audit.actor.${r.actor_type}`)}</div></div> },
    { key: 'record', header: t('audit.record'), render: (r) => <span className="font-mono text-xs" dir="ltr">{r.entity_type ? `${r.entity_type} #${r.entity_id ?? ''}` : '—'}</span> },
    { key: 'status', header: t('audit.status'), render: (r) => <Badge tone={r.status === 'success' ? 'green' : 'red'}>{t(`audit.st.${r.status}`)}</Badge> },
    { key: 'severity', header: t('audit.severity'), render: (r) => <Badge tone={SEV[r.severity]}>{t(`audit.sev.${r.severity}`)}</Badge> },
    { key: 'ip', header: t('audit.ip'), render: (r) => <span className="num text-xs">{r.ip}</span> },
  ];
  const diff = useMemo(() => {
    if (!open) return [];
    const b = (typeof open.before_json === 'string' ? JSON.parse(open.before_json) : open.before_json) ?? {};
    const a = (typeof open.after_json === 'string' ? JSON.parse(open.after_json) : open.after_json) ?? {};
    return [...new Set([...Object.keys(b), ...Object.keys(a)])].map((k) => ({ k, b: b[k], a: a[k], kind: !(k in b) ? 'added' : !(k in a) ? 'removed' : JSON.stringify(b[k]) !== JSON.stringify(a[k]) ? 'changed' : 'same' }));
  }, [open]);
  return (
    <>
      <PageHeader title={t('audit.title')} actions={can('audit_log.export', 'logs.export') && <ExportButton path="/logs/audit/export" query={list.query} label={t('common.export_csv')} />} />
      <FilterBar list={list} placeholder={t('audit.search_hint')}>
        <FilterSelect list={list} name="action" label={t('audit.action')} options={f.actions.map((v: string) => ({ value: v, label: v }))} />
        <FilterSelect list={list} name="entity_type" label={t('audit.record_type')} options={f.entity_types.map((v: string) => ({ value: v, label: v }))} />
        <FilterSelect list={list} name="severity" label={t('audit.severity')} options={Object.keys(SEV).map((v) => ({ value: v, label: t(`audit.sev.${v}`) }))} />
        <FilterSelect list={list} name="status" label={t('audit.status')} options={['success', 'failed', 'error', 'pending', 'denied'].map((v) => ({ value: v, label: t(`audit.st.${v}`) }))} />
        <FilterSelect list={list} name="actor_type" label={t('audit.actor_type')} options={['user', 'system', 'api', 'guest', 'job'].map((v) => ({ value: v, label: t(`audit.actor.${v}`) }))} />
        <FilterDate list={list} name="from" label={t('common.from_date')} /><FilterDate list={list} name="to" label={t('common.to_date')} />
      </FilterBar>
      <DataTable list={list} columns={columns} onRowClick={(r) => get(`/logs/audit/${r.id}`).then((x) => { setAll(false); setOpen(x); })} />
      <SidePanel open={!!open} onClose={() => setOpen(null)} title={t('audit.details')}>
        {open && <div className="space-y-4">
          <Details cols={1} rows={[[t('audit.time'), fmtDateTime(open.created_at)], [t('audit.action'), <span className="font-mono" dir="ltr">{open.action}</span>], [t('audit.actor'), open.actor_name],
            [t('audit.record'), open.entity_type && `${open.entity_type} #${open.entity_id ?? ''}`], [t('audit.ip'), open.ip], [t('audit.route'), <span className="font-mono text-xs" dir="ltr">{open.route}</span>],
            [t('audit.request_id'), open.request_id], [t('audit.browser'), open.user_agent], [t('audit.details_text'), open.details]]} />
          {diff.length > 0 && <div>
            <h4 className="mb-2 text-sm font-semibold">{t('audit.what_changed')}</h4>
            <table className="w-full text-xs"><thead><tr className="text-zinc-500"><th className="text-start">{t('audit.field')}</th><th className="text-start">{t('audit.before')}</th><th className="text-start">{t('audit.after')}</th></tr></thead>
              <tbody>{diff.filter((d) => all || d.kind !== 'same').map((d) => (
                <tr key={d.k} className="border-t border-zinc-100 align-top dark:border-zinc-800"><td className="py-1 font-mono" dir="ltr">{d.k} {d.kind !== 'same' && <Badge tone={d.kind === 'added' ? 'green' : d.kind === 'removed' ? 'red' : 'amber'}>{t(`audit.${d.kind}`)}</Badge>}</td>
                  <td className="py-1 break-all" dir="ltr">{d.b === undefined ? '' : JSON.stringify(d.b)}</td><td className="py-1 break-all" dir="ltr">{d.a === undefined ? '' : JSON.stringify(d.a)}</td></tr>
              ))}</tbody></table>
            {!all && diff.some((d) => d.kind === 'same') && <Button size="sm" variant="ghost" onClick={() => setAll(true)}>{t('audit.show_unchanged', { n: diff.filter((d) => d.kind === 'same').length })}</Button>}
          </div>}
        </div>}
      </SidePanel>
    </>
  );
}

// ======================================================================== login attempts
export function LoginAttempts() {
  const { t } = useI18n();
  const { can } = useAuth();
  const list = useList('/logs/login');
  const s = list.stats ?? { busiest: [] };
  const columns: Column<any>[] = [
    { key: 'time', header: t('login.at'), sort: 'time', render: (r) => <span className="num text-xs">{fmtDateTime(r.created_at)}</span> },
    { key: 'status', header: t('login.status'), render: (r) => <Badge tone={r.success ? 'green' : 'red'}>{r.success ? t('login.success') : t('login.failed')}</Badge> },
    { key: 'account', header: t('login.account'), render: (r) => r.full_name ? <div>{r.full_name}<div className="text-xs text-zinc-500" dir="ltr">{r.username}</div></div> : <div><span dir="ltr">{r.username_typed}</span> <Badge tone="amber">{t('login.no_such')}</Badge></div> },
    { key: 'reason', header: t('login.reason'), render: (r) => <span className="font-mono text-xs" dir="ltr" title={r.reason ? t(`login.r.${r.reason}`) : ''}>{r.reason ?? ''}</span> },
    { key: 'ip', header: t('login.ip'), render: (r) => <span className="num">{r.ip}</span> },
    { key: 'device', header: t('login.device'), render: (r) => <span className="line-clamp-1 max-w-56 text-xs" title={r.user_agent}>{r.user_agent}</span> },
  ];
  return (
    <>
      <PageHeader title={t('login.log_title')} actions={can('login_log.export') && <ExportButton path="/logs/login/export" query={list.query} label={t('common.export_csv')} />} />
      <div className="mb-5 grid gap-3 sm:grid-cols-4">
        <StatCard label={t('login.s.success')} value={fmtNum(s.success)} tone="green" sub={t('login.last30')} />
        <StatCard label={t('login.s.failed')} value={fmtNum(s.failed)} tone={s.failed ? 'red' : 'none'} sub={t('login.last30')} />
        <StatCard label={t('login.s.ips')} value={fmtNum(s.ips)} />
        <Card title={t('login.busiest')}><ul className="space-y-1 text-xs">{s.busiest.map((b: any) => <li key={b.ip} className="flex justify-between gap-2"><span className="num">{b.ip}</span><span className="num">{b.attempts} / <span className="text-red-600">{b.failed}</span></span></li>)}</ul></Card>
      </div>
      <FilterBar list={list} placeholder={t('login.search_hint')}>
        <FilterSelect list={list} name="status" label={t('login.status')} options={[{ value: 'success', label: t('login.success') }, { value: 'failed', label: t('login.failed') }]} />
        <FilterDate list={list} name="from" label={t('common.from_date')} /><FilterDate list={list} name="to" label={t('common.to_date')} />
      </FilterBar>
      <DataTable list={list} columns={columns} />
    </>
  );
}
