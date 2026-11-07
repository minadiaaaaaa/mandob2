// Finance → Payroll (phase 6): monthly salary sheets (draft → finalized → paid with signed proof), the salary rules
// per branch and job title, the paid history, and a rider's printable settlement statement.
// The server keeps every rule (domain/payroll.ts).
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Ban, CheckCircle2, CreditCard, Eye, Lock, Pencil, Plus, Printer, RefreshCw, Trash2, Unlock } from 'lucide-react';
import { del, get, patch, post } from '../../api';
import { useAuth } from '../../auth';
import { fmtDate, fmtMoney, fmtNum, useI18n } from '../../i18n';
import { Alert, Badge, Button, Card, IconButton, Loading, PageHeader, SidePanel, Tabs, useAction, useUi, type Tone } from '../../ui/kit';
import { CheckInput, Grid, SelectInput, TextInput, useForm } from '../../ui/forms';
import { ExportButton, localName, useOptions } from '../../ui/common';
import { Attachments } from '../../ui/files';
import { useOrgOptions } from '../system/Branches';

export const SHEET_STATUS: Record<string, Tone> = { draft: 'amber', finalized: 'blue', paid: 'green' };
const SheetStatus = ({ s }: { s: string }) => { const { t } = useI18n(); return <Badge tone={SHEET_STATUS[s]}>{t(`pay.st.${s}`)}</Badge>; };
const TH = ({ children }: { children?: React.ReactNode }) => <th className="whitespace-nowrap px-3 py-2 text-start font-medium">{children}</th>;

export function PayrollPage() {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const tab = ['sheets', 'paid', 'rules'].includes(params.get('tab') ?? '') ? params.get('tab')! : 'sheets';
  return (
    <>
      <PageHeader title={t('pay.title')} subtitle={t('pay.intro')} />
      <Tabs value={tab} onChange={(k) => setParams(k === 'sheets' ? {} : { tab: k })} tabs={['sheets', 'paid', 'rules'].map((k) => ({ key: k, label: t(`pay.tab.${k}`) }))} />
      {tab === 'rules' ? <Rules /> : <Sheets paid={tab === 'paid'} />}
    </>
  );
}

function Sheets({ paid }: { paid: boolean }) {
  const { t, lang } = useI18n();
  const { can } = useAuth();
  const nav = useNavigate();
  const [rows, setRows] = useState<any[] | null>(null);
  const [creating, setCreating] = useState(false);
  const branches = useOrgOptions('branches');
  const form = useForm<Record<string, any>>({ period: new Date().toISOString().slice(0, 7), branch_id: '' });
  const load = () => get<any[]>('/payroll', paid ? { status: 'paid' } : {}).then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); }, [paid]); // eslint-disable-line react-hooks/exhaustive-deps
  const create = async () => { const r: any = await form.submit(() => post('/payroll', form.values)); if (r) nav(`/admin/payroll/${r.id}`); };
  if (!rows) return <Loading />;
  return (
    <>
      {paid ? <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-400">{t('pay.paid_intro')}</p>
        : can('payroll.create') && <div className="mb-3"><Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>{t('pay.new')}</Button></div>}
      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800"><table className="w-full text-sm">
        <thead className="bg-zinc-50 text-xs text-zinc-500 dark:bg-zinc-900"><tr><TH>{t('pay.period')}</TH><TH>{t('pay.branch')}</TH><TH>{t('pay.riders')}</TH><TH>{t('pay.net')}</TH><TH>{t('pay.status')}</TH><TH>{paid ? t('pay.paid_on') : ''}</TH><TH /></tr></thead>
        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">{rows.map((s) => <tr key={s.id}>
          <td className="num px-3 py-2 font-medium">{s.period}</td><td className="px-3 py-2">{s.branch_id ? localName(lang, s.branch_ar, s.branch_en) : t('pay.all_branches')}</td>
          <td className="num px-3 py-2">{fmtNum(s.riders)}</td><td className="num px-3 py-2">{fmtMoney(s.total_net)}</td><td className="px-3 py-2"><SheetStatus s={s.status} /></td>
          <td className="px-3 py-2 text-xs">{s.paid_on && <span className="num">{fmtDate(s.paid_on)}</span>}{s.account_name && <div className="text-zinc-500">{s.account_name}</div>}{paid && <div className="text-zinc-500">{t('pay.proofs', { n: s.proofs })}</div>}</td>
          <td className="px-3 py-2"><Link to={`/admin/payroll/${s.id}`}><IconButton title={t('pay.open')}><Eye /></IconButton></Link></td></tr>)}</tbody></table>
        {!rows.length && <p className="p-4 text-sm text-zinc-500">{t(paid ? 'pay.no_paid' : 'pay.none')}</p>}</div>
      <SidePanel open={creating} onClose={() => setCreating(false)} title={t('pay.new')}
        footer={<><Button onClick={() => setCreating(false)}>{t('common.cancel')}</Button><Button variant="primary" disabled={form.busy} onClick={create}>{t('pay.create')}</Button></>}>
        <form onSubmit={(e) => { e.preventDefault(); create(); }}>
          <Grid><TextInput form={form} name="period" type="month" label={t('pay.period')} required />
            <SelectInput form={form} name="branch_id" label={t('pay.branch')} options={branches} /></Grid>
          <p className="mt-2 text-xs text-zinc-500">{t('pay.new_hint')}</p>
        </form>
      </SidePanel>
    </>
  );
}

