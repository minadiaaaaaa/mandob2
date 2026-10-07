import { useEffect, useRef, useState } from 'react';
import { Lock, Plus, RefreshCw, Send } from 'lucide-react';
import { del, get, patch, post, put } from '../../api';
import { useAuth } from '../../auth';
import { fmtDateTime, fmtNum, useI18n } from '../../i18n';
import { Alert, Badge, Button, Card, Checkbox, cx, Details, Field, Loading, PageHeader, SidePanel, Switch, Tabs, useAction, useErrorText, useUi, type Tone } from '../../ui/kit';
import { DataTable, FilterBar, FilterDate, FilterSelect, useList } from '../../ui/table';
import { ExportButton } from '../../ui/common';

const PROVIDERS: Record<string, { host: string; port: number; encryption: string }> = {
  gmail: { host: 'smtp.gmail.com', port: 587, encryption: 'starttls' }, zoho_sa: { host: 'smtp.zoho.sa', port: 587, encryption: 'starttls' },
  zoho: { host: 'smtp.zoho.com', port: 587, encryption: 'starttls' }, microsoft: { host: 'smtp.office365.com', port: 587, encryption: 'starttls' },
};

export function EmailScreen() {
  const { t } = useI18n();
  const { can } = useAuth();
  const tabs = [can('email_templates.view') && { key: 'templates', label: t('mail.tab_templates') }, can('smtp.view') && { key: 'smtp', label: t('mail.tab_smtp') },
    can('email_templates.view', 'smtp.view') && { key: 'branding', label: t('mail.tab_branding') }].filter(Boolean) as { key: string; label: string }[];
  const [tab, setTab] = useState(tabs[0]?.key ?? 'templates');
  return (
    <>
      <PageHeader title={t('mail.title')} />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'templates' && <Templates />}
      {tab === 'smtp' && <div className="grid gap-4 xl:grid-cols-2"><Smtp account="system" /><Smtp account="riders" /></div>}
      {tab === 'branding' && <Branding />}
    </>
  );
}

