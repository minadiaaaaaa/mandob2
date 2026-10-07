import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Ban, Banknote, Check, Eye, HandCoins, ListChecks, Plus, Undo2, X } from 'lucide-react';
import { get, post } from '../../api';
import { useAuth } from '../../auth';
import { fmtDate, fmtDateTime, fmtMoney, fmtNum, useI18n } from '../../i18n';
import { Alert, Badge, Button, By, Card, Details, Field, IconButton, Loading, Modal, PageHeader, StatCard, StatGrid, toneIf, useAction, useUi, type Tone } from '../../ui/kit';
import { Grid, RiderFilter, RiderInput, SaveBar, SelectInput, TextArea, TextInput, useForm } from '../../ui/forms';
import { DataTable, FilterBar, FilterDate, FilterSelect, useList, type Column } from '../../ui/table';
import { ExportButton, latin, useOptions } from '../../ui/common';

export const ADV_TONE: Record<string, Tone> = { pending: 'blue', approved: 'blue', rejected: 'grey', disbursed: 'amber', repaying: 'amber', settled: 'green', cancelled: 'grey' };
const INST_TONE: Record<string, Tone> = { due: 'none', partial: 'amber', paid: 'green', waived: 'grey' };
const todayStr = () => new Intl.DateTimeFormat('en-CA').format(new Date());

function useTiming() {
  const { t } = useI18n();
  return (days: number) => (days < 0 ? t('adv.days_late', { n: fmtNum(-days) }) : days === 0 ? t('adv.due_today') : t('adv.in_days', { n: fmtNum(days) }));
}
const instTone = (i: any): Tone => (i.status === 'paid' ? 'green' : i.status === 'waived' ? 'grey' : i.days_left < 0 ? 'red' : i.days_left <= 7 ? 'amber' : 'none');

// The money dialogs: payout, repayment, waiver, rejection, cancellation. Each asks before acting.
type Dlg = { title: string; confirm: string; tone?: 'primary' | 'danger' | 'warn'; body?: ReactNode; fields: ('method' | 'date' | 'amount' | 'reason')[]; amountHint?: string; reasonLabel?: string; submit: (v: Record<string, string>) => Promise<unknown> };
function useMoneyDialog(onDone: () => void) {
  const { t } = useI18n();
  const run = useAction();
  const [d, setD] = useState<Dlg | null>(null);
  const [v, setV] = useState<Record<string, string>>({});
  const open = (x: Dlg) => { setV({ method: 'cash', date: todayStr(), amount: '', reason: '' }); setD(x); };
  const node = d && (
    <Modal open onClose={() => setD(null)} title={d.title} footer={<>
      <Button onClick={() => setD(null)}>{t('common.cancel')}</Button>
      <Button variant={d.tone === 'danger' ? 'danger' : d.tone === 'warn' ? 'warn' : 'primary'} onClick={async () => {
        const body = Object.fromEntries(Object.entries(v).filter(([k, x]) => d.fields.includes(k as any) && x !== '').map(([k, x]) => [k, k === 'amount' ? latin(x) : x]));
        if (await run(() => d.submit(body), t('common.saved'))) { setD(null); onDone(); }
      }}>{d.confirm}</Button></>}>
      <div className="space-y-3">
        {d.body && <div className="text-sm text-zinc-600 dark:text-zinc-300">{d.body}</div>}
        {d.fields.includes('method') && <Field label={t('adv.payout_method')}><select className="input" value={v.method} onChange={(e) => setV({ ...v, method: e.target.value })}>{['cash', 'bank', 'wallet', 'other'].map((m) => <option key={m} value={m}>{t(`adv.m.${m}`)}</option>)}</select></Field>}
        {d.fields.includes('amount') && <Field label={t('adv.amount_repaid')} hint={d.amountHint}><input className="input" dir="ltr" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} /></Field>}
        {d.fields.includes('date') && <Field label={d.fields.includes('method') ? t('adv.payout_date') : t('adv.payment_date')}><input type="date" className="input" value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} /></Field>}
        {d.fields.includes('reason') && <Field label={d.reasonLabel ?? t('common.notes')}><textarea className="input" rows={3} maxLength={500} value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} /></Field>}
      </div>
    </Modal>
  );
  return { open, node };
}

