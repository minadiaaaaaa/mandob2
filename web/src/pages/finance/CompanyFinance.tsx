// Finance → Company finance (phase 6): the company's own money. Overview (balance, this month, what is due, the
// three setup steps), entries with void and transfer, accounts, categories and suppliers, obligations and their
// payments due, assets and stock. The server keeps every rule (domain/companyFinance.ts).
import { useEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowLeftRight, Ban, CheckCircle2, Circle, CreditCard, History, Minus, Pencil, Plus, SkipForward, Trash2 } from 'lucide-react';
import { del, get, patch, post } from '../../api';
import { useAuth } from '../../auth';
import { fmtDate, fmtMoney, fmtNum, useI18n } from '../../i18n';
import { Badge, Button, Card, IconButton, PageHeader, SidePanel, StatCard, StatGrid, Tabs, toneIf, useAction, useUi } from '../../ui/kit';
import { Grid, RiderInput, SelectInput, TextArea, TextInput, useForm } from '../../ui/forms';
import { DataTable, FilterBar, FilterSelect, useList, type Column } from '../../ui/table';
import { ExportButton, localName, useOptions, invalidateOptions } from '../../ui/common';

const TABS = ['overview', 'entries', 'obligations', 'accounts', 'categories', 'assets', 'stock'] as const;
type Tab = (typeof TABS)[number];

// A small editable list with a side panel: used by accounts, categories, suppliers, assets, stock items.
function useEditor<T extends Record<string, any>>(empty: T, save: (v: any, row: any) => Promise<unknown>, done: () => void) {
  const form = useForm<Record<string, any>>(empty);
  const [row, setRow] = useState<any | null>(null);
  const open = (r?: any) => { form.reset(r ? Object.fromEntries(Object.keys(empty).map((k) => [k, r[k] ?? (typeof empty[k] === 'boolean' ? false : '')])) : empty); setRow(r ?? {}); };
  const submit = async () => { const r = await form.submit(() => save(row?.id ? form.changes : form.values, row)); if (r) { setRow(null); done(); } };
  return { form, row, open, close: () => setRow(null), submit };
}
function Panel({ ed, title, children }: { ed: ReturnType<typeof useEditor>; title: ReactNode; children: ReactNode }) {
  const { t } = useI18n();
  return <SidePanel open={!!ed.row} onClose={ed.close} title={title}
    footer={<><Button onClick={ed.close}>{t('common.cancel')}</Button><Button variant="primary" disabled={ed.form.busy} onClick={ed.submit}>{t('common.save')}</Button></>}>
    <form onSubmit={(e) => { e.preventDefault(); ed.submit(); }}>{children}</form></SidePanel>;
}
const Table = ({ heads, children, empty }: { heads: ReactNode[]; children: ReactNode; empty?: ReactNode }) => (
  <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800"><table className="w-full text-sm">
    <thead className="bg-zinc-50 text-xs text-zinc-500 dark:bg-zinc-900"><tr>{heads.map((h, i) => <th key={i} className="whitespace-nowrap px-3 py-2 text-start font-medium">{h}</th>)}</tr></thead>
    <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">{children}</tbody></table>{empty}</div>);
const Td = ({ children, num }: { children?: ReactNode; num?: boolean }) => <td className={`px-3 py-2 ${num ? 'num' : ''}`}>{children}</td>;

export function CompanyFinancePage() {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.includes(params.get('tab') as Tab) ? params.get('tab') : 'overview') as Tab;
  return (
    <>
      <PageHeader title={t('fin2.title')} subtitle={t('fin2.intro')} />
      <Tabs value={tab} onChange={(k) => setParams(k === 'overview' ? {} : { tab: k })} tabs={TABS.map((k) => ({ key: k, label: t(`fin2.tab.${k}`) }))} />
      {tab === 'overview' && <Overview go={(k) => setParams({ tab: k })} />}
      {tab === 'entries' && <Entries />}
      {tab === 'obligations' && <Obligations />}
      {tab === 'accounts' && <Accounts />}
      {tab === 'categories' && <CategoriesSuppliers />}
      {tab === 'assets' && <Assets />}
      {tab === 'stock' && <Stock />}
    </>
  );
}