function Rules() {
  const { t, lang } = useI18n();
  const { can } = useAuth();
  const run = useAction();
  const { confirm } = useUi();
  const [rows, setRows] = useState<any[]>([]);
  const [edit, setEdit] = useState<any | null>(null);
  const branches = useOrgOptions('branches');
  const designations = useOrgOptions('designations');
  const EMPTY = { name: '', branch_id: '', designation_id: '', base_salary: '', per_order: '', target_orders: '', target_bonus: '', deduct_fines: true, deduct_advances: true };
  const form = useForm<Record<string, any>>(EMPTY);
  const load = () => get<any[]>('/salary-rules').then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); }, []);
  const open = (r?: any) => { form.reset(r ? Object.fromEntries(Object.keys(EMPTY).map((k) => [k, typeof (EMPTY as any)[k] === 'boolean' ? !!r[k] : r[k] ?? ''])) : EMPTY); setEdit(r ?? {}); };
  const save = async () => { const r = await form.submit(() => (edit.id ? patch(`/salary-rules/${edit.id}`, form.changes) : post('/salary-rules', form.values))); if (r) { setEdit(null); load(); } };
  const toggle = async (r: any) => { if (await run(() => patch(`/salary-rules/${r.id}`, { is_active: !r.is_active }), t('common.saved'))) load(); };
  const remove = async (r: any) => { if (!(await confirm({ title: t('pay.delete_rule_q', { name: r.name }), tone: 'warn' }))) return; if (await run(() => del(`/salary-rules/${r.id}`), t('common.deleted'))) load(); };
  return (
    <>
      <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-400">{t('pay.rules_intro')}</p>
      {can('salary_rules.create') && <div className="mb-3"><Button variant="primary" icon={<Plus className="size-4" />} onClick={() => open()}>{t('pay.new_rule')}</Button></div>}
      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800"><table className="w-full text-sm">
        <thead className="bg-zinc-50 text-xs text-zinc-500 dark:bg-zinc-900"><tr><TH>{t('pay.rule')}</TH><TH>{t('pay.applies_to')}</TH><TH>{t('pay.base')}</TH><TH>{t('pay.per_order')}</TH><TH>{t('pay.target')}</TH><TH>{t('pay.deducts')}</TH><TH /></tr></thead>
        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">{rows.map((r) => <tr key={r.id} className={r.is_active ? '' : 'opacity-60'}>
          <td className="px-3 py-2 font-medium">{r.name}</td>
          <td className="px-3 py-2 text-xs">{r.branch_id ? localName(lang, r.branch_ar, r.branch_en) : t('pay.all_branches')} · {r.designation_id ? localName(lang, r.designation_ar, r.designation_en) : t('pay.all_titles')}</td>
          <td className="num px-3 py-2">{fmtMoney(r.base_salary)}</td><td className="num px-3 py-2">{fmtMoney(r.per_order)}</td>
          <td className="num px-3 py-2 text-xs">{r.target_orders ? `${fmtNum(r.target_orders)} → ${fmtMoney(r.target_bonus)}` : '—'}</td>
          <td className="px-3 py-2 text-xs">{[r.deduct_fines && t('pay.fines'), r.deduct_advances && t('pay.advances')].filter(Boolean).join(' · ') || '—'}</td>
          <td className="px-3 py-2"><div className="flex">{can('salary_rules.update') && <><IconButton title={t('common.edit')} onClick={() => open(r)}><Pencil /></IconButton>
            <IconButton title={r.is_active ? t('common.disable') : t('common.enable')} tone={r.is_active ? 'amber' : 'green'} onClick={() => toggle(r)}><Ban /></IconButton></>}
            {can('salary_rules.delete') && <IconButton title={t('common.delete')} tone="red" onClick={() => remove(r)}><Trash2 /></IconButton>}</div></td></tr>)}</tbody></table>
        {!rows.length && <p className="p-4 text-sm text-zinc-500">{t('pay.no_rules')}</p>}</div>
      <SidePanel open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? t('pay.edit_rule') : t('pay.new_rule')}
        footer={<><Button onClick={() => setEdit(null)}>{t('common.cancel')}</Button><Button variant="primary" disabled={form.busy} onClick={save}>{t('common.save')}</Button></>}>
        <form onSubmit={(e) => { e.preventDefault(); save(); }}>
          <TextInput form={form} name="name" label={t('pay.rule')} required maxLength={100} />
          <Grid>
            <SelectInput form={form} name="branch_id" label={t('pay.branch')} options={branches} />
            <SelectInput form={form} name="designation_id" label={t('riders.designation')} options={designations} />
            <TextInput form={form} name="base_salary" type="number" label={t('pay.base')} dir="ltr" />
            <TextInput form={form} name="per_order" type="number" label={t('pay.per_order')} dir="ltr" />
            <TextInput form={form} name="target_orders" type="number" label={t('pay.target_orders')} dir="ltr" />
            <TextInput form={form} name="target_bonus" type="number" label={t('pay.target_bonus')} dir="ltr" />
          </Grid>
          <div className="mt-3 space-y-2"><CheckInput form={form} name="deduct_fines" label={t('pay.deduct_fines')} /><CheckInput form={form} name="deduct_advances" label={t('pay.deduct_advances')} /></div>
        </form>
      </SidePanel>
    </>
  );
}