function useInstallmentActions(reload: () => void) {
  const { t } = useI18n();
  const dlg = useMoneyDialog(reload);
  const repay = (i: any) => dlg.open({ title: t('adv.record_repayment'), confirm: t('adv.record_repayment'), fields: ['amount', 'date'],
    amountHint: t('adv.amount_hint', { left: fmtMoney(Number(i.amount) - Number(i.paid)) }), submit: (v) => post(`/advance-installments/${i.id}/repay`, v) });
  const waive = (i: any) => dlg.open({ title: t('adv.waive'), confirm: t('adv.waive'), tone: 'warn', fields: ['reason'], reasonLabel: t('adv.waive_reason'),
    body: t('adv.waive_body'), submit: (v) => post(`/advance-installments/${i.id}/waive`, v) });
  return { repay, waive, node: dlg.node };
}

// ======================================================================== ledger
export function AdvancesList() {
  const { t } = useI18n();
  const { can } = useAuth();
  const nav = useNavigate();
  const run = useAction();
  const { confirm } = useUi();
  const list = useList('/advances');
  const companies = useOptions<any>('/lookups/companies');
  const s = list.stats ?? {};
  const quick = async (r: any, action: 'approve' | 'disburse') => {
    if (!(await confirm({ title: t(action === 'approve' ? 'adv.approve_q' : 'adv.disburse_cash_q', { number: r.number }), confirm: t(action === 'approve' ? 'adv.approve' : 'adv.disburse'), tone: 'primary' }))) return;
    if (await run(() => post(`/advances/${r.id}/${action}`, action === 'disburse' ? { method: 'cash' } : {}), t('common.saved'))) list.reload();
  };
  const columns: Column<any>[] = [
    { key: 'number', header: t('adv.number'), sort: 'number', render: (r) => <div><div className="num font-medium">{r.number}</div><div className="text-xs text-zinc-500 num">{r.request_date}</div></div> },
    { key: 'rider', header: t('adv.rider'), sort: 'rider', render: (r) => <div><Link to={`/admin/riders/${r.rider_id}`} className="font-medium hover:text-brand">{r.full_name}</Link><div className="text-xs text-zinc-500 num">{r.national_id ?? `#${r.rider_id}`}</div></div> },
    { key: 'company', header: t('adv.company'), render: (r) => r.company_name ?? '—' },
    { key: 'amount', header: t('adv.amount'), sort: 'amount', render: (r) => <span className="num font-medium">{fmtNum(r.amount, 2)}</span> },
    { key: 'out', header: t('adv.outstanding'), render: (r) => <div className="num"><div className={r.outstanding > 0 ? 'text-amber-700 dark:text-amber-400' : ''}>{fmtNum(r.outstanding, 2)}</div><div className="text-xs text-zinc-500">{t('adv.repaid_x', { n: fmtNum(r.repaid, 2) })}</div></div> },
    { key: 'inst', header: t('adv.installments'), render: (r) => <div><span className="num">{t('adv.x_of_y', { x: r.inst_done, y: r.installments })}</span>{r.overdue > 0 && <div className="text-xs text-red-600">{t('adv.n_overdue', { n: r.overdue })}</div>}</div> },
    { key: 'next', header: t('adv.next_due'), render: (r) => <span className="num">{fmtDate(r.next_due)}</span> },
    { key: 'status', header: t('adv.status'), sort: 'status', render: (r) => <Badge tone={ADV_TONE[r.status]}>{t(`adv.s.${r.status}`)}</Badge> },
    { key: 'actions', header: t('common.actions'), render: (r) => <div className="flex">
      <IconButton title={t('common.view')} onClick={() => nav(`/admin/advances/${r.id}`)}><Eye /></IconButton>
      {r.status === 'pending' && can('advances.approve') && <IconButton title={t('adv.approve')} tone="green" onClick={() => quick(r, 'approve')}><Check /></IconButton>}
      {r.status === 'approved' && can('advances.disburse') && <IconButton title={t('adv.disburse_cash')} tone="amber" onClick={() => quick(r, 'disburse')}><Banknote /></IconButton>}
    </div> },
  ];
  return (
    <>
      <PageHeader title={t('adv.title')} actions={<>
        {can('advance_installments.view') && <Link to="/admin/advances/due"><Button icon={<ListChecks className="size-4" />}>{t('adv.due_title')}</Button></Link>}
        {can('advances.export') && <ExportButton path="/advances/export" query={list.query} label={t('common.export_csv')} />}
        {can('advances.create') && <Link to="/admin/advances/new"><Button variant="primary" icon={<Plus className="size-4" />}>{t('adv.request')}</Button></Link>}
      </>} />
      <StatGrid>
        <StatCard label={t('adv.c.advances')} value={fmtNum(s.advances)} sub={fmtMoney(s.amount)} />
        <StatCard label={t('adv.c.pending')} value={fmtNum(s.pending)} tone={toneIf(s.pending, 'blue')} onClick={() => list.set('status', list.query.status === 'pending' ? null : 'pending')} active={list.query.status === 'pending'} />
        <StatCard label={t('adv.c.approved')} value={fmtNum(s.approved)} tone={toneIf(s.approved, 'blue')} onClick={() => list.set('status', list.query.status === 'approved' ? null : 'approved')} active={list.query.status === 'approved'} />
        <StatCard label={t('adv.c.disbursed')} value={fmtNum(s.disbursed)} sub={t('adv.repaid_x', { n: fmtMoney(s.repaid) })} tone="amber" />
        <StatCard label={t('adv.c.outstanding')} value={fmtMoney(s.outstanding)} tone={s.outstanding > 0 ? 'amber' : 'green'} />
        <StatCard label={t('adv.c.overdue')} value={fmtNum(s.overdue)} sub={fmtMoney(s.overdue_value)} tone={toneIf(s.overdue, 'red')} onClick={() => list.set('overdue', list.query.overdue ? null : '1')} active={!!list.query.overdue} />
      </StatGrid>
      <FilterBar list={list} placeholder={t('adv.search_hint')}>
        <FilterSelect list={list} name="status" label={t('adv.status')} options={Object.keys(ADV_TONE).map((k) => ({ value: k, label: t(`adv.s.${k}`) }))} />
        <FilterSelect list={list} name="company" label={t('adv.company')} options={companies.map((c: any) => ({ value: c.id, label: c.name }))} />
        <FilterSelect list={list} name="overdue" label={t('adv.overdue_only')} options={[{ value: '1', label: t('common.yes') }]} />
        <RiderFilter list={list} name="rider" />
        <FilterDate list={list} name="from" label={t('common.from')} />
        <FilterDate list={list} name="to" label={t('common.to')} />
      </FilterBar>
      <DataTable list={list} columns={columns} onRowClick={(r) => nav(`/admin/advances/${r.id}`)} />
    </>
  );
}