// ======================================================================== overview
function Overview({ go }: { go: (k: Tab) => void }) {
  const { t } = useI18n();
  const [o, setO] = useState<any | null>(null);
  useEffect(() => { get('/company-finance/overview').then(setO).catch(() => setO(null)); }, []);
  if (!o) return null;
  const steps = [['account', 'accounts'], ['categories', 'categories'], ['entry', 'entries']] as const;
  const done = steps.filter(([k]) => o.setup[k]).length;
  return (
    <div className="space-y-4">
      <StatGrid>
        <StatCard label={t('fin2.balance')} value={fmtMoney(o.balance)} tone={o.balance < 0 ? 'red' : 'green'} sub={t('fin2.balance_sub', { n: o.accounts })} onClick={() => go('accounts')} />
        <StatCard label={t('fin2.month_net')} value={fmtMoney(o.flow.net)} tone={o.flow.net < 0 ? 'red' : 'none'} sub={`${t('fin2.in')} ${fmtMoney(o.flow.inflow)} · ${t('fin2.out')} ${fmtMoney(o.flow.outflow)}`} onClick={() => go('entries')} />
        <StatCard label={t('fin2.overdue')} value={fmtMoney(o.dues.overdue)} tone={toneIf(o.dues.overdue_count, 'red')} sub={t('fin2.n_items', { n: o.dues.overdue_count })} onClick={() => go('obligations')} />
        <StatCard label={t('fin2.upcoming')} value={fmtMoney(o.dues.upcoming)} tone={toneIf(o.dues.upcoming_count, 'amber')} sub={t('fin2.next_30', { n: o.dues.upcoming_count })} onClick={() => go('obligations')} />
      </StatGrid>
      {done < 3 && <Card title={t('fin2.setup_title', { done, n: 3 })}>
        <ol className="space-y-2 text-sm">{steps.map(([k, tabKey]) => <li key={k} className="flex items-start gap-2">
          {o.setup[k] ? <CheckCircle2 className="mt-0.5 size-4 text-emerald-600" /> : <Circle className="mt-0.5 size-4 text-zinc-400" />}
          <button type="button" className="text-start" onClick={() => go(tabKey)}><div className="font-medium">{t(`fin2.setup.${k}`)}</div><div className="text-xs text-zinc-500">{t(`fin2.setup.${k}_hint`)}</div></button></li>)}</ol>
      </Card>}
    </div>
  );
}

