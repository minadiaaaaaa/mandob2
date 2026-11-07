// Finance → Invoice maker (phase 7): tax invoices to the platforms (against their contracts) and credit notes, the
// buyers, and the ZATCA sandbox switch. A draft changes freely; issuing is final (number, counter, hash chain, QR);
// a mistake is corrected with a credit note. The server keeps every rule (domain/invoices.ts).
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import QRCode from 'qrcode';
import { Ban, Download, Eye, FileCheck2, Pencil, Plus, Printer, Trash2, Undo2 } from 'lucide-react';
import { del, download, get, patch, post, put } from '../../api';
import { useAuth } from '../../auth';
import { fmtDate, fmtMoney, fmtNum, useI18n } from '../../i18n';
import { Alert, Badge, Button, Card, IconButton, Loading, PageHeader, SidePanel, StatCard, StatGrid, Tabs, useAction, useUi, type Tone } from '../../ui/kit';
import { Grid, SelectInput, TextArea, TextInput, useForm } from '../../ui/forms';
import { DataTable, FilterBar, FilterSelect, useList, type Column } from '../../ui/table';
import { useOptions } from '../../ui/common';
import { PlanCounter } from '../../ui/plan';

const STATUS: Record<string, Tone> = { draft: 'amber', issued: 'green', credited: 'grey' };
const InvStatus = ({ r }: { r: any }) => { const { t } = useI18n(); return <span className="inline-flex flex-wrap gap-1"><Badge tone={STATUS[r.status]}>{t(`inv.st.${r.status}`)}</Badge>
  {r.kind === 'credit' && <Badge tone="blue">{t('inv.credit_note')}</Badge>}{r.zatca_status === 'sandbox_signed' && <Badge tone="grey">{t('inv.z.sandbox_signed')}</Badge>}</span>; };

export function InvoicesPage() {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'buyers' ? 'buyers' : 'invoices';
  return (
    <>
      <PageHeader title={t('inv.title')} subtitle={t('inv.intro')} />
      <Tabs value={tab} onChange={(k) => setParams(k === 'invoices' ? {} : { tab: k })} tabs={[{ key: 'invoices', label: t('inv.tab.invoices') }, { key: 'buyers', label: t('inv.tab.buyers') }]} />
      {tab === 'buyers' ? <Buyers /> : <InvoiceList />}
    </>
  );
}