export function AdvanceForm() {
  const { t } = useI18n();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const form = useForm<Record<string, any>>({ rider_id: params.get('rider') ?? '', amount: '', installments: '1', request_date: todayStr(), first_due: '', deduct_from: 'salary', reason: '', notes: '' });
  const v = form.values;
  const amount = Number(latin(String(v.amount))) || 0;
  const n = Math.max(1, Number(v.installments) || 1);
  const each = Math.floor((amount * 100) / n) / 100;
  return (
    <form onSubmit={async (e) => { e.preventDefault(); const r = await form.submit(() => post('/advances', { ...v, amount: latin(String(v.amount)) })); if (r) nav(`/admin/advances/${r.id}`); }}>
      <PageHeader title={t('adv.request')} back="/admin/advances" />
      <Card><Grid cols={3}>
        <RiderInput form={form} name="rider_id" label={t('adv.rider')} required className="sm:col-span-2 lg:col-span-3" />
        <TextInput form={form} name="amount" label={t('adv.amount')} required dir="ltr" placeholder="0.00" />
        <TextInput form={form} name="installments" label={t('adv.installments')} type="number" required />
        <SelectInput form={form} name="deduct_from" label={t('adv.deduct_from')} empty={false} options={['salary', 'commission', 'wallet', 'other'].map((k) => ({ value: k, label: t(`adv.d.${k}`) }))} />
        <TextInput form={form} name="request_date" label={t('adv.request_date')} type="date" />
        <TextInput form={form} name="first_due" label={t('adv.first_due')} type="date" hint={t('adv.first_due_hint')} />
        <TextArea form={form} name="reason" label={t('adv.reason')} maxLength={500} rows={2} className="lg:col-span-1" />
        <TextArea form={form} name="notes" label={t('common.notes')} maxLength={500} rows={2} className="sm:col-span-2 lg:col-span-3" />
      </Grid>
      {amount > 0 && <div className="mt-4"><Alert tone="blue" title={t('adv.expected_split')}>{n === 1 ? fmtMoney(amount) : t('adv.split_text', { n, each: fmtMoney(each), last: fmtMoney(Math.round((amount - each * (n - 1)) * 100) / 100) })}</Alert></div>}
      </Card>
      <SaveBar form={form} editing={false} label={t('adv.save_request')} onCancel={() => nav(-1)} />
    </form>
  );
}