// ======================================================================== entries
function Entries() {
  const { t, lang } = useI18n();
  const { can } = useAuth();
  const run = useAction();
  const { confirm } = useUi();
  const list = useList('/fin-entries');
  const accounts = useOptions<any>('/fin-accounts');
  const cats = useOptions<any>('/fin-categories');
  const sups = useOptions<any>('/fin-suppliers');
  const [mode, setMode] = useState<'in' | 'out' | 'transfer' | null>(null);
  const [voiding, setVoiding] = useState<any | null>(null);
  const form = useForm<Record<string, any>>({});
  const s = list.stats ?? {};
  const open = (m: 'in' | 'out' | 'transfer') => { form.reset(m === 'transfer' ? { from_account_id: '', to_account_id: '', amount: '', entry_date: '', note: '' } : { direction: m, account_id: accounts[0]?.id ?? '', category_id: '', supplier_id: '', amount: '', entry_date: '', description: '', reference: '' }); setMode(m); };
  const save = async () => { const r = await form.submit(() => post(mode === 'transfer' ? '/fin-transfers' : '/fin-entries', form.values)); if (r) { setMode(null); list.reload(); invalidateOptions('/fin-accounts'); } };
  const doVoid = async () => {
    const reason = voiding.reason?.trim();
    if (!reason) return;
    if (await run(() => post(`/fin-entries/${voiding.id}/void`, { reason }), t('fin2.voided'))) { setVoiding(null); list.reload(); invalidateOptions('/fin-accounts'); }
  };
  const accOpts = accounts.filter((a) => a.is_active).map((a) => ({ value: a.id, label: `${a.name} · ${fmtMoney(a.balance)}` }));
  const catOpts = (dir: string) => cats.filter((c) => c.is_active && (c.kind === 'income') === (dir === 'in')).map((c) => ({ value: c.id, label: localName(lang, c.name_ar, c.name_en) }));
  const columns: Column<any>[] = [
    { key: 'date', header: t('fin2.date'), sort: 'date', render: (r) => <span className="num">{fmtDate(r.entry_date)}</span> },
    { key: 'amount', header: t('fin2.amount'), sort: 'amount', render: (r) => <span className={`num font-medium ${r.voided_at ? 'text-zinc-400 line-through' : r.direction === 'in' ? 'text-emerald-600' : 'text-red-600'}`}>{r.direction === 'in' ? '+' : '−'}{fmtMoney(r.amount)}</span> },
    { key: 'account', header: t('fin2.account'), render: (r) => r.account_name },
    { key: 'category', header: t('fin2.category'), render: (r) => <div>{r.category_ar ? localName(lang, r.category_ar, r.category_en) : r.transfer_group ? <Badge tone="blue">{t('fin2.transfer')}</Badge> : '—'}{r.supplier_name && <div className="text-xs text-zinc-500">{r.supplier_name}</div>}</div> },
    { key: 'description', header: t('fin2.description'), render: (r) => <div className="max-w-72 text-xs">{r.description}{r.reference && <div className="num text-zinc-500">{r.reference}</div>}
      {r.voided_at && <div className="text-red-600">{t('fin2.void')}: {r.void_reason}</div>}{r.source_type !== 'manual' && r.source_type !== 'transfer' && <Badge tone="grey">{t(`fin2.src.${r.source_type}`)}</Badge>}</div> },
    { key: 'actions', header: t('common.actions'), render: (r) => !r.voided_at && r.source_type !== 'payroll' && can('company_finance.void') ? <IconButton title={t('fin2.void')} tone="red" onClick={() => setVoiding({ id: r.id, reason: '' })}><Ban /></IconButton> : null },
  ];
  return (
    <>
      <StatGrid>
        <StatCard label={t('fin2.in')} value={fmtMoney(s.inflow)} tone="green" onClick={() => list.set('direction', list.query.direction === 'in' ? null : 'in')} active={list.query.direction === 'in'} />
        <StatCard label={t('fin2.out')} value={fmtMoney(s.outflow)} tone="red" onClick={() => list.set('direction', list.query.direction === 'out' ? null : 'out')} active={list.query.direction === 'out'} />
      </StatGrid>
      <FilterBar list={list} placeholder={t('fin2.search_hint')} actions={<>
        {can('company_finance.export') && <ExportButton path="/fin-entries/export" query={list.query} />}
        {can('company_finance.create') && <><Button icon={<Plus className="size-4" />} onClick={() => open('in')}>{t('fin2.money_in')}</Button>
          <Button icon={<Minus className="size-4" />} onClick={() => open('out')}>{t('fin2.money_out')}</Button>
          <Button icon={<ArrowLeftRight className="size-4" />} onClick={() => open('transfer')}>{t('fin2.transfer')}</Button></>}
      </>}>
        <FilterSelect list={list} name="account" label={t('fin2.account')} options={accounts.map((a) => ({ value: a.id, label: a.name }))} />
        <FilterSelect list={list} name="category" label={t('fin2.category')} options={cats.map((c) => ({ value: c.id, label: localName(lang, c.name_ar, c.name_en) }))} />
        <FilterSelect list={list} name="voided" label={t('fin2.void')} options={[{ value: '0', label: t('fin2.live_only') }, { value: '1', label: t('fin2.voided_only') }]} />
      </FilterBar>
      <DataTable list={list} columns={columns} emptyText={t('fin2.no_entries')} />
      <SidePanel open={!!mode} onClose={() => setMode(null)} title={mode ? t(mode === 'transfer' ? 'fin2.transfer' : mode === 'in' ? 'fin2.money_in' : 'fin2.money_out') : ''}
        footer={<><Button onClick={() => setMode(null)}>{t('common.cancel')}</Button><Button variant="primary" disabled={form.busy} onClick={save}>{t('common.save')}</Button></>}>
        <form onSubmit={(e) => { e.preventDefault(); save(); }}>
          {mode === 'transfer' ? <Grid>
            <SelectInput form={form} name="from_account_id" label={t('fin2.from_account')} required options={accOpts} />
            <SelectInput form={form} name="to_account_id" label={t('fin2.to_account')} required options={accOpts} />
            <TextInput form={form} name="amount" type="number" label={t('fin2.amount')} required dir="ltr" />
            <TextInput form={form} name="entry_date" type="date" label={t('fin2.date')} hint={t('svc.paid_on_hint')} />
          </Grid> : <Grid>
            <SelectInput form={form} name="account_id" label={t('fin2.account')} required options={accOpts} />
            <TextInput form={form} name="amount" type="number" label={t('fin2.amount')} required dir="ltr" />
            <SelectInput form={form} name="category_id" label={t('fin2.category')} options={catOpts(mode ?? 'out')} />
            <SelectInput form={form} name="supplier_id" label={t('fin2.supplier')} options={sups.filter((x) => x.is_active).map((x) => ({ value: x.id, label: x.name }))} />
            <TextInput form={form} name="entry_date" type="date" label={t('fin2.date')} hint={t('svc.paid_on_hint')} />
            <TextInput form={form} name="reference" label={t('fin2.reference')} maxLength={100} />
          </Grid>}
          <TextInput form={form} name={mode === 'transfer' ? 'note' : 'description'} label={t('fin2.description')} maxLength={255} />
        </form>
      </SidePanel>
      {voiding && <SidePanel open onClose={() => setVoiding(null)} title={t('fin2.void_title')}
        footer={<><Button onClick={() => setVoiding(null)}>{t('common.cancel')}</Button><Button variant="danger" disabled={!voiding.reason?.trim()} onClick={async () => { if (await confirm({ title: t('fin2.void_q'), tone: 'warn' })) doVoid(); }}>{t('fin2.void')}</Button></>}>
        <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-400">{t('fin2.void_body')}</p>
        <input className="input" placeholder={t('fin2.void_reason')} maxLength={255} value={voiding.reason} onChange={(e) => setVoiding({ ...voiding, reason: e.target.value })} />
      </SidePanel>}
    </>
  );
}