function InvoiceList() {
  const { t } = useI18n();
  const { can } = useAuth();
  const run = useAction();
  const nav = useNavigate();
  const list = useList('/invoices');
  const buyers = useOptions<any>('/invoice-buyers');
  const s = list.stats ?? {};
  const z = list.data?.zatca;
  const toggleZatca = async () => { if (await run(() => put('/invoices-zatca', { mode: z?.mode === 'sandbox' ? 'off' : 'sandbox' }), t('common.saved'))) list.reload(); };
  const create = async () => {
    const b = buyers.find((x) => x.is_active);
    if (!b) { nav('/admin/invoices?tab=buyers'); return; }
    const r: any = await run(() => post('/invoices', { buyer_id: b.id, lines: [] }));
    if (r) nav(`/admin/invoices/${r.id}/edit`);
  };
  const columns: Column<any>[] = [
    { key: 'number', header: t('inv.number'), sort: 'number', render: (r) => r.number ? <span className="num font-medium" dir="ltr">{r.number}</span> : <span className="text-zinc-400">{t('inv.no_number')}</span> },
    { key: 'date', header: t('inv.issue_date'), sort: 'date', render: (r) => <span className="num">{fmtDate(r.issue_date)}</span> },
    { key: 'buyer', header: t('inv.buyer'), render: (r) => <div>{r.buyer_name}{r.contract_name && <div className="text-xs text-zinc-500">{r.contract_name}</div>}{r.original_number && <div className="num text-xs text-zinc-500">← {r.original_number}</div>}</div> },
    { key: 'total', header: t('inv.total'), sort: 'total', render: (r) => <div className="num">{fmtMoney(r.total)}<div className="text-xs text-zinc-500">{t('inv.vat')} {fmtMoney(r.vat_total)}</div></div> },
    { key: 'status', header: t('inv.status'), render: (r) => <InvStatus r={r} /> },
    { key: 'actions', header: t('common.actions'), render: (r) => <Link to={r.status === 'draft' ? `/admin/invoices/${r.id}/edit` : `/admin/invoices/${r.id}`}><IconButton title={r.status === 'draft' ? t('common.edit') : t('inv.open')}>{r.status === 'draft' ? <Pencil /> : <Eye />}</IconButton></Link> },
  ];
  return (
    <>
      <StatGrid>
        <StatCard label={t('inv.st.draft')} value={fmtNum(s.drafts)} tone="amber" sub={<PlanCounter kind={'open_invoice_drafts' as any} />} onClick={() => list.set('status', list.query.status === 'draft' ? null : 'draft')} active={list.query.status === 'draft'} />
        <StatCard label={t('inv.st.issued')} value={fmtNum(s.issued)} tone="green" sub={<PlanCounter kind={'invoices_month' as any} />} onClick={() => list.set('status', list.query.status === 'issued' ? null : 'issued')} active={list.query.status === 'issued'} />
        <StatCard label={t('inv.invoiced')} value={fmtMoney(s.invoiced)} />
        <StatCard label={t('inv.credits')} value={fmtMoney(s.credits)} />
      </StatGrid>
      {z && <Alert tone={z.mode === 'sandbox' ? 'blue' : 'grey' as any} title={t(z.mode === 'sandbox' ? 'inv.zatca_on' : 'inv.zatca_off')}>
        <div className="flex flex-wrap items-center justify-between gap-2"><span>{t(z.allowed ? 'inv.zatca_hint' : 'inv.zatca_locked')}</span>
          {z.allowed && can('invoices.settings') && <Button size="sm" onClick={toggleZatca}>{t(z.mode === 'sandbox' ? 'inv.zatca_turn_off' : 'inv.zatca_turn_on')}</Button>}</div></Alert>}
      <div className="mt-3"><FilterBar list={list} placeholder={t('inv.search_hint')} actions={can('invoices.create') && <Button variant="primary" icon={<Plus className="size-4" />} onClick={create}>{t('inv.new')}</Button>}>
        <FilterSelect list={list} name="kind" label={t('inv.kind')} options={[{ value: 'invoice', label: t('inv.tax_invoice') }, { value: 'credit', label: t('inv.credit_note') }]} />
        <FilterSelect list={list} name="buyer" label={t('inv.buyer')} options={buyers.map((b) => ({ value: b.id, label: b.name }))} />
      </FilterBar></div>
      <DataTable list={list} columns={columns} emptyText={t('inv.none')} />
    </>
  );
}

