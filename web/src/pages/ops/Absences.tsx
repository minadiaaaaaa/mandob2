import { useState } from 'react';
import { Link } from 'react-router-dom';
import { FileUp, Pencil, Trash2 } from 'lucide-react';
import { del, patch } from '../../api';
import { useAuth } from '../../auth';
import { fmtDateTime, fmtNum, useI18n } from '../../i18n';
import { Badge, Button, Card, Field, IconButton, PageHeader, SidePanel, StatCard, StatGrid, toneIf, useAction, useUi } from '../../ui/kit';
import { DataTable, FilterBar, FilterDate, FilterSelect, useList, type Column } from '../../ui/table';
import { ImportWizard } from '../../ui/importer';
import { ExportButton } from '../../ui/common';
import { Bars, Columns } from '../../ui/charts';

const REASONS = ['VACATION', 'SICKNESS', 'OTHER'];
const reasonLabel = (t: (k: string) => string, r: string | null) => (r && REASONS.includes(r.toUpperCase()) ? t(`abs.r.${r.toUpperCase()}`) : r ?? t('abs.r.OTHER'));
const period = (r: any) => {
  const a = r.start_at.slice(0, 10); const b = r.end_at.slice(0, 10);
  return a === b ? a : `${a} → ${b}`;
};

export function AbsencesList() {
  const { t } = useI18n();
  const { can } = useAuth();
  const run = useAction();
  const { confirm } = useUi();
  const list = useList('/absences');
  const [edit, setEdit] = useState<any>(null);
  const [note, setNote] = useState('');
  const s = list.stats ?? {};
  const charts = list.data?.charts ?? { months: [], reasons: [] };
  const remove = async (r: any) => {
    if (!(await confirm({ title: t('abs.delete_q'), body: t('abs.delete_body') }))) return;
    if (await run(() => del(`/absences/${r.id}`), t('common.deleted'))) list.reload();
  };
  const columns: Column<any>[] = [
    { key: 'rider', header: t('abs.rider'), sort: 'rider', render: (r) => <div><Link to={`/admin/riders/${r.rider_id}`} className="font-medium hover:text-brand">{r.full_name}</Link><div className="text-xs text-zinc-500"><span className="num">#{r.rider_id}</span>{r.company_name && ` · ${r.company_name}`}</div></div> },
    { key: 'start', header: t('abs.period'), sort: 'start', render: (r) => <div><div className="num">{period(r)}</div>{r.status && <div className="text-xs text-zinc-500">{r.status}</div>}</div> },
    { key: 'days', header: t('abs.days'), sort: 'days', render: (r) => <span className="num font-medium">{fmtNum(r.days_whole)}</span> },
    { key: 'reason', header: t('abs.reason'), render: (r) => reasonLabel(t, r.reason) },
    { key: 'paid', header: t('abs.paid'), render: (r) => (r.paid == null ? '—' : <Badge tone={r.paid ? 'green' : 'amber'}>{r.paid ? t('abs.paid_yes') : t('abs.paid_no')}</Badge>) },
    { key: 'letter', header: t('abs.leave_letter'), render: (r) => (r.leave_id ? <Link to={`/admin/leaves/${r.leave_id}`} className="text-brand hover:underline num">{r.letter_no}</Link> : <Badge tone="red">{t('abs.no_letter')}</Badge>) },
    { key: 'note', header: t('abs.internal_note'), render: (r) => <span title={r.internal_note ?? ''} className="text-xs">{r.internal_note ? (r.internal_note.length > 40 ? `${r.internal_note.slice(0, 40)}…` : r.internal_note) : '—'}</span> },
    ...(can('absences.manage') ? [{ key: 'actions', header: t('common.actions'), render: (r: any) => <div className="flex">
      <IconButton title={t('abs.edit_note')} onClick={() => { setEdit(r); setNote(r.internal_note ?? ''); }}><Pencil /></IconButton>
      <IconButton title={t('common.delete')} tone="red" onClick={() => remove(r)}><Trash2 /></IconButton>
    </div> }] : []),
  ];
  return (
    <>
      <PageHeader title={t('abs.title')} subtitle={t('abs.subtitle')} actions={<>
        <ExportButton path="/absences/export" query={list.query} />
        {can('absences.import') && <Link to="/admin/absences/import"><Button icon={<FileUp className="size-4" />}>{t('abs.import')}</Button></Link>}
      </>} />
      <StatGrid>
        <StatCard label={t('abs.s.absences')} value={fmtNum(s.absences)} />
        <StatCard label={t('abs.s.days')} value={fmtNum(s.days)} tone="blue" />
        <StatCard label={t('abs.s.unpaid')} value={fmtNum(s.unpaid)} sub={t('abs.n_days', { n: fmtNum(s.unpaid_days) })} tone={toneIf(s.unpaid, 'amber')}
          onClick={() => list.set('paid', list.query.paid === 'unpaid' ? null : 'unpaid')} active={list.query.paid === 'unpaid'} />
        <StatCard label={t('abs.s.riders')} value={fmtNum(s.riders)} />
      </StatGrid>
      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Card title={t('abs.by_month')}><Columns data={charts.months.map((m: any) => ({ label: m.m, value: Number(m.days) }))} empty={t('table.no_records')} /></Card>
        <Card title={t('abs.reasons')}><Bars data={charts.reasons.map((r: any) => ({ label: reasonLabel(t, r.reason), value: Number(r.days), tone: r.reason === 'SICKNESS' ? 'amber' : r.reason === 'VACATION' ? 'blue' : 'grey' }))} empty={t('table.no_records')} /></Card>
      </div>
      <FilterBar list={list} placeholder={t('abs.search_hint')} actions={<ExportButton path="/absences/export" query={list.query} format="csv" label={t('common.export_csv')} />}>
        <FilterDate list={list} name="from" label={t('common.from')} />
        <FilterDate list={list} name="to" label={t('common.to')} />
        <FilterSelect list={list} name="reason" label={t('abs.reason')} options={REASONS.map((r) => ({ value: r.toLowerCase(), label: t(`abs.r.${r}`) }))} />
        <FilterSelect list={list} name="paid" label={t('abs.counted_as')} options={[{ value: 'paid', label: t('abs.paid_yes') }, { value: 'unpaid', label: t('abs.paid_no') }]} />
      </FilterBar>
      <DataTable list={list} columns={columns} />
      <SidePanel open={!!edit} onClose={() => setEdit(null)} title={t('abs.note_title')}
        footer={<><Button onClick={() => setEdit(null)}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={async () => { if (await run(() => patch(`/absences/${edit.id}/note`, { internal_note: note }), t('common.saved'))) { setEdit(null); list.reload(); } }}>{t('common.save')}</Button></>}>
        {edit && <div className="space-y-3 text-sm">
          <div className="font-medium">{edit.full_name} <span className="num text-zinc-500">#{edit.rider_id}</span></div>
          <div className="num text-zinc-500">{period(edit)} · {fmtNum(edit.days_whole)} {t('abs.days')}</div>
          {edit.company_comment && <div className="rounded-lg bg-zinc-50 p-2 text-xs dark:bg-zinc-800">{edit.company_comment}</div>}
          <Field label={t('abs.internal_note')}><textarea className="input" rows={5} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          <p className="text-xs text-zinc-500">{t('abs.note_hint')} · {fmtDateTime(edit.updated_at ?? edit.created_at)}</p>
        </div>}
      </SidePanel>
    </>
  );
}

export function AbsencesImport() {
  const { t } = useI18n();
  return (
    <>
      <PageHeader title={t('abs.import')} back="/admin/absences" />
      <ImportWizard base="/absences/import" back="/admin/absences"
        options={[{ name: 'create_riders', label: t('abs.create_riders'), hint: t('abs.create_riders_hint') }]}
        extraLabels={{ new_riders: t('abs.new_riders'), matched: t('abs.matched') }}
        intro={<p className="text-sm text-zinc-500">{t('abs.import_intro')}</p>} />
    </>
  );
}