// ======================================================================== accounts
function Accounts() {
  const { t } = useI18n();
  const { can } = useAuth();
  const run = useAction();
  const [rows, setRows] = useState<any[]>([]);
  const load = () => get<any[]>('/fin-accounts').then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); }, []);
  const ed = useEditor({ name: '', kind: 'cash', bank_name: '', iban: '', opening_balance: '', opening_date: '' },
    (v, row) => (row?.id ? patch(`/fin-accounts/${row.id}`, v) : post('/fin-accounts', v)), () => { load(); invalidateOptions('/fin-accounts'); });
  const toggle = async (r: any) => { if (await run(() => patch(`/fin-accounts/${r.id}`, { is_active: !r.is_active }), t('common.saved'))) load(); };
  return (
    <>
      {can('company_finance.create') && <div className="mb-3"><Button variant="primary" icon={<Plus className="size-4" />} onClick={() => ed.open()}>{t('fin2.new_account')}</Button></div>}
      <Table heads={[t('fin2.account'), t('fin2.kind'), t('fin2.opening'), t('fin2.balance'), t('common.actions')]} empty={!rows.length && <p className="p-4 text-sm text-zinc-500">{t('fin2.no_accounts')}</p>}>
        {rows.map((r) => <tr key={r.id} className={r.is_active ? '' : 'opacity-60'}>
          <Td><div className="font-medium">{r.name}</div>{r.iban && <div className="num text-xs text-zinc-500" dir="ltr">{r.iban}</div>}</Td>
          <Td>{t(`fin2.k.${r.kind}`)}{r.bank_name ? ` · ${r.bank_name}` : ''}</Td>
          <Td num>{fmtMoney(r.opening_balance)}{r.opening_date && <div className="text-xs text-zinc-500">{fmtDate(r.opening_date)}</div>}</Td>
          <Td num><span className={Number(r.balance) < 0 ? 'text-red-600' : 'font-medium'}>{fmtMoney(r.balance)}</span></Td>
          <Td>{can('company_finance.update') && <div className="flex"><IconButton title={t('common.edit')} onClick={() => ed.open(r)}><Pencil /></IconButton>
            <IconButton title={r.is_active ? t('common.disable') : t('common.enable')} tone={r.is_active ? 'amber' : 'green'} onClick={() => toggle(r)}><Ban /></IconButton></div>}</Td></tr>)}
      </Table>
      <Panel ed={ed} title={ed.row?.id ? t('fin2.edit_account') : t('fin2.new_account')}>
        <Grid>
          <TextInput form={ed.form} name="name" label={t('fin2.account_name')} required maxLength={100} />
          <SelectInput form={ed.form} name="kind" label={t('fin2.kind')} empty={false} options={['cash', 'bank'].map((k) => ({ value: k, label: t(`fin2.k.${k}`) }))} />
          {ed.form.values.kind === 'bank' && <><TextInput form={ed.form} name="bank_name" label={t('bank.bank_name')} maxLength={100} />
            <TextInput form={ed.form} name="iban" label={t('bank.iban')} dir="ltr" maxLength={40} /></>}
          <TextInput form={ed.form} name="opening_balance" type="number" label={t('fin2.opening')} dir="ltr" hint={t('fin2.opening_hint')} />
          <TextInput form={ed.form} name="opening_date" type="date" label={t('fin2.opening_date')} />
        </Grid>
      </Panel>
    </>
  );
}

// ======================================================================== categories and suppliers
function CategoriesSuppliers() {
  const { t, lang } = useI18n();
  const { can } = useAuth();
  const run = useAction();
  const [cats, setCats] = useState<any[]>([]);
  const [sups, setSups] = useState<any[]>([]);
  const load = () => { get<any[]>('/fin-categories').then(setCats).catch(() => setCats([])); get<any[]>('/fin-suppliers').then(setSups).catch(() => setSups([])); };
  useEffect(() => { load(); }, []);
  const changed = () => { load(); invalidateOptions('/fin-categories'); invalidateOptions('/fin-suppliers'); };
  const cat = useEditor({ name_ar: '', name_en: '', kind: 'expense' }, (v, row) => (row?.id ? patch(`/fin-categories/${row.id}`, { name_ar: v.name_ar, name_en: v.name_en }) : post('/fin-categories', v)), changed);
  const sup = useEditor({ name: '', phone: '', vat_number: '', notes: '' }, (v, row) => (row?.id ? patch(`/fin-suppliers/${row.id}`, v) : post('/fin-suppliers', v)), changed);
  const toggle = async (path: string, r: any) => { if (await run(() => patch(`${path}/${r.id}`, { is_active: !r.is_active }), t('common.saved'))) changed(); };
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div>
        <div className="mb-2 flex items-center justify-between"><h3 className="font-medium">{t('fin2.categories')}</h3>
          {can('company_finance.create') && <Button size="sm" icon={<Plus className="size-4" />} onClick={() => cat.open()}>{t('fin2.new_category')}</Button>}</div>
        <Table heads={[t('fin2.category'), t('fin2.kind'), t('fin2.entries_n'), '']}>
          {cats.map((c) => <tr key={c.id} className={c.is_active ? '' : 'opacity-60'}>
            <Td>{localName(lang, c.name_ar, c.name_en)} {c.builtin_key && <Badge tone="grey">{t('designations.builtin')}</Badge>}</Td>
            <Td><Badge tone={c.kind === 'income' ? 'green' : 'red'}>{t(`fin2.k.${c.kind}`)}</Badge></Td><Td num>{fmtNum(c.entries)}</Td>
            <Td>{can('company_finance.update') && <div className="flex"><IconButton title={t('common.edit')} onClick={() => cat.open(c)}><Pencil /></IconButton>
              <IconButton title={c.is_active ? t('common.disable') : t('common.enable')} tone={c.is_active ? 'amber' : 'green'} onClick={() => toggle('/fin-categories', c)}><Ban /></IconButton></div>}</Td></tr>)}
        </Table>
      </div>
      <div>
        <div className="mb-2 flex items-center justify-between"><h3 className="font-medium">{t('fin2.suppliers')}</h3>
          {can('company_finance.create') && <Button size="sm" icon={<Plus className="size-4" />} onClick={() => sup.open()}>{t('fin2.new_supplier')}</Button>}</div>
        <Table heads={[t('fin2.supplier'), t('fin2.vat_number'), t('fin2.entries_n'), '']} empty={!sups.length && <p className="p-4 text-sm text-zinc-500">{t('fin2.no_suppliers')}</p>}>
          {sups.map((s) => <tr key={s.id} className={s.is_active ? '' : 'opacity-60'}>
            <Td><div>{s.name}</div>{s.phone && <div className="num text-xs text-zinc-500" dir="ltr">{s.phone}</div>}</Td><Td num>{s.vat_number ?? '—'}</Td><Td num>{fmtNum(s.entries)}</Td>
            <Td>{can('company_finance.update') && <div className="flex"><IconButton title={t('common.edit')} onClick={() => sup.open(s)}><Pencil /></IconButton>
              <IconButton title={s.is_active ? t('common.disable') : t('common.enable')} tone={s.is_active ? 'amber' : 'green'} onClick={() => toggle('/fin-suppliers', s)}><Ban /></IconButton></div>}</Td></tr>)}
        </Table>
      </div>
      <Panel ed={cat} title={cat.row?.id ? t('fin2.edit_category') : t('fin2.new_category')}>
        <Grid><TextInput form={cat.form} name="name_ar" label={t('branches.name_ar')} required maxLength={100} /><TextInput form={cat.form} name="name_en" label={t('branches.name_en')} dir="ltr" maxLength={100} />
          {!cat.row?.id && <SelectInput form={cat.form} name="kind" label={t('fin2.kind')} empty={false} options={['expense', 'income'].map((k) => ({ value: k, label: t(`fin2.k.${k}`) }))} />}</Grid>
      </Panel>
      <Panel ed={sup} title={sup.row?.id ? t('fin2.edit_supplier') : t('fin2.new_supplier')}>
        <Grid><TextInput form={sup.form} name="name" label={t('fin2.supplier')} required maxLength={150} /><TextInput form={sup.form} name="phone" label={t('riders.mobile')} dir="ltr" maxLength={30} />
          <TextInput form={sup.form} name="vat_number" label={t('fin2.vat_number')} dir="ltr" maxLength={20} /></Grid>
        <TextArea form={sup.form} name="notes" label={t('common.notes')} maxLength={255} />
      </Panel>
    </div>
  );
}