export function PayrollSheetPage() {
  const { id } = useParams();
  const { t, lang } = useI18n();
  const { can } = useAuth();
  const run = useAction();
  const { confirm } = useUi();
  const nav = useNavigate();
  const [s, setS] = useState<any | null>(null);
  const [line, setLine] = useState<any | null>(null);
  const [paying, setPaying] = useState(false);
  const accounts = useOptions<any>(can('company_finance.view') ? '/fin-accounts' : null);
  const lf = useForm<Record<string, any>>({ addition: '', deduction: '', note: '' });
  const pf = useForm<Record<string, any>>({ account_id: '', paid_on: '' });
  const load = () => get(`/payroll/${id}`).then(setS).catch(() => setS(false as any));
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (s === null) return <Loading />;
  if (!s) return <Alert tone="red">{t('pay.not_found')}</Alert>;
  const act = async (path: string, q: string, msg: string, tone?: 'warn') => { if (!(await confirm({ title: t(q), tone }))) return; if (await run(() => post(`/payroll/${id}/${path}`), t(msg))) load(); };
  const saveLine = async () => { const r = await lf.submit(() => patch(`/payroll-lines/${line.id}`, lf.values)); if (r) { setLine(null); load(); } };
  const pay = async () => { const r = await pf.submit(() => post(`/payroll/${id}/pay`, pf.values)); if (r) { setPaying(false); load(); } };
  const remove = async () => { if (!(await confirm({ title: t('pay.delete_q'), tone: 'warn' }))) return; if (await run(() => del(`/payroll/${id}`), t('common.deleted'))) nav('/admin/payroll'); };
  const draft = s.status === 'draft';
  const sum = (k: string) => s.lines.reduce((a: number, l: any) => a + Number(l[k]), 0);
  return (
    <>
      <PageHeader title={t('pay.sheet_title', { period: s.period })} back="/admin/payroll" subtitle={<span className="inline-flex items-center gap-2"><SheetStatus s={s.status} />{s.branch_id ? localName(lang, s.branch_ar, s.branch_en) : t('pay.all_branches')}</span>} actions={<>
        {can('payroll.export') && <ExportButton path={`/payroll/${id}/export`} />}
        <Button icon={<Printer className="size-4" />} onClick={() => window.print()}>{t('pay.print')}</Button>
        {draft && can('payroll.update') && <><Button icon={<RefreshCw className="size-4" />} onClick={() => act('recalculate', 'pay.recalc_q', 'pay.recalculated')}>{t('pay.recalc')}</Button>
          <IconButton title={t('common.delete')} tone="red" onClick={remove}><Trash2 /></IconButton></>}
        {draft && can('payroll.finalize') && <Button variant="primary" icon={<Lock className="size-4" />} onClick={() => act('finalize', 'pay.finalize_q', 'pay.finalized', 'warn')}>{t('pay.finalize')}</Button>}
        {s.status === 'finalized' && can('payroll.reopen') && <Button icon={<Unlock className="size-4" />} onClick={() => act('reopen', 'pay.reopen_q', 'pay.reopened', 'warn')}>{t('pay.reopen')}</Button>}
        {s.status === 'finalized' && can('payroll.pay') && <Button variant="primary" icon={<CreditCard className="size-4" />} onClick={() => { pf.reset({ account_id: accounts.find((a) => a.is_active)?.id ?? '', paid_on: '' }); setPaying(true); }}>{t('pay.mark_paid')}</Button>}
      </>} />
      <div className="mb-4 grid gap-3 sm:grid-cols-4 text-sm">
        {[['pay.riders', fmtNum(s.riders)], ['pay.gross', fmtMoney(sum('base') + sum('orders_pay') + sum('bonus') + sum('addition'))], ['pay.deductions_total', fmtMoney(sum('fines') + sum('advances') + sum('deduction'))], ['pay.net', fmtMoney(s.total_net)]].map(([k, v]) =>
          <Card key={k}><div className="text-xs text-zinc-500">{t(k)}</div><div className="num text-lg font-semibold">{v}</div></Card>)}
      </div>
      {s.status === 'paid' && <Alert tone="green" title={t('pay.paid_title', { date: fmtDate(s.paid_on) })}>{s.account_name ? t('pay.paid_from', { account: s.account_name }) : ''}</Alert>}
      <div className="mt-3 overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800"><table className="w-full text-sm">
        <thead className="bg-zinc-50 text-xs text-zinc-500 dark:bg-zinc-900"><tr>
          {['pay.rider', 'pay.orders', 'pay.base', 'pay.orders_pay', 'pay.bonus', 'pay.addition', 'pay.fines', 'pay.advances', 'pay.deduction', 'pay.net', ''].map((k) => <TH key={k}>{k ? t(k) : ''}</TH>)}</tr></thead>
        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">{s.lines.map((l: any) => <tr key={l.id}>
          <td className="px-3 py-2"><Link to={`/admin/riders/${l.rider_id}`} className="font-medium hover:underline">{l.alias || l.full_name}</Link>
            <div className="num text-xs text-zinc-500">#{l.rider_id}{l.rule_name ? ` · ${l.rule_name}` : ''}</div>{!l.rule_id && <Badge tone="amber">{t('pay.no_rule')}</Badge>}
            {l.iban && <div className="num text-xs text-zinc-500" dir="ltr">{l.iban}</div>}{l.note && <div className="text-xs text-zinc-500">{l.note}</div>}</td>
          {['orders', 'base', 'orders_pay', 'bonus', 'addition'].map((k) => <td key={k} className="num px-3 py-2">{k === 'orders' ? fmtNum(l[k]) : fmtMoney(l[k])}</td>)}
          {['fines', 'advances', 'deduction'].map((k) => <td key={k} className="num px-3 py-2 text-red-600">{Number(l[k]) ? `−${fmtMoney(l[k])}` : '0'}</td>)}
          <td className={`num px-3 py-2 font-semibold ${Number(l.net) < 0 ? 'text-red-600' : ''}`}>{fmtMoney(l.net)}</td>
          <td className="px-3 py-2">{draft && can('payroll.update') && <IconButton title={t('common.edit')} onClick={() => { lf.reset({ addition: l.addition, deduction: l.deduction, note: l.note ?? '' }); setLine(l); }}><Pencil /></IconButton>}
            <Link to={`/admin/riders/${l.rider_id}/settlement`}><IconButton title={t('stl.title')}><CheckCircle2 /></IconButton></Link></td></tr>)}</tbody></table></div>
      {s.status !== 'draft' && <div className="mt-4"><Attachments entityType="payroll_sheet" entityId={s.id} attachmentType="proof" title={t('pay.proof')} canUpload={s.status === 'finalized' && can('payroll.pay')} /></div>}
      <SidePanel open={!!line} onClose={() => setLine(null)} title={line ? t('pay.edit_line', { name: line.full_name }) : ''}
        footer={<><Button onClick={() => setLine(null)}>{t('common.cancel')}</Button><Button variant="primary" disabled={lf.busy} onClick={saveLine}>{t('common.save')}</Button></>}>
        <form onSubmit={(e) => { e.preventDefault(); saveLine(); }}>
          <Grid><TextInput form={lf} name="addition" type="number" label={t('pay.addition')} dir="ltr" /><TextInput form={lf} name="deduction" type="number" label={t('pay.deduction')} dir="ltr" /></Grid>
          <TextInput form={lf} name="note" label={t('common.notes')} maxLength={255} />
        </form>
      </SidePanel>
      <SidePanel open={paying} onClose={() => setPaying(false)} title={t('pay.mark_paid')}
        footer={<><Button onClick={() => setPaying(false)}>{t('common.cancel')}</Button><Button variant="primary" disabled={pf.busy} onClick={pay}>{t('pay.mark_paid')}</Button></>}>
        <p className="mb-3 text-sm">{t('pay.pay_body', { total: fmtMoney(s.total_net) })}</p>
        <Grid><SelectInput form={pf} name="account_id" label={t('fin2.account')} required options={accounts.filter((a) => a.is_active).map((a) => ({ value: a.id, label: `${a.name} · ${fmtMoney(a.balance)}` }))} />
          <TextInput form={pf} name="paid_on" type="date" label={t('pay.paid_on')} hint={t('svc.paid_on_hint')} /></Grid>
        <div className="mt-3"><Attachments entityType="payroll_sheet" entityId={s.id} attachmentType="proof" title={t('pay.proof')} /></div>
      </SidePanel>
    </>
  );
}