function Buyers() {
  const { t } = useI18n();
  const { can } = useAuth();
  const run = useAction();
  const [rows, setRows] = useState<any[]>([]);
  const [edit, setEdit] = useState<any | null>(null);
  const platforms = useOptions<any>('/lookups/companies?all=1');
  const EMPTY = { name: '', name_en: '', vat_number: '', cr_number: '', address: '', city: '', postal_code: '', email: '', company_id: '' };
  const form = useForm<Record<string, any>>(EMPTY);
  const load = () => get<any[]>('/invoice-buyers').then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); }, []);
  const open = (r?: any) => { form.reset(r ? Object.fromEntries(Object.keys(EMPTY).map((k) => [k, r[k] ?? ''])) : EMPTY); setEdit(r ?? {}); };
  const save = async () => { const r = await form.submit(() => (edit.id ? patch(`/invoice-buyers/${edit.id}`, form.changes) : post('/invoice-buyers', form.values))); if (r) { setEdit(null); load(); } };
  const toggle = async (r: any) => { if (await run(() => patch(`/invoice-buyers/${r.id}`, { is_active: !r.is_active }), t('common.saved'))) load(); };
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-3">{can('invoices.create') && <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => open()}>{t('inv.new_buyer')}</Button>}
        <PlanCounter kind={'invoice_buyers' as any} /></div>
      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800"><table className="w-full text-sm">
        <thead className="bg-zinc-50 text-xs text-zinc-500 dark:bg-zinc-900"><tr>{['inv.buyer', 'fin2.vat_number', 'inv.cr_number', 'inv.address', 'inv.invoices_n', ''].map((k) => <th key={k} className="px-3 py-2 text-start font-medium">{k ? t(k) : ''}</th>)}</tr></thead>
        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">{rows.map((b) => <tr key={b.id} className={b.is_active ? '' : 'opacity-60'}>
          <td className="px-3 py-2"><div className="font-medium">{b.name}</div>{b.platform && <div className="text-xs text-zinc-500">{b.platform}</div>}</td>
          <td className="num px-3 py-2">{b.vat_number ?? <span className="text-red-600">{t('inv.vat_missing')}</span>}</td><td className="num px-3 py-2">{b.cr_number ?? '—'}</td>
          <td className="px-3 py-2 text-xs">{[b.address, b.city, b.postal_code].filter(Boolean).join('، ')}</td><td className="num px-3 py-2">{fmtNum(b.invoices)}</td>
          <td className="px-3 py-2">{can('invoices.update') && <div className="flex"><IconButton title={t('common.edit')} onClick={() => open(b)}><Pencil /></IconButton>
            <IconButton title={b.is_active ? t('common.disable') : t('common.enable')} tone={b.is_active ? 'amber' : 'green'} onClick={() => toggle(b)}><Ban /></IconButton></div>}</td></tr>)}</tbody></table>
        {!rows.length && <p className="p-4 text-sm text-zinc-500">{t('inv.no_buyers')}</p>}</div>
      <SidePanel open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? t('inv.edit_buyer') : t('inv.new_buyer')}
        footer={<><Button onClick={() => setEdit(null)}>{t('common.cancel')}</Button><Button variant="primary" disabled={form.busy} onClick={save}>{t('common.save')}</Button></>}>
        <form onSubmit={(e) => { e.preventDefault(); save(); }}>
          <Grid>
            <TextInput form={form} name="name" label={t('inv.buyer_name')} required maxLength={200} />
            <TextInput form={form} name="name_en" label={t('branches.name_en')} dir="ltr" maxLength={200} />
            <TextInput form={form} name="vat_number" label={t('fin2.vat_number')} dir="ltr" maxLength={15} hint={t('inv.vat_hint')} />
            <TextInput form={form} name="cr_number" label={t('inv.cr_number')} dir="ltr" maxLength={30} />
            <TextInput form={form} name="city" label={t('inv.city')} maxLength={100} />
            <TextInput form={form} name="postal_code" label={t('inv.postal_code')} dir="ltr" maxLength={10} />
            <TextInput form={form} name="email" type="email" label={t('riders.email')} dir="ltr" maxLength={150} />
            <SelectInput form={form} name="company_id" label={t('inv.platform')} options={platforms.map((p) => ({ value: p.id, label: p.name }))} />
          </Grid>
          <TextArea form={form} name="address" label={t('inv.address')} maxLength={300} />
        </form>
      </SidePanel>
    </>
  );
}