// ---------- templates ----------
function Templates() {
  const { t } = useI18n();
  const { can } = useAuth();
  const run = useAction();
  const { confirm, toast } = useUi();
  const errText = useErrorText();
  const [all, setAll] = useState<any[]>([]);
  const [term, setTerm] = useState('');
  const [key, setKey] = useState<string | null>(null);
  const [tpl, setTpl] = useState<any>(null);
  const [draft, setDraft] = useState<any>(null);
  const [sample, setSample] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null);
  const [to, setTo] = useState('');
  const [creating, setCreating] = useState(false);
  const body = useRef<HTMLTextAreaElement>(null);
  const loadAll = () => get('/email/templates').then((x) => { setAll(x); if (!key && x[0]) setKey(x[0].tkey); });
  useEffect(() => { loadAll(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const load = () => key && get(`/email/templates/${key}`).then((x) => { setTpl(x); setDraft({ name: x.name, subject: x.subject, body_html: x.body_html, placeholders: x.placeholders ?? '' }); setPreview(null); });
  useEffect(() => { load(); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const edit = can('email_templates.update');
  const insert = (p: string) => {
    const el = body.current; if (!el || !draft) return;
    const s = el.selectionStart; const v = `${draft.body_html.slice(0, s)}{${p}}${draft.body_html.slice(el.selectionEnd)}`;
    setDraft({ ...draft, body_html: v });
  };
  const shown = all.filter((x) => !term || `${x.name} ${x.tkey}`.toLowerCase().includes(term.toLowerCase()));
  const declared = (tpl?.placeholders ?? '').split(',').map((s: string) => s.trim()).filter(Boolean);
  return (
    <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
      <Card pad={false}>
        <div className="space-y-2 border-b border-zinc-100 p-3 dark:border-zinc-800">
          <div className="flex items-center justify-between text-xs text-zinc-500">{t('mail.n_templates', { count: all.length })}
            {can('email_templates.create') && <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setCreating(true)}>{t('mail.new_template')}</Button>}</div>
          <input type="search" className="input" placeholder={t('table.search')} value={term} onChange={(e) => setTerm(e.target.value)} />
        </div>
        <ul className="scroll-thin max-h-[70vh] divide-y divide-zinc-100 overflow-y-auto dark:divide-zinc-800">{shown.map((x) => (
          <li key={x.tkey}><button onClick={() => setKey(x.tkey)} className={cx('w-full px-3 py-2 text-start text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800/50', key === x.tkey && 'bg-brand-soft')}>
            <div className="font-medium">{x.name}</div><div className="mt-0.5 flex flex-wrap gap-1"><Badge tone={x.is_active ? 'green' : 'grey'}>{x.is_active ? t('common.active') : t('common.inactive')}</Badge>{x.is_system ? <Badge tone="blue">{t('mail.system')}</Badge> : null}</div>
          </button></li>))}</ul>
      </Card>
      {!tpl || !draft ? <Loading /> : (
        <div className="space-y-4">
          <Card title={tpl.name} subtitle={<code dir="ltr">{tpl.tkey}</code>} actions={<>
            {(tpl.is_active ? can('email_templates.deactivate') : can('email_templates.activate')) && !tpl.is_required && <Button size="sm" variant="warn" onClick={async () => {
              if (await run(() => post(`/email/templates/${key}/${tpl.is_active ? 'deactivate' : 'activate'}`), t('common.saved'))) { load(); loadAll(); } }}>{tpl.is_active ? t('common.deactivate') : t('common.activate')}</Button>}
            {tpl.is_required ? <Badge tone="grey"><Lock className="size-3" /> {t('mail.always_sent')}</Badge> : null}
            {can('email_templates.delete') && !tpl.is_system && <Button size="sm" variant="danger" onClick={async () => {
              if (!(await confirm({ title: t('mail.delete_q') }))) return; if (await run(() => del(`/email/templates/${key}`), t('common.deleted'))) { setKey(null); loadAll(); } }}>{t('mail.delete_template')}</Button>}
          </>}>
            <div className="space-y-3">
              <Field label={t('mail.name')} required><input className="input" disabled={!edit} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
              <Field label={t('mail.subject')} required><input className="input" dir="auto" disabled={!edit} value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} /></Field>
              <Field label={t('mail.body')} required hint={t('mail.body_hint')}><textarea ref={body} className="input font-mono text-xs" rows={10} dir="auto" disabled={!edit} value={draft.body_html} onChange={(e) => setDraft({ ...draft, body_html: e.target.value })} /></Field>
              {edit && <div className="flex gap-2"><Button variant="primary" onClick={async () => { if (await run(() => patch(`/email/templates/${key}`, draft), t('mail.saved'))) { load(); loadAll(); } }}>{t('common.save')}</Button>
                <Button variant="ghost" onClick={load}>{t('mail.discard')}</Button></div>}
            </div>
          </Card>
          <div className="grid gap-4 xl:grid-cols-2">
            <Card title={t('mail.placeholders')}>
              <div className="flex flex-wrap gap-1">{declared.map((p: string) => <button key={p} disabled={!edit} onClick={() => insert(p)} className="rounded-md bg-zinc-100 px-2 py-1 font-mono text-xs hover:bg-brand-soft dark:bg-zinc-800" dir="ltr">{`{${p}}`}</button>)}</div>
              <ul className="mt-3 space-y-1 text-xs">
                <li><Badge tone="green">{t('mail.ph.both')}</Badge> <span dir="ltr">{tpl.check.both.join(', ') || '—'}</span></li>
                <li><Badge tone="amber">{t('mail.ph.unused')}</Badge> <span dir="ltr">{tpl.check.unused.join(', ') || '—'}</span></li>
                <li><Badge tone="red">{t('mail.ph.undeclared')}</Badge> <span dir="ltr">{tpl.check.undeclared.join(', ') || '—'}</span></li>
              </ul>
            </Card>
            <Card title={t('mail.sample')} actions={<Button size="sm" variant="ghost" onClick={() => setSample({})}>{t('mail.clear_values')}</Button>}>
              <div className="grid grid-cols-2 gap-2">{declared.map((p: string) => <Field key={p} label={<code dir="ltr">{p}</code>}><input className="input" value={sample[p] ?? ''} onChange={(e) => setSample({ ...sample, [p]: e.target.value })} /></Field>)}</div>
              <Button size="sm" className="mt-3" icon={<RefreshCw className="size-3.5" />} onClick={async () => setPreview(await post(`/email/templates/${key}/preview`, { vars: sample }))}>{t('mail.refresh_preview')}</Button>
            </Card>
          </div>
          {preview && <Card title={t('mail.preview')}><div className="mb-2 text-sm"><span className="text-zinc-500">{t('mail.subject_arrives')}:</span> <b dir="auto">{preview.subject}</b></div>
            <iframe title="preview" srcDoc={preview.html} className="h-96 w-full rounded-lg border border-zinc-200 bg-white dark:border-zinc-700" /></Card>}
          {edit && <Card title={t('mail.send_test')}><div className="flex gap-2"><input className="input" type="email" dir="ltr" placeholder={t('mail.to')} value={to} onChange={(e) => setTo(e.target.value)} />
            <Button icon={<Send className="size-4" />} onClick={async () => { try { await post(`/email/templates/${key}/test`, { to, vars: sample }); toast(t('mail.test_sent')); } catch (e) { toast(errText(e), 'red'); } }}>{t('mail.send_test')}</Button></div></Card>}
        </div>
      )}
      {creating && <NewTemplate onClose={() => setCreating(false)} onDone={(k) => { setCreating(false); loadAll(); setKey(k); }} />}
    </div>
  );
}
function NewTemplate({ onClose, onDone }: { onClose: () => void; onDone: (k: string) => void }) {
  const { t } = useI18n();
  const errText = useErrorText();
  const [v, setV] = useState({ tkey: '', name: '', subject: '', body_html: '', placeholders: '' });
  const [err, setErr] = useState<string | null>(null);
  return (
    <SidePanel open onClose={onClose} title={t('mail.new_template')} footer={<><Button onClick={onClose}>{t('common.cancel')}</Button>
      <Button variant="primary" onClick={async () => { try { await post('/email/templates', v); onDone(v.tkey); } catch (e) { setErr(errText(e)); } }}>{t('mail.create_template')}</Button></>}>
      <div className="space-y-3">{err && <Alert tone="red">{err}</Alert>}
        <Field label={t('mail.key')} required hint={t('mail.key_hint')}><input className="input" dir="ltr" value={v.tkey} onChange={(e) => setV({ ...v, tkey: e.target.value })} /></Field>
        {(['name', 'subject', 'placeholders'] as const).map((k) => <Field key={k} label={t(`mail.${k}`)} required={k !== 'placeholders'}><input className="input" dir="auto" value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} /></Field>)}
        <Field label={t('mail.body')} required><textarea className="input font-mono text-xs" rows={8} dir="auto" value={v.body_html} onChange={(e) => setV({ ...v, body_html: e.target.value })} /></Field>
      </div>
    </SidePanel>
  );
}

// ---------- SMTP ----------
function Smtp({ account }: { account: 'system' | 'riders' }) {
  const { t } = useI18n();
  const { can } = useAuth();
  const run = useAction();
  const { toast } = useUi();
  const errText = useErrorText();
  const [v, setV] = useState<any>(null);
  const [testTo, setTestTo] = useState('');
  const [warn, setWarn] = useState(false);
  useEffect(() => { get('/email/smtp').then((d) => setV({ ...d[account], password: '' })); }, [account]);
  if (!v) return <Loading />;
  const edit = can('smtp.update');
  const f = (k: string, label: string, type = 'text', dir: 'ltr' | 'auto' = 'ltr') => <Field label={label}><input className="input" type={type} dir={dir} disabled={!edit} value={v[k] ?? ''} onChange={(e) => setV({ ...v, [k]: e.target.value })} /></Field>;
  return (
    <Card title={t(`mail.smtp_${account}`)} actions={account === 'riders' && <Badge tone="blue">{t('mail.riders_only')}</Badge>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('mail.provider')} className="sm:col-span-2"><select className="input" disabled={!edit} defaultValue="" onChange={(e) => e.target.value && setV({ ...v, ...PROVIDERS[e.target.value] })}>
          <option value="">{t('mail.manual')}</option>{Object.keys(PROVIDERS).map((p) => <option key={p} value={p}>{t(`mail.prov.${p}`)}</option>)}</select></Field>
        {f('host', t('mail.host'))}{f('port', t('mail.port'), 'number')}{f('username', t('mail.username'))}
        <Field label={t('mail.password')} hint={v.has_password ? t('mail.password_saved') : t('mail.no_password')}><input className="input" type="password" dir="ltr" disabled={!edit} value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} /></Field>
        <Field label={t('mail.encryption')}><select className="input" disabled={!edit} value={v.encryption} onChange={(e) => setV({ ...v, encryption: e.target.value })}>{['starttls', 'ssl', 'none'].map((x) => <option key={x} value={x}>{t(`mail.enc.${x}`)}</option>)}</select></Field>
        {f('sender_name', t('mail.sender_name'), 'text', 'auto')}{f('sender_email', t('mail.sender_email'), 'email')}
        <div className="flex items-end"><Switch checked={!!v.enabled} disabled={!edit} onChange={(x) => setV({ ...v, enabled: x })} label={t('mail.send_through')} /></div>
      </div>
      {(warn || (v.sender_email && v.username && v.sender_email.toLowerCase() !== v.username.toLowerCase())) && <div className="mt-3"><Alert tone="amber">{t('mail.sender_warn')}</Alert></div>}
      {edit && <div className="mt-4 flex flex-wrap items-end gap-2 border-t border-zinc-100 pt-3 dark:border-zinc-800">
        <Button variant="primary" onClick={async () => { const r = await run(() => put(`/email/smtp/${account}`, v), t('mail.smtp_saved')); if (r) { setWarn(r.warn_sender); setV({ ...v, password: '', has_password: v.has_password || !!v.password }); } }}>{t('mail.save_settings')}</Button>
        <Field label={t('mail.test_to')} className="min-w-56 flex-1"><input className="input" type="email" dir="ltr" value={testTo} onChange={(e) => setTestTo(e.target.value)} /></Field>
        <Button onClick={async () => { try { await post(`/email/smtp/${account}/test`, { to: testTo }); toast(t('mail.test_sent')); } catch (e) { toast(errText(e), 'red'); } }}>{t('mail.test_connection')}</Button>
      </div>}
    </Card>
  );
}