// ======================================================================== obligations
function Obligations() {
  const { t, lang } = useI18n();
  const { can } = useAuth();
  const run = useAction();
  const { confirm } = useUi();
  const [data, setData] = useState<any | null>(null);
  const [dues, setDues] = useState<any[]>([]);
  const [show, setShow] = useState('open');
  const [paying, setPaying] = useState<any | null>(null);
  const accounts = useOptions<any>('/fin-accounts');
  const cats = useOptions<any>('/fin-categories');
  const sups = useOptions<any>('/fin-suppliers');
  const load = () => { get('/fin-obligations').then(setData).catch(() => setData({ rows: [], summary: {} })); get<any[]>('/fin-dues', { status: show }).then(setDues).catch(() => setDues([])); };
  useEffect(() => { load(); }, [show]); // eslint-disable-line react-hooks/exhaustive-deps
  const ed = useEditor({ title: '', kind: 'monthly', amount: '', start_date: '', end_date: '', supplier_id: '', category_id: '', account_id: '', notes: '' },
    (v, row) => (row?.id ? patch(`/fin-obligations/${row.id}`, v) : post('/fin-obligations', v)), load);
  const payForm = useForm<Record<string, any>>({ account_id: '', paid_on: '', reference: '' });
  const pay = async () => { const r = await payForm.submit(() => post(`/fin-dues/${paying.id}/pay`, payForm.values)); if (r) { setPaying(null); load(); invalidateOptions('/fin-accounts'); } };
  const skip = async (d: any) => { if (!(await confirm({ title: t('fin2.skip_q'), tone: 'warn' }))) return; if (await run(() => post(`/fin-dues/${d.id}/skip`), t('common.saved'))) load(); };
  const end = async (o: any) => { if (await run(() => patch(`/fin-obligations/${o.id}`, { status: o.status === 'active' ? 'ended' : 'active' }), t('common.saved'))) load(); };
  const remove = async (o: any) => { if (!(await confirm({ title: t('fin2.delete_obligation_q'), tone: 'warn' }))) return; if (await run(() => del(`/fin-obligations/${o.id}`), t('common.deleted'))) load(); };
  const today = new Date().toISOString().slice(0, 10);
  const sm = data?.summary ?? {};
  return (
    <>
      <StatGrid>
        <StatCard label={t('fin2.overdue')} value={fmtMoney(sm.overdue)} tone={toneIf(sm.overdue_count, 'red')} sub={t('fin2.n_items', { n: sm.overdue_count ?? 0 })} onClick={() => setShow('overdue')} active={show === 'overdue'} />
        <StatCard label={t('fin2.upcoming')} value={fmtMoney(sm.upcoming)} tone={toneIf(sm.upcoming_count, 'amber')} sub={t('fin2.next_30', { n: sm.upcoming_count ?? 0 })} onClick={() => setShow('open')} active={show === 'open'} />
        <StatCard label={t('fin2.paid_dues')} value={<History className="size-5" />} onClick={() => setShow('paid')} active={show === 'paid'} />
      </StatGrid>
      <h3 className="mb-2 font-medium">{t(`fin2.dues_${show}`)}</h3>
      <Table heads={[t('fin2.due_date'), t('fin2.obligation'), t('fin2.amount'), t('fin2.status'), '']} empty={!dues.length && <p className="p-4 text-sm text-zinc-500">{t('fin2.no_dues')}</p>}>
        {dues.map((d) => <tr key={d.id}>
          <Td num><span className={d.status === 'due' && String(d.due_date).slice(0, 10) < today ? 'text-red-600' : ''}>{fmtDate(d.due_date)}</span></Td>
          <Td>{d.title}{d.supplier_name && <div className="text-xs text-zinc-500">{d.supplier_name}</div>}</Td><Td num>{fmtMoney(d.amount)}</Td>
          <Td><Badge tone={d.status === 'paid' ? 'green' : d.status === 'skipped' ? 'grey' : String(d.due_date).slice(0, 10) < today ? 'red' : 'amber'}>{t(`fin2.due.${d.status === 'due' && String(d.due_date).slice(0, 10) < today ? 'overdue' : d.status}`)}</Badge>
            {d.paid_on && <div className="num text-xs text-zinc-500">{fmtDate(d.paid_on)}</div>}</Td>
          <Td>{d.status === 'due' && can('obligations.pay') && <div className="flex"><IconButton title={t('fin2.pay')} tone="green" onClick={() => { payForm.reset({ account_id: accounts.find((a) => a.is_active)?.id ?? '', paid_on: '', reference: '' }); setPaying(d); }}><CreditCard /></IconButton>
            <IconButton title={t('fin2.skip')} onClick={() => skip(d)}><SkipForward /></IconButton></div>}</Td></tr>)}
      </Table>
      <div className="mb-2 mt-6 flex items-center justify-between"><h3 className="font-medium">{t('fin2.obligations')}</h3>
        {can('obligations.create') && <Button size="sm" variant="primary" icon={<Plus className="size-4" />} onClick={() => ed.open()}>{t('fin2.new_obligation')}</Button>}</div>
      <Table heads={[t('fin2.obligation'), t('fin2.kind'), t('fin2.amount'), t('fin2.next_due'), t('fin2.status'), '']} empty={!data?.rows?.length && <p className="p-4 text-sm text-zinc-500">{t('fin2.no_obligations')}</p>}>
        {(data?.rows ?? []).map((o: any) => <tr key={o.id} className={o.status === 'active' ? '' : 'opacity-60'}>
          <Td><div className="font-medium">{o.title}</div><div className="text-xs text-zinc-500">{[o.supplier_name, o.category_ar && localName(lang, o.category_ar, o.category_en)].filter(Boolean).join(' · ')}</div></Td>
          <Td>{t(`fin2.ob.${o.kind}`)}</Td><Td num>{fmtMoney(o.amount)}</Td>
          <Td num>{o.next_due ? fmtDate(o.next_due) : '—'}{Number(o.overdue) > 0 && <div className="text-xs text-red-600">{t('fin2.overdue')}: {fmtMoney(o.overdue)}</div>}</Td>
          <Td><Badge tone={o.status === 'active' ? 'green' : 'grey'}>{t(`fin2.obs.${o.status}`)}</Badge></Td>
          <Td><div className="flex">{can('obligations.update') && <><IconButton title={t('common.edit')} onClick={() => ed.open({ ...o, start_date: String(o.start_date).slice(0, 10), end_date: o.end_date ? String(o.end_date).slice(0, 10) : '' })}><Pencil /></IconButton>
            <IconButton title={o.status === 'active' ? t('fin2.end') : t('fin2.resume')} onClick={() => end(o)}><Ban /></IconButton></>}
            {can('obligations.delete') && <IconButton title={t('common.delete')} tone="red" onClick={() => remove(o)}><Trash2 /></IconButton>}</div></Td></tr>)}
      </Table>
      <Panel ed={ed} title={ed.row?.id ? t('fin2.edit_obligation') : t('fin2.new_obligation')}>
        <TextInput form={ed.form} name="title" label={t('fin2.obligation')} required maxLength={150} />
        <Grid>
          <SelectInput form={ed.form} name="kind" label={t('fin2.kind')} empty={false} options={['monthly', 'once'].map((k) => ({ value: k, label: t(`fin2.ob.${k}`) }))} />
          <TextInput form={ed.form} name="amount" type="number" label={t('fin2.amount')} required dir="ltr" />
          <TextInput form={ed.form} name="start_date" type="date" label={ed.form.values.kind === 'once' ? t('fin2.due_date') : t('fin2.first_due')} required />
          {ed.form.values.kind === 'monthly' && <TextInput form={ed.form} name="end_date" type="date" label={t('fin2.last_due')} />}
          <SelectInput form={ed.form} name="supplier_id" label={t('fin2.supplier')} options={sups.map((s) => ({ value: s.id, label: s.name }))} />
          <SelectInput form={ed.form} name="category_id" label={t('fin2.category')} options={cats.filter((c) => c.kind === 'expense' && c.is_active).map((c) => ({ value: c.id, label: localName(lang, c.name_ar, c.name_en) }))} />
        </Grid>
        <TextArea form={ed.form} name="notes" label={t('common.notes')} maxLength={255} />
      </Panel>
      {paying && <SidePanel open onClose={() => setPaying(null)} title={t('fin2.pay_title', { title: paying.title })}
        footer={<><Button onClick={() => setPaying(null)}>{t('common.cancel')}</Button><Button variant="primary" disabled={payForm.busy} onClick={pay}>{t('fin2.pay')}</Button></>}>
        <p className="mb-3 text-sm">{t('fin2.amount')}: <span className="num font-medium">{fmtMoney(paying.amount)}</span> · {fmtDate(paying.due_date)}</p>
        <Grid><SelectInput form={payForm} name="account_id" label={t('fin2.account')} required options={accounts.filter((a) => a.is_active).map((a) => ({ value: a.id, label: `${a.name} · ${fmtMoney(a.balance)}` }))} />
          <TextInput form={payForm} name="paid_on" type="date" label={t('svc.paid_on')} hint={t('svc.paid_on_hint')} /></Grid>
        <TextInput form={payForm} name="reference" label={t('fin2.reference')} maxLength={100} />
      </SidePanel>}
    </>
  );
}