// ======================================================================== the draft editor
type Line = { description: string; quantity: string; unit_price: string; vat_rate: string };
const r2 = (n: number) => Math.round(n * 100) / 100;
export function InvoiceEditPage() {
  const { id } = useParams();
  const { t } = useI18n();
  const { can } = useAuth();
  const run = useAction();
  const { confirm } = useUi();
  const nav = useNavigate();
  const [inv, setInv] = useState<any | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const buyers = useOptions<any>('/invoice-buyers');
  const form = useForm<Record<string, any>>({ buyer_id: '', contract_id: '', issue_date: '', supply_from: '', supply_to: '', notes: '' });
  const contracts = useOptions<any>('/lookups/contracts?all=1');
  useEffect(() => { get(`/invoices/${id}`).then((r) => {
    if (r.status !== 'draft') { nav(`/admin/invoices/${id}`, { replace: true }); return; }
    setInv(r); form.reset({ buyer_id: r.buyer_id, contract_id: r.contract_id ?? '', issue_date: r.issue_date ?? '', supply_from: r.supply_from ?? '', supply_to: r.supply_to ?? '', notes: r.notes ?? '' });
    setLines(r.lines.map((l: any) => ({ description: l.description, quantity: String(l.quantity), unit_price: String(l.unit_price), vat_rate: String(l.vat_rate) })));
  }).catch(() => setInv(false as any)); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (inv === null) return <Loading />;
  if (!inv) return <Alert tone="red">{t('pay.not_found')}</Alert>;
  const set = (i: number, k: keyof Line, v: string) => setLines(lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const totals = lines.reduce((a, l) => { const net = r2(Number(l.quantity || 0) * Number(l.unit_price || 0)); return { net: a.net + net, vat: a.vat + r2((net * Number(l.vat_rate || 0)) / 100) }; }, { net: 0, vat: 0 });
  const save = async () => form.submit(() => patch(`/invoices/${id}`, { ...form.values, lines: lines.map((l) => ({ ...l, vat_rate: l.vat_rate === '' ? 15 : l.vat_rate })) }));
  const issue = async () => {
    if (!(await save())) return;
    if (!(await confirm({ title: t('inv.issue_q'), body: t('inv.issue_body'), tone: 'warn' }))) return;
    if (await run(() => post(`/invoices/${id}/issue`), t('inv.issued'))) nav(`/admin/invoices/${id}`);
  };
  const remove = async () => { if (!(await confirm({ title: t('inv.delete_q'), tone: 'warn' }))) return; if (await run(() => del(`/invoices/${id}`), t('common.deleted'))) nav('/admin/invoices'); };
  const selectedBuyer = buyers.find((b) => String(b.id) === String(form.values.buyer_id));
  const platformContracts = contracts.filter((k) => !selectedBuyer?.company_id || k.company_id === selectedBuyer.company_id);
  return (
    <>
      <PageHeader title={t('inv.draft_title')} back="/admin/invoices" actions={<>
        {can('invoices.delete') && <IconButton title={t('common.delete')} tone="red" onClick={remove}><Trash2 /></IconButton>}
        <Button disabled={form.busy} onClick={async () => { if (await save()) run(async () => true, t('common.saved')); }}>{t('common.save')}</Button>
        {can('invoices.issue') && <Button variant="primary" icon={<FileCheck2 className="size-4" />} disabled={form.busy} onClick={issue}>{t('inv.issue')}</Button>}
      </>} />
      <Card><form onSubmit={(e) => { e.preventDefault(); save(); }}><Grid cols={3}>
        <SelectInput form={form} name="buyer_id" label={t('inv.buyer')} required options={buyers.filter((b) => b.is_active || String(b.id) === String(form.values.buyer_id)).map((b) => ({ value: b.id, label: b.name }))} />
        <SelectInput form={form} name="contract_id" label={t('inv.contract')} options={platformContracts.map((k) => ({ value: k.id, label: k.name }))} />
        <TextInput form={form} name="issue_date" type="date" label={t('inv.issue_date')} hint={t('inv.issue_date_hint')} />
        <TextInput form={form} name="supply_from" type="date" label={t('inv.supply_from')} />
        <TextInput form={form} name="supply_to" type="date" label={t('inv.supply_to')} />
      </Grid><TextArea form={form} name="notes" label={t('common.notes')} maxLength={500} /></form></Card>
      {selectedBuyer && !selectedBuyer.vat_number && <div className="mt-3"><Alert tone="amber">{t('inv.buyer_vat_needed')}</Alert></div>}
      <Card title={t('inv.lines')} className="mt-4">
        <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-xs text-zinc-500"><tr>{['inv.description', 'inv.quantity', 'inv.unit_price', 'inv.vat_rate', 'inv.line_net', ''].map((k) => <th key={k} className="px-2 py-1 text-start font-medium">{k ? t(k) : ''}</th>)}</tr></thead>
          <tbody>{lines.map((l, i) => { const net = r2(Number(l.quantity || 0) * Number(l.unit_price || 0)); return <tr key={i}>
            <td className="px-2 py-1"><input className="input" value={l.description} maxLength={255} onChange={(e) => set(i, 'description', e.target.value)} /></td>
            <td className="w-24 px-2 py-1"><input className="input num" dir="ltr" type="number" value={l.quantity} onChange={(e) => set(i, 'quantity', e.target.value)} /></td>
            <td className="w-32 px-2 py-1"><input className="input num" dir="ltr" type="number" value={l.unit_price} onChange={(e) => set(i, 'unit_price', e.target.value)} /></td>
            <td className="w-20 px-2 py-1"><input className="input num" dir="ltr" type="number" value={l.vat_rate} onChange={(e) => set(i, 'vat_rate', e.target.value)} /></td>
            <td className="num px-2 py-1">{fmtMoney(net)}</td>
            <td className="px-2 py-1"><IconButton title={t('common.delete')} tone="red" onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 /></IconButton></td></tr>; })}</tbody></table></div>
        <div className="mt-2"><Button size="sm" icon={<Plus className="size-4" />} onClick={() => setLines([...lines, { description: '', quantity: '1', unit_price: '', vat_rate: '15' }])}>{t('inv.add_line')}</Button></div>
        <div className="mt-3 ms-auto w-64 space-y-1 text-sm">
          <div className="flex justify-between"><span>{t('inv.subtotal')}</span><span className="num">{fmtMoney(r2(totals.net))}</span></div>
          <div className="flex justify-between"><span>{t('inv.vat')}</span><span className="num">{fmtMoney(r2(totals.vat))}</span></div>
          <div className="flex justify-between border-t pt-1 font-semibold"><span>{t('inv.total')}</span><span className="num">{fmtMoney(r2(totals.net + totals.vat))}</span></div></div>
      </Card>
    </>
  );
}

// ======================================================================== the issued invoice (printable)
export function InvoiceViewPage() {
  const { id } = useParams();
  const { t } = useI18n();
  const { can } = useAuth();
  const run = useAction();
  const nav = useNavigate();
  const [inv, setInv] = useState<any | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [crediting, setCrediting] = useState<string | null>(null);
  const load = () => get(`/invoices/${id}`).then((r) => { if (r.status === 'draft') { nav(`/admin/invoices/${id}/edit`, { replace: true }); return; } setInv(r); if (r.qr) QRCode.toDataURL(r.qr, { margin: 1, width: 180 }).then(setQr).catch(() => setQr(null)); }).catch(() => setInv(false as any));
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (inv === null) return <Loading />;
  if (!inv) return <Alert tone="red">{t('pay.not_found')}</Alert>;
  const s = JSON.parse(inv.seller_json ?? '{}'), b = JSON.parse(inv.buyer_json ?? '{}');
  const credit = async () => { const r: any = await run(() => post(`/invoices/${id}/credit`, { reason: crediting }), t('inv.credited')); if (r) { setCrediting(null); nav(`/admin/invoices/${r.id}`); } };
  return (
    <>
      <PageHeader title={t(inv.kind === 'credit' ? 'inv.credit_note' : 'inv.tax_invoice')} back="/admin/invoices" subtitle={<span className="inline-flex items-center gap-2"><span className="num" dir="ltr">{inv.number}</span><InvStatus r={inv} /></span>} actions={<>
        <Button icon={<Printer className="size-4" />} onClick={() => window.print()}>{t('pay.print')}</Button>
        <Button icon={<Download className="size-4" />} onClick={() => download(`/invoices/${id}/xml`)}>{t('inv.xml')}</Button>
        {inv.kind === 'invoice' && inv.status === 'issued' && can('invoices.issue') && <Button variant="danger" icon={<Undo2 className="size-4" />} onClick={() => setCrediting('')}>{t('inv.make_credit')}</Button>}
      </>} />
      <Card><div className="space-y-4 text-sm">
        <div className="flex flex-wrap justify-between gap-4">
          <div><div className="text-lg font-semibold">{t(inv.kind === 'credit' ? 'inv.credit_note' : 'inv.tax_invoice')}</div>
            <div className="num" dir="ltr">{inv.number}</div><div className="text-xs text-zinc-500">{t('inv.issue_date')}: <span className="num">{fmtDate(inv.issue_date)}</span></div>
            {inv.original_number && <div className="text-xs">{t('inv.against')}: <Link to={`/admin/invoices/${inv.original_id}`} className="num hover:underline">{inv.original_number}</Link></div>}
            {inv.credit_reason && <div className="text-xs">{t('inv.reason')}: {inv.credit_reason}</div>}</div>
          {qr && <img src={qr} alt="ZATCA QR" className="size-36" />}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {[['inv.seller', s], ['inv.buyer', b]].map(([k, p]: any) => <div key={k} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
            <div className="mb-1 text-xs text-zinc-500">{t(k)}</div><div className="font-medium">{p.name}</div>
            <div className="num text-xs">{t('fin2.vat_number')}: {p.vat_number ?? '—'}</div>{p.cr_number && <div className="num text-xs">{t('inv.cr_number')}: {p.cr_number}</div>}
            <div className="text-xs text-zinc-500">{[p.address, p.city, p.postal_code].filter(Boolean).join('، ')}</div></div>)}
        </div>
        {inv.supply_from && <div className="text-xs">{t('inv.supply_period')}: <span className="num">{fmtDate(inv.supply_from)} – {fmtDate(inv.supply_to)}</span>{inv.contract_name ? ` · ${inv.contract_name}` : ''}</div>}
        <table className="w-full"><thead className="text-xs text-zinc-500"><tr>{['inv.description', 'inv.quantity', 'inv.unit_price', 'inv.vat_rate', 'inv.line_net', 'inv.vat'].map((k) => <th key={k} className="border-b py-1 text-start font-medium">{t(k)}</th>)}</tr></thead>
          <tbody>{inv.lines.map((l: any) => <tr key={l.id} className="border-b border-zinc-100 dark:border-zinc-800"><td className="py-1">{l.description}</td><td className="num py-1">{fmtNum(l.quantity, 3)}</td>
            <td className="num py-1">{fmtMoney(l.unit_price)}</td><td className="num py-1">{fmtNum(l.vat_rate, 2)}%</td><td className="num py-1">{fmtMoney(l.net)}</td><td className="num py-1">{fmtMoney(l.vat)}</td></tr>)}</tbody></table>
        <div className="ms-auto w-64 space-y-1">
          <div className="flex justify-between"><span>{t('inv.subtotal')}</span><span className="num">{fmtMoney(inv.subtotal)}</span></div>
          <div className="flex justify-between"><span>{t('inv.vat')}</span><span className="num">{fmtMoney(inv.vat_total)}</span></div>
          <div className="flex justify-between border-t pt-1 font-semibold"><span>{t('inv.total')}</span><span className="num">{fmtMoney(inv.total)}</span></div></div>
        <div className="grid gap-1 border-t pt-2 text-[11px] text-zinc-500 sm:grid-cols-2"><div>UUID: <span className="num" dir="ltr">{inv.uuid}</span></div><div>ICV: <span className="num">{inv.icv}</span></div>
          <div className="truncate" title={inv.invoice_hash}>{t('inv.hash')}: <span className="num" dir="ltr">{inv.invoice_hash}</span></div><div className="truncate" title={inv.pih}>PIH: <span className="num" dir="ltr">{inv.pih}</span></div></div>
        {!!inv.credits?.length && <div className="text-xs">{t('inv.credit_notes')}: {inv.credits.map((c: any) => <Link key={c.id} to={`/admin/invoices/${c.id}`} className="num me-2 hover:underline">{c.number}</Link>)}</div>}
      </div></Card>
      {crediting !== null && <SidePanel open onClose={() => setCrediting(null)} title={t('inv.make_credit')}
        footer={<><Button onClick={() => setCrediting(null)}>{t('common.cancel')}</Button><Button variant="danger" disabled={!crediting.trim()} onClick={credit}>{t('inv.make_credit')}</Button></>}>
        <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-400">{t('inv.credit_body')}</p>
        <input className="input" maxLength={255} placeholder={t('inv.reason')} value={crediting} onChange={(e) => setCrediting(e.target.value)} />
      </SidePanel>}
    </>
  );
}