// ---------- branding & content ----------
function Branding() {
  const { t } = useI18n();
  const { can } = useAuth();
  const run = useAction();
  const { toast } = useUi();
  const [d, setD] = useState<any>(null);
  const [b, setB] = useState<any>(null);
  const [lang, setLang] = useState('ar');
  const [tpl, setTpl] = useState('system.smtp_test');
  const [width, setWidth] = useState<'desktop' | 'mobile'>('desktop');
  const [html, setHtml] = useState('');
  const load = () => get('/email/branding').then((x) => { setD(x); setB(x.branding); });
  useEffect(() => { load(); }, []);
  useEffect(() => { if (!b) return; const h = setTimeout(() => post('/email/branding/preview', { branding: b, lang, template: tpl }).then((r) => setHtml(r.html)).catch(() => {}), 300); return () => clearTimeout(h); }, [b, lang, tpl]);
  if (!d || !b) return <Loading />;
  const edit = can('email_templates.update', 'smtp.update');
  const set = (k: string, v: unknown) => setB({ ...b, [k]: v });
  const sw = (k: string, label: string) => <Switch checked={!!b[k]} disabled={!edit} onChange={(v) => set(k, v)} label={<span className="text-sm">{label}</span>} />;
  const txt = (k: string, label: string, dir: 'auto' | 'ltr' = 'auto') => <Field label={label}><input className="input" dir={dir} disabled={!edit} value={b[k] ?? ''} onChange={(e) => set(k, e.target.value)} /></Field>;
  const groups = ['documents', 'advances', 'security', 'portal', 'system'];
  const on = d.types.filter((x: any) => x.is_active).length;
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <div className="space-y-4">
        <Card title={t('mail.br.identity')}><div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">{sw('use_org', t('mail.br.use_org'))}</div>{txt('company_name', t('mail.br.company_name'))}{txt('alt_name', t('mail.br.alt_name'))}
          <Field label={t('mail.br.header_name')}><select className="input" disabled={!edit} value={b.header_name} onChange={(e) => set('header_name', e.target.value)}>{['primary', 'alternate', 'both', 'by_language'].map((x) => <option key={x} value={x}>{t(`mail.br.hn.${x}`)}</option>)}</select></Field>
        </div></Card>
        <Card title={t('mail.br.logo')}><div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('mail.br.logo_source')}><select className="input" disabled={!edit} value={b.logo_source} onChange={(e) => set('logo_source', e.target.value)}>{['org', 'none'].map((x) => <option key={x} value={x}>{t(`mail.br.ls.${x}`)}</option>)}</select></Field>
          <Field label={t('mail.br.logo_place')}><select className="input" disabled={!edit} value={b.logo_place} onChange={(e) => set('logo_place', e.target.value)}>{['above', 'centred', 'full'].map((x) => <option key={x} value={x}>{t(`mail.br.lp.${x}`)}</option>)}</select></Field>
          <Field label={`${t('mail.br.logo_width')} (${b.logo_width}px)`}><input type="range" min={40} max={240} disabled={!edit} value={b.logo_width} onChange={(e) => set('logo_width', Number(e.target.value))} className="w-full" /></Field>
          <div className="flex items-end">{sw('embed_logo', t('mail.br.embed'))}</div>
        </div></Card>
        <Card title={t('mail.br.colours')}><div className="grid gap-3 sm:grid-cols-3">
          {(['header_bg', 'header_text', 'accent'] as const).map((k) => <Field key={k} label={t(`mail.br.${k}`)}><div className="flex gap-2"><input type="color" disabled={!edit} value={b[k]} onChange={(e) => set(k, e.target.value)} className="h-9 w-12 rounded" /><input className="input" dir="ltr" disabled={!edit} value={b[k]} onChange={(e) => set(k, e.target.value)} /></div></Field>)}
        </div></Card>
        <Card title={t('mail.br.footer')}><div className="grid gap-3 sm:grid-cols-2">
          {txt('footer_ar', t('mail.br.footer_ar'))}{txt('footer_en', t('mail.br.footer_en'))}
          <div className="flex flex-wrap gap-3 sm:col-span-2">{['show_address', 'show_phone', 'show_email', 'show_website', 'show_cr', 'show_tax'].map((k) => <Checkbox key={k} checked={!!b[k]} disabled={!edit} onChange={(v) => set(k, v)} label={t(`mail.br.${k}`)} />)}</div>
          <div className="sm:col-span-2">{sw('auto_notice', t('mail.br.auto_notice'))}</div>{txt('auto_notice_ar', t('mail.br.notice_ar'))}{txt('auto_notice_en', t('mail.br.notice_en'))}
          {txt('reply_to', t('mail.br.reply_to'), 'ltr')}
        </div></Card>
        {edit && <Button variant="primary" onClick={async () => { if (await run(() => put('/email/branding', b))) { toast(t('mail.br.saved')); load(); } }}>{t('common.save')}</Button>}
      </div>
      <div className="space-y-4">
        <Card title={t('mail.br.preview')} actions={<div className="flex gap-1">
          <select className="input w-auto py-1 text-xs" value={lang} onChange={(e) => setLang(e.target.value)}>{['ar', 'en', 'bn'].map((l) => <option key={l} value={l}>{t(`lang.${l}`)}</option>)}</select>
          <select className="input w-auto py-1 text-xs" value={tpl} onChange={(e) => setTpl(e.target.value)}>{d.types.map((x: any) => <option key={x.tkey} value={x.tkey}>{x.name}</option>)}</select>
          <select className="input w-auto py-1 text-xs" value={width} onChange={(e) => setWidth(e.target.value as any)}><option value="desktop">{t('mail.br.desktop')}</option><option value="mobile">{t('mail.br.mobile')}</option></select></div>}>
          <iframe title="email" srcDoc={html} className={cx('mx-auto h-[28rem] rounded-lg border border-zinc-200 bg-white dark:border-zinc-700', width === 'mobile' ? 'w-[375px]' : 'w-full')} />
        </Card>
        <Card title={t('mail.br.sent_list')} subtitle={t('mail.br.n_on', { on, total: d.types.length })} pad={false}>
          {groups.map((g) => (
            <div key={g}><div className="bg-zinc-50 px-4 py-1.5 text-xs font-semibold text-zinc-500 dark:bg-zinc-800/40">{t(`mail.grp.${g}`)}</div>
              <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">{d.types.filter((x: any) => x.grp === g).map((x: any) => (
                <li key={x.tkey} className="flex items-center gap-3 px-4 py-2 text-sm">
                  <div className="min-w-0 flex-1"><div className="font-medium">{x.name}</div><div className="text-xs text-zinc-500">{x.last_sent ? <span className="num">{fmtDateTime(x.last_sent)}</span> : '—'} · {t('mail.br.sent_failed', { s: fmtNum(x.sent_30), f: fmtNum(x.failed_30) })}</div></div>
                  {x.is_required ? <span title={t('mail.always_sent')}><Lock className="size-4 text-zinc-400" /></span>
                    : <Switch checked={!!x.is_active} disabled={!edit} onChange={async (v) => { if (await run(() => post(`/email/templates/${x.tkey}/${v ? 'activate' : 'deactivate'}`), v ? t('common.saved') : t('mail.br.type_off'))) load(); }} />}
                </li>))}</ul>
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}