export function AdvanceView() {
  const { id } = useParams();
  const { t } = useI18n();
  const { can } = useAuth();
  const timing = useTiming();
  const [a, setA] = useState<any>(null);
  const load = useCallback(() => get(`/advances/${id}`).then(setA), [id]);
  useEffect(() => { load(); }, [load]);
  const dlg = useMoneyDialog(load);
  const inst = useInstallmentActions(load);
  if (!a) return <Loading />;
  const act = (path: string, title: string, confirm: string, tone: Dlg['tone'], fields: Dlg['fields'] = [], extra: Partial<Dlg> = {}) =>
    dlg.open({ title, confirm, tone, fields, submit: (v) => post(`/advances/${id}/${path}`, v), ...extra });
  const canPayout = a.status === 'approved' || (a.status === 'pending' && !a.requires_approval);
  const actions = [
    a.status === 'pending' && can('advances.approve') && <Button key="a" variant="primary" icon={<Check className="size-4" />} onClick={() => act('approve', t('adv.approve_q', { number: a.number }), t('adv.approve'), 'primary')}>{t('adv.approve')}</Button>,
    a.status === 'pending' && can('advances.reject') && <Button key="r" variant="danger" icon={<X className="size-4" />} onClick={() => act('reject', t('adv.reject'), t('adv.reject'), 'danger', ['reason'], { reasonLabel: t('adv.reject_reason'), body: t('common.cannot_undo') })}>{t('adv.reject')}</Button>,
    canPayout && can('advances.disburse') && <Button key="d" variant="warn" icon={<Banknote className="size-4" />} onClick={() => act('disburse', t('adv.disburse'), t('adv.disburse'), 'warn', ['method', 'date'], { body: t('adv.disburse_body') })}>{t('adv.disburse')}</Button>,
    ['pending', 'approved'].includes(a.status) && can('advances.cancel') && <Button key="c" icon={<Ban className="size-4" />} onClick={() => act('cancel', t('adv.cancel'), t('adv.cancel'), 'danger', ['reason'], { reasonLabel: t('adv.cancel_reason'), body: t('common.cannot_undo') })}>{t('adv.cancel')}</Button>,
  ].filter(Boolean);
  return (
    <>
      <PageHeader title={<span className="num">{a.number}</span>} back="/admin/advances" subtitle={<span className="flex items-center gap-2"><Badge tone={ADV_TONE[a.status]}>{t(`adv.s.${a.status}`)}</Badge>{a.full_name}</span>} />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard label={t('adv.amount')} value={fmtMoney(a.amount)} />
        <StatCard label={t('adv.repaid')} value={fmtMoney(a.repaid)} tone="green" />
        <StatCard label={t('adv.outstanding')} value={fmtMoney(a.outstanding)} tone={a.outstanding > 0 ? 'amber' : 'none'} />
        <StatCard label={t('adv.installments')} value={t('adv.x_of_y', { x: a.inst_done, y: a.installments })} />
        <StatCard label={t('adv.c.overdue')} value={fmtNum(a.overdue)} sub={a.overdue ? fmtMoney(a.overdue_value) : undefined} tone={toneIf(a.overdue, 'red')} />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title={t('adv.actions_card')}>
          {actions.length ? <div className="flex flex-wrap gap-2">{actions}</div> : <p className="text-sm text-zinc-500">{t('adv.no_actions')}</p>}
          {a.decision_note && <div className="mt-3"><Alert tone={a.status === 'rejected' ? 'red' : 'grey'}>{a.decision_note}</Alert></div>}
        </Card>
        <Card title={t('adv.details')}>
          <Details cols={1} rows={[[t('adv.request_date'), fmtDate(a.request_date)], [t('adv.deduct_from'), t(`adv.d.${a.deduct_from}`)], [t('adv.first_due'), fmtDate(a.first_due)],
            [t('adv.reason'), a.reason], [t('common.notes'), a.notes], [t('adv.created_by'), a.created_by_name && <By name={a.created_by_name} at={fmtDateTime(a.created_at)} />],
            [t('adv.decided_by'), a.decided_by_name && <By name={a.decided_by_name} at={fmtDateTime(a.decided_at)} />],
            [t('adv.payout'), a.disbursed_on && <><By name={t(`adv.m.${a.payout_method}`)} at={a.disbursed_on} />{a.disbursed_by_name && ` · ${a.disbursed_by_name}`}</>]]} />
        </Card>
        <Card title={t('adv.rider')}>
          <Details cols={1} rows={[[t('adv.rider'), <Link className="text-brand hover:underline" to={`/admin/riders/${a.rider_id}`}>{a.full_name}</Link>], [t('riders.rider_id'), <span className="num">{a.rider_id}</span>],
            [t('riders.national_id'), a.national_id], [t('riders.phone'), a.phone && <span className="num">{a.phone}</span>], [t('adv.company'), a.company_name], [t('riders.status'), t(`rider.status.${a.rider_status}`)]]} />
        </Card>
      </div>
      <Card title={t('adv.schedule')} className="mt-4" pad={false}>
        {!a.installments_list.length ? <p className="p-4 text-sm text-zinc-500">{t('adv.no_schedule')}</p> : (
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead className="bg-zinc-50/80 text-xs text-zinc-500 dark:bg-zinc-800/30"><tr>{['#', t('adv.due'), t('adv.amount'), t('adv.repaid'), t('adv.status'), ''].map((h, i) => <th key={i} className="px-3 py-2 text-start font-medium">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {a.installments_list.map((i: any) => {
                const tone = instTone(i);
                const open = ['due', 'partial'].includes(i.status);
                return (
                  <tr key={i.id} className={tone === 'red' ? 'bg-red-50/60 dark:bg-red-950/20' : tone === 'amber' ? 'bg-amber-50/60 dark:bg-amber-950/20' : ''}>
                    <td className="px-3 py-2 num">{i.n}</td>
                    <td className="px-3 py-2"><div className="num">{i.due_date}</div>{open && <div className={`text-xs ${tone === 'red' ? 'text-red-600' : 'text-zinc-500'}`}>{timing(i.days_left)}</div>}</td>
                    <td className="px-3 py-2 num">{fmtNum(i.amount, 2)}</td>
                    <td className="px-3 py-2 num">{fmtNum(i.paid, 2)}{i.paid_on && <div className="text-xs text-zinc-500">{i.paid_on}</div>}</td>
                    <td className="px-3 py-2"><Badge tone={INST_TONE[i.status]}>{t(`adv.i.${i.status}`)}</Badge>{i.waive_reason && <div className="text-xs text-zinc-500">{i.waive_reason}</div>}</td>
                    <td className="px-3 py-2"><div className="flex justify-end">
                      {open && can('advance_installments.repay') && <IconButton title={t('adv.record_repayment')} tone="green" onClick={() => inst.repay(i)}><HandCoins /></IconButton>}
                      {open && can('advance_installments.waive') && <IconButton title={t('adv.waive')} tone="amber" onClick={() => inst.waive(i)}><Undo2 /></IconButton>}
                    </div></td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        )}
      </Card>
      {dlg.node}{inst.node}
    </>
  );
}

// ======================================================================== instalments due
export function AdvancesDue() {
  const { t } = useI18n();
  const { can } = useAuth();
  const nav = useNavigate();
  const timing = useTiming();
  const list = useList('/advances/due');
  const companies = useOptions<any>('/lookups/companies');
  const inst = useInstallmentActions(list.reload);
  const s = list.stats ?? {};
  const columns: Column<any>[] = [
    { key: 'due', header: t('adv.due'), sort: 'due', render: (r) => <div><div className="num">{r.due_date}</div><div className={`text-xs ${r.days_left < 0 ? 'text-red-600' : r.days_left <= 7 ? 'text-amber-600' : 'text-zinc-500'}`}>{timing(r.days_left)}</div></div> },
    { key: 'rider', header: t('adv.rider'), render: (r) => <div><Link to={`/admin/riders/${r.rider_id}`} className="font-medium hover:text-brand">{r.full_name}</Link><div className="text-xs text-zinc-500">{r.company_name}</div></div> },
    { key: 'adv', header: t('adv.advance'), render: (r) => <div><div className="num">{r.number}</div><div className="text-xs text-zinc-500">{t('adv.inst_x_of_y', { x: r.n, y: r.installments })}</div></div> },
    { key: 'amount', header: t('adv.amount'), render: (r) => <span className="num">{fmtNum(r.amount, 2)}</span> },
    { key: 'left', header: t('adv.outstanding'), render: (r) => <div className="num"><div className="font-medium">{fmtNum(r.amount - r.paid, 2)}</div>{r.paid > 0 && <div className="text-xs text-zinc-500">{t('adv.repaid_x', { n: fmtNum(r.paid, 2) })}</div>}</div> },
    { key: 'status', header: t('adv.status'), render: (r) => <Badge tone={INST_TONE[r.status]}>{t(`adv.i.${r.status}`)}</Badge> },
    { key: 'actions', header: t('common.actions'), render: (r) => <div className="flex">
      <IconButton title={t('adv.open_advance')} onClick={() => nav(`/admin/advances/${r.advance_id}`)}><Eye /></IconButton>
      {can('advance_installments.repay') && <IconButton title={t('adv.record_repayment')} tone="green" onClick={() => inst.repay(r)}><HandCoins /></IconButton>}
      {can('advance_installments.waive') && <IconButton title={t('adv.waive')} tone="amber" onClick={() => inst.waive(r)}><Undo2 /></IconButton>}
    </div> },
  ];
  return (
    <>
      <PageHeader title={t('adv.due_title')} back="/admin/advances" actions={<>
        <Link to="/admin/advances"><Button variant="ghost">{t('adv.ledger')}</Button></Link>
        {can('advance_installments.export') && <ExportButton path="/advances/due/export" query={list.query} label={t('common.export_csv')} />}
      </>} />
      <StatGrid>
        <StatCard label={t('adv.c.open_inst')} value={fmtNum(s.open)} />
        <StatCard label={t('adv.c.owed')} value={fmtMoney(s.owed)} tone="amber" />
        <StatCard label={t('adv.c.of_overdue')} value={fmtNum(s.overdue)} tone={toneIf(s.overdue, 'red')} onClick={() => list.set('overdue', list.query.overdue ? null : '1')} active={!!list.query.overdue} />
        <StatCard label={t('adv.c.overdue_value')} value={fmtMoney(s.overdue_value)} tone={toneIf(s.overdue_value, 'red')} />
      </StatGrid>
      <FilterBar list={list} placeholder={t('adv.search_hint')}>
        <FilterSelect list={list} name="window" label={t('adv.window')} allLabel={t('adv.w.30')} options={[60, 90, 365].map((n) => ({ value: n, label: t(`adv.w.${n}`) }))} />
        <FilterSelect list={list} name="overdue" label={t('adv.overdue_only')} options={[{ value: '1', label: t('common.yes') }]} />
        <FilterSelect list={list} name="company" label={t('adv.company')} options={companies.map((c: any) => ({ value: c.id, label: c.name }))} />
        <RiderFilter list={list} name="rider" />
      </FilterBar>
      <DataTable list={list} columns={columns} />
      {inst.node}
    </>
  );
}