// ======================================================================== assets
function Assets() {
  const { t } = useI18n();
  const { can } = useAuth();
  const run = useAction();
  const { confirm } = useUi();
  const [d, setD] = useState<any>({ rows: [], total: 0 });
  const load = () => get('/fin-assets').then(setD).catch(() => setD({ rows: [], total: 0 }));
  useEffect(() => { load(); }, []);
  const ed = useEditor({ name: '', category: '', value: '', purchase_date: '', status: 'in_use', notes: '' }, (v, row) => (row?.id ? patch(`/fin-assets/${row.id}`, v) : post('/fin-assets', v)), load);
  const remove = async (r: any) => { if (!(await confirm({ title: t('fin2.delete_asset_q'), tone: 'warn' }))) return; if (await run(() => del(`/fin-assets/${r.id}`), t('common.deleted'))) load(); };
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><StatCard label={t('fin2.assets_value')} value={fmtMoney(d.total)} />
        {can('assets.create') && <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => ed.open()}>{t('fin2.new_asset')}</Button>}</div>
      <Table heads={[t('fin2.asset'), t('fin2.category'), t('fin2.value'), t('fin2.purchase_date'), t('fin2.status'), '']} empty={!d.rows.length && <p className="p-4 text-sm text-zinc-500">{t('fin2.no_assets')}</p>}>
        {d.rows.map((r: any) => <tr key={r.id} className={r.status === 'in_use' ? '' : 'opacity-60'}>
          <Td><div className="font-medium">{r.name}</div>{r.notes && <div className="text-xs text-zinc-500">{r.notes}</div>}</Td><Td>{r.category ?? '—'}</Td><Td num>{fmtMoney(r.value)}</Td>
          <Td num>{fmtDate(r.purchase_date)}</Td><Td><Badge tone={r.status === 'in_use' ? 'green' : 'grey'}>{t(`fin2.as.${r.status}`)}</Badge>{r.disposed_on && <div className="num text-xs text-zinc-500">{fmtDate(r.disposed_on)}</div>}</Td>
          <Td><div className="flex">{can('assets.update') && <IconButton title={t('common.edit')} onClick={() => ed.open({ ...r, purchase_date: r.purchase_date ? String(r.purchase_date).slice(0, 10) : '' })}><Pencil /></IconButton>}
            {can('assets.delete') && <IconButton title={t('common.delete')} tone="red" onClick={() => remove(r)}><Trash2 /></IconButton>}</div></Td></tr>)}
      </Table>
      <Panel ed={ed} title={ed.row?.id ? t('fin2.edit_asset') : t('fin2.new_asset')}>
        <Grid><TextInput form={ed.form} name="name" label={t('fin2.asset')} required maxLength={150} /><TextInput form={ed.form} name="category" label={t('fin2.category')} maxLength={100} />
          <TextInput form={ed.form} name="value" type="number" label={t('fin2.value')} dir="ltr" /><TextInput form={ed.form} name="purchase_date" type="date" label={t('fin2.purchase_date')} />
          <SelectInput form={ed.form} name="status" label={t('fin2.status')} empty={false} options={['in_use', 'disposed'].map((k) => ({ value: k, label: t(`fin2.as.${k}`) }))} /></Grid>
        <TextArea form={ed.form} name="notes" label={t('common.notes')} maxLength={255} />
      </Panel>
    </>
  );
}