// ======================================================================== 11.4 the log
const ST: Record<string, Tone> = { queued: 'blue', sent: 'green', failed: 'red' };
export function EmailLog() {
  const { t } = useI18n();
  const { can } = useAuth();
  const run = useAction();
  const list = useList('/email/log');
  const [open, setOpen] = useState<any>(null);
  return (
    <>
      <PageHeader title={t('mail.log_title')} actions={can('email_log.export') && <ExportButton path="/email/log/export" query={list.query} label={t('common.export_csv')} />} />
      <FilterBar list={list} placeholder={t('mail.log_search')}>
        <FilterSelect list={list} name="status" label={t('mail.status')} options={Object.keys(ST).map((k) => ({ value: k, label: t(`mail.st.${k}`) }))} />
        <FilterDate list={list} name="from" label={t('common.from_date')} /><FilterDate list={list} name="to" label={t('common.to_date')} />
      </FilterBar>
      <DataTable list={list} onRowClick={setOpen} columns={[
        { key: 'date', header: t('mail.date'), render: (r) => <span className="num text-xs">{fmtDateTime(r.created_at)}</span> },
        { key: 'status', header: t('mail.status'), render: (r) => <Badge tone={ST[r.status]}>{t(`mail.st.${r.status}`)}</Badge> },
        { key: 'template', header: t('mail.template'), render: (r) => <code className="text-xs" dir="ltr">{r.template_key ?? '—'}</code> },
        { key: 'to', header: t('mail.recipient'), render: (r) => <div><div dir="ltr" className="text-xs">{r.to_email}</div>{r.to_name && <div className="text-xs text-zinc-500">{r.to_name}</div>}</div> },
        { key: 'subject', header: t('mail.subject'), render: (r) => <span className="line-clamp-1 max-w-80" dir="auto">{r.subject}</span> },
        { key: 'retries', header: t('mail.retries'), render: (r) => <span className="num">{r.retries}</span> },
      ]} />
      <SidePanel open={!!open} onClose={() => setOpen(null)} title={t('mail.details')} footer={open?.status === 'failed' && can('email_templates.update') && open.account !== 'riders' &&
        <Button variant="primary" onClick={async () => { if (await run(() => post(`/email/log/${open.id}/retry`), t('mail.retried'))) { setOpen(null); list.reload(); } }}>{t('mail.retry')}</Button>}>
        {open && <Details cols={1} rows={[[t('mail.status'), <Badge tone={ST[open.status]}>{t(`mail.st.${open.status}`)}</Badge>], [t('mail.template'), open.template_key], [t('mail.recipient'), open.to_email],
          [t('mail.cc'), open.cc], [t('mail.subject'), open.subject], [t('mail.linked'), open.entity_type && `${open.entity_type} #${open.entity_id}`],
          [t('mail.created_at'), fmtDateTime(open.created_at)], [t('mail.sent_at'), fmtDateTime(open.sent_at)], [t('mail.last_attempt'), fmtDateTime(open.last_attempt_at)],
          [t('mail.retries'), String(open.retries), true], [t('mail.provider_id'), open.provider_id], [t('mail.error_code'), open.error_code], [t('mail.error_message'), open.error_message]]} />}
      </SidePanel>
    </>
  );
}