// ======================================================================== settlement statement
export function SettlementPage() {
  const { id } = useParams();
  const { t, lang } = useI18n();
  const [d, setD] = useState<any | null>(null);
  useEffect(() => { get(`/riders/${id}/settlement`).then(setD).catch(() => setD(false as any)); }, [id]);
  if (d === null) return <Loading />;
  if (!d) return <Alert tone="red">{t('pay.not_found')}</Alert>;
  const r = d.rider;
  return (
    <>
      <PageHeader title={t('stl.title')} back={`/admin/riders/${id}`} subtitle={`${r.full_name} · #${r.id}`} actions={<Button icon={<Printer className="size-4" />} onClick={() => window.print()}>{t('pay.print')}</Button>} />
      <div className="space-y-4 print:text-xs">
        <Card title={t('stl.rider')}><div className="grid gap-2 text-sm sm:grid-cols-3">
          {[['riders.full_name', r.full_name], ['riders.national_id', r.national_id], ['riders.mobile', r.phone], ['riders.branch', r.branch_ar && localName(lang, r.branch_ar, r.branch_en)],
            ['riders.hire_date', fmtDate(r.hire_date)], ['exited.exit_date', fmtDate(r.exit_date)], ['exited.clearance', r.exit_clearance ? t(`exited.c.${r.exit_clearance}`) : '—'], ['exited.reason', r.exit_reason]].map(([k, v]) =>
            <div key={k}><div className="text-xs text-zinc-500">{t(k)}</div><div>{v || '—'}</div></div>)}</div></Card>
        <Card title={t('stl.owed')}><div className={`num text-2xl font-semibold ${d.owed > 0 ? 'text-red-600' : 'text-emerald-600'}`}>{fmtMoney(d.owed)}</div>
          <div className="mt-3 grid gap-4 md:grid-cols-2 text-sm">
            <div><div className="mb-1 font-medium">{t('pay.advances')}</div>{!d.advances.length ? <p className="text-zinc-500">—</p> : d.advances.map((a: any) => <div key={a.number} className="flex justify-between"><span className="num">{a.number}</span><span className="num">{fmtMoney(a.remaining)}</span></div>)}</div>
            <div><div className="mb-1 font-medium">{t('pay.fines')}</div>{!d.fines.length ? <p className="text-zinc-500">—</p> : d.fines.map((f: any, i: number) => <div key={i} className="flex justify-between gap-2"><span className="truncate">{fmtDate(f.fine_date)} · {f.category}</span><span className="num">{fmtMoney(f.amount)}</span></div>)}</div>
          </div></Card>
        <Card title={t('stl.holds')}><div className="grid gap-4 md:grid-cols-2 text-sm">
          <div><div className="mb-1 font-medium">{t('riders.vehicle')}</div>{!d.vehicles.length ? <p className="text-zinc-500">—</p> : d.vehicles.map((v: any) => <div key={v.plate}>{v.plate} <span className="num text-xs text-zinc-500">{fmtDate(v.start_date)}</span></div>)}</div>
          <div><div className="mb-1 font-medium">{t('pids.title')}</div>{!d.platform_ids.length ? <p className="text-zinc-500">—</p> : d.platform_ids.map((p: any) => <div key={p.id_number}><span className="num">{p.id_number}</span> · {p.platform}</div>)}</div>
        </div></Card>
        <Card title={t('stl.payroll')}>{!d.payroll.length ? <p className="text-sm text-zinc-500">—</p> : <table className="w-full text-sm"><thead className="text-xs text-zinc-500"><tr>{['pay.period', 'pay.orders', 'pay.base', 'pay.orders_pay', 'pay.fines', 'pay.advances', 'pay.net', 'pay.status'].map((k) => <TH key={k}>{t(k)}</TH>)}</tr></thead>
          <tbody>{d.payroll.map((p: any) => <tr key={p.period} className="border-t border-zinc-100 dark:border-zinc-800"><td className="num px-3 py-1">{p.period}</td><td className="num px-3 py-1">{fmtNum(p.orders)}</td>
            <td className="num px-3 py-1">{fmtMoney(p.base)}</td><td className="num px-3 py-1">{fmtMoney(p.orders_pay)}</td><td className="num px-3 py-1">{fmtMoney(p.fines)}</td><td className="num px-3 py-1">{fmtMoney(p.advances)}</td>
            <td className="num px-3 py-1 font-medium">{fmtMoney(p.net)}</td><td className="px-3 py-1"><SheetStatus s={p.status} /></td></tr>)}</tbody></table>}</Card>
        <div className="hidden grid-cols-2 gap-8 pt-10 text-sm print:grid"><div className="border-t pt-2">{t('stl.sign_rider')}</div><div className="border-t pt-2">{t('stl.sign_company')}</div></div>
      </div>
    </>
  );
}