// ======================================================================== stock
function Stock() {
  const { t } = useI18n();
  const { can } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [moving, setMoving] = useState<{ item: any; dir: 'in' | 'out' } | null>(null);
  const [hist, setHist] = useState<any | null>(null);
  const load = () => get<any[]>('/fin-stock').then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); }, []);
  const ed = useEditor({ name: '', unit: '', min_quantity: '' }, (v, row) => (row?.id ? patch(`/fin-stock/${row.id}`, v) : post('/fin-stock', v)), load);
  const mv = useForm<Record<string, any>>({ quantity: '', unit_cost: '', move_date: '', rider_id: '', note: '' });
  const saveMove = async () => { const r = await mv.submit(() => post(`/fin-stock/${moving!.item.id}/moves`, { ...mv.values, direction: moving!.dir })); if (r) { setMoving(null); load(); } };
  const openHist = (item: any) => get(`/fin-stock/${item.id}/moves`).then((d) => setHist({ item, ...d }));
  return (
    <>
      {can('stock.create') && <div className="mb-3"><Button variant="primary" icon={<Plus className="size-4" />} onClick={() => ed.open()}>{t('fin2.new_item')}</Button></div>}
      <Table heads={[t('fin2.item'), t('fin2.quantity'), t('fin2.last_move'), '']} empty={!rows.length && <p className="p-4 text-sm text-zinc-500">{t('fin2.no_items')}</p>}>
        {rows.map((r) => { const low = r.min_quantity != null && Number(r.quantity) <= Number(r.min_quantity); return <tr key={r.id} className={r.is_active ? '' : 'opacity-60'}>
          <Td><div className="font-medium">{r.name}</div></Td>
          <Td num><span className={low ? 'font-medium text-red-600' : ''}>{fmtNum(r.quantity, 2)} {r.unit ?? ''}</span>{low && <div className="text-xs text-red-600">{t('fin2.low_stock')}</div>}</Td>
          <Td num>{fmtDate(r.last_move)}</Td>
          <Td><div className="flex">{can('stock.update') && <><IconButton title={t('fin2.stock_in')} tone="green" onClick={() => { mv.reset({ quantity: '', unit_cost: '', move_date: '', rider_id: '', note: '' }); setMoving({ item: r, dir: 'in' }); }}><Plus /></IconButton>
            <IconButton title={t('fin2.stock_out')} tone="amber" onClick={() => { mv.reset({ quantity: '', unit_cost: '', move_date: '', rider_id: '', note: '' }); setMoving({ item: r, dir: 'out' }); }}><Minus /></IconButton>
            <IconButton title={t('common.edit')} onClick={() => ed.open(r)}><Pencil /></IconButton></>}
            <IconButton title={t('acc.history')} onClick={() => openHist(r)}><History /></IconButton></div></Td></tr>; })}
      </Table>
      <Panel ed={ed} title={ed.row?.id ? t('fin2.edit_item') : t('fin2.new_item')}>
        <Grid><TextInput form={ed.form} name="name" label={t('fin2.item')} required maxLength={150} /><TextInput form={ed.form} name="unit" label={t('fin2.unit')} maxLength={30} />
          <TextInput form={ed.form} name="min_quantity" type="number" label={t('fin2.min_quantity')} dir="ltr" hint={t('fin2.min_quantity_hint')} /></Grid>
      </Panel>
      {moving && <SidePanel open onClose={() => setMoving(null)} title={t(moving.dir === 'in' ? 'fin2.stock_in_title' : 'fin2.stock_out_title', { item: moving.item.name })}
        footer={<><Button onClick={() => setMoving(null)}>{t('common.cancel')}</Button><Button variant="primary" disabled={mv.busy} onClick={saveMove}>{t('common.save')}</Button></>}>
        <p className="mb-3 text-sm">{t('fin2.quantity')}: <span className="num font-medium">{fmtNum(moving.item.quantity, 2)}</span></p>
        <Grid><TextInput form={mv} name="quantity" type="number" label={t('fin2.quantity')} required dir="ltr" />
          {moving.dir === 'in' && <TextInput form={mv} name="unit_cost" type="number" label={t('fin2.unit_cost')} dir="ltr" />}
          <TextInput form={mv} name="move_date" type="date" label={t('fin2.date')} hint={t('svc.paid_on_hint')} /></Grid>
        {moving.dir === 'out' && <RiderInput form={mv} name="rider_id" label={t('fin2.given_to')} />}
        <TextInput form={mv} name="note" label={t('common.notes')} maxLength={255} />
      </SidePanel>}
      {hist && <SidePanel open onClose={() => setHist(null)} title={t('fin2.moves_title', { item: hist.item.name })}>
        {!hist.rows.length ? <p className="text-sm text-zinc-500">{t('fin2.no_moves')}</p> : <ul className="divide-y divide-zinc-100 text-sm dark:divide-zinc-800">{hist.rows.map((m: any) => <li key={m.id} className="py-2">
          <span className={`num font-medium ${m.direction === 'in' ? 'text-emerald-600' : 'text-amber-600'}`}>{m.direction === 'in' ? '+' : '−'}{fmtNum(m.quantity, 2)}</span> <span className="num text-xs text-zinc-500">{fmtDate(m.move_date)}</span>
          {m.rider_name && <span className="text-xs"> · {m.rider_name}</span>}{m.note && <div className="text-xs text-zinc-500">{m.note}</div>}</li>)}</ul>}
      </SidePanel>}
    </>
  );
}
