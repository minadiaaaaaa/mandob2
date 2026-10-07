import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Eye, FileUp, Grid3x3, IdCard, Monitor, RefreshCw, Rows3, ScanFace, Trash2, ExternalLink, CheckCheck } from 'lucide-react';
import { del, get, patch, post } from '../../api';
import { useAuth } from '../../auth';
import { fmtDateTime, fmtNum, useI18n } from '../../i18n';
import { Alert, Badge, Button, By, Card, cx, Details, Field, IconButton, Loading, PageHeader, SidePanel, StatCard, StatGrid, useAction, useErrorText, useUi, type Tone } from '../../ui/kit';
import { DataTable, FilterBar, FilterDate, FilterSelect, useList, type Column, type ListState } from '../../ui/table';
import { ImportWizard } from '../../ui/importer';
import { ExportButton, useOptions } from '../../ui/common';

const RES_TONE: Record<string, Tone> = { fine: 'green', blurred: 'amber', no_face: 'red', unreadable: 'amber', failed: 'grey', pending: 'grey' };
const CARD_TONE: Record<string, Tone> = { none: 'grey', visible: 'green', not_visible: 'red', unclear: 'amber' };
const SRC_TONE: Record<string, Tone> = { none: 'grey', direct: 'green', screen: 'red', unclear: 'amber' };
// Each click moves to the next answer; the third withdraws it.
const NEXT_CARD: Record<string, string> = { none: 'visible', visible: 'not_visible', not_visible: 'clear', unclear: 'clear' };
const NEXT_SRC: Record<string, string> = { none: 'screen', screen: 'direct', direct: 'clear', unclear: 'clear' };
const iso = (d: Date) => new Intl.DateTimeFormat('en-CA').format(d);
const ago = (n: number) => iso(new Date(Date.now() - n * 86400000));

function useReview(list: ListState) {
  const { toast } = useUi();
  const errText = useErrorText();
  // saved, then the list reloads; a failed save leaves the row as it was and shows the error
  return async (r: any, change: Record<string, string>) => {
    try { await patch(`/branding/${r.id}`, change); } catch (e) { toast(errText(e), 'red'); }
    list.reload();
  };
}
function RowButtons({ r, review }: { r: any; review: (r: any, c: Record<string, string>) => void }) {
  const { t } = useI18n();
  const nextRes = r.override_result === 'fine' ? 'blurred' : r.override_result === 'blurred' ? 'undo' : 'fine';
  return <>
    <IconButton title={t(`brand.next_card.${NEXT_CARD[r.card_review]}`)} tone={CARD_TONE[r.card_review] === 'grey' ? undefined : CARD_TONE[r.card_review] as Tone} onClick={() => review(r, { card_review: NEXT_CARD[r.card_review] })}><IdCard /></IconButton>
    <IconButton title={t(`brand.next_src.${NEXT_SRC[r.source_review]}`)} tone={SRC_TONE[r.source_review] === 'grey' ? undefined : SRC_TONE[r.source_review] as Tone} onClick={() => review(r, { source_review: NEXT_SRC[r.source_review] })}><Monitor /></IconButton>
    <IconButton title={t(`brand.next_res.${nextRes}`)} onClick={() => review(r, { override_result: nextRes })}><ScanFace /></IconButton>
    <IconButton title={t('brand.recheck')} onClick={() => post(`/branding/${r.id}/recheck`)}><RefreshCw /></IconButton>
  </>;
}
function ResultBadge({ r }: { r: any }) {
  const { t } = useI18n();
  return <Badge tone={RES_TONE[r.result]}>{t(`brand.v.${r.result}`)}{r.override_result && ' ★'}</Badge>;
}

export function BrandingList() {
  const { t } = useI18n();
  const { can } = useAuth();
  const nav = useNavigate();
  const run = useAction();
  const { confirm } = useUi();
  const list = useList('/branding', { from: ago(7) });
  const companies = useOptions<any>('/lookups/companies');
  const contracts = useOptions<any>(list.query.company ? `/lookups/contracts?company=${list.query.company}` : '/lookups/contracts');
  const review = useReview(list);
  const [view, setView] = useState<'table' | 'grid'>(() => { try { return (localStorage.getItem('lsp.brand.view') as any) || 'table'; } catch { return 'table'; } });
  const [bulk, setBulk] = useState(false);
  const [bv, setBv] = useState<Record<string, string>>({});
  useEffect(() => { try { localStorage.setItem('lsp.brand.view', view); } catch { /* ignore */ } }, [view]);
  const s = list.stats ?? {};
  const tools = list.data?.tools;
  const ids = list.selected.size ? [...list.selected] : list.rows.map((r: any) => r.id);
  const markFine = async () => { if (await run(() => post('/branding/mark-fine', { ids }), t('common.saved'))) { list.setSelected(new Set()); list.reload(); } };
  const remove = async (x: (string | number)[]) => {
    if (!(await confirm({ title: t('brand.delete_q', { n: x.length }), body: t('brand.delete_body') }))) return;
    if (await run(() => post('/branding/bulk-delete', { ids: x }), t('common.deleted'))) { list.setSelected(new Set()); list.reload(); }
  };
  const columns: Column<any>[] = [
    { key: 'photo', header: t('brand.photo'), render: (r) => <a href={r.photo_url} target="_blank" rel="noreferrer"><img src={r.photo_url} alt="" loading="lazy" className="size-14 rounded-lg bg-zinc-100 object-cover dark:bg-zinc-800" /></a> },
    { key: 'rider', header: t('brand.rider'), sort: 'rider', render: (r) => <div><div className="font-medium">{r.full_name}</div><div className="text-xs text-zinc-500">{r.alias ?? r.phone ?? ''}</div></div> },
    { key: 'captured', header: t('brand.captured'), sort: 'captured', render: (r) => <span className="num text-xs">{r.captured_at}</span> },
    { key: 'result', header: t('brand.result'), render: (r) => <ResultBadge r={r} /> },
    { key: 'card', header: t('brand.card'), render: (r) => <div className="flex flex-wrap gap-1">
      <Badge tone={CARD_TONE[r.card_review]}>{t(`brand.c.${r.card_review}`)}</Badge>
      {r.source_review !== 'none' && <Badge tone={SRC_TONE[r.source_review]}>{t(`brand.s.${r.source_review}`)}</Badge>}
      {r.suspect_card && r.card_review === 'none' ? <Badge tone="amber">{t('brand.suspect_card')}</Badge> : null}
      {r.suspect_screen && r.source_review === 'none' ? <Badge tone="red">{t('brand.suspect_screen')}</Badge> : null}</div> },
    { key: 'actions', header: t('common.actions'), render: (r) => <div className="flex">
      <IconButton title={t('common.view')} onClick={() => nav(`/admin/branding/${r.id}`)}><Eye /></IconButton>
      {can('performance.update') && <RowButtons r={r} review={review} />}
      {can('performance.delete') && <IconButton title={t('common.delete')} tone="red" onClick={() => remove([r.id])}><Trash2 /></IconButton>}</div> },
  ];
  const tool = (k: string, v: string) => <Badge tone="grey" title={t(`brand.tool_tip.${k}`)}>{t(`brand.tool.${k}`)}: {v}</Badge>;
  return (
    <>
      <PageHeader title={t('brand.title')} actions={<>
        <div className="flex rounded-lg ring-1 ring-zinc-300 dark:ring-zinc-700">
          <IconButton title={t('brand.as_table')} className={cx(view === 'table' && 'bg-brand-soft text-brand')} onClick={() => setView('table')}><Rows3 /></IconButton>
          <IconButton title={t('brand.as_grid')} className={cx(view === 'grid' && 'bg-brand-soft text-brand')} onClick={() => setView('grid')}><Grid3x3 /></IconButton>
        </div>
        {can('performance.import') && <Link to="/admin/branding/import"><Button icon={<FileUp className="size-4" />}>{t('brand.import')}</Button></Link>}
        {can('sync.run') && <Link to="/admin/sync"><Button icon={<RefreshCw className="size-4" />}>{t('perf.sync_hs')}</Button></Link>}
      </>} />
      {tools && <div className="mb-4 flex flex-wrap gap-2">
        {tool('face', t('brand.unavailable'))}{tool('card', t('brand.unavailable'))}{tool('screen', t('brand.unavailable'))}
        {tool('learning', tools.reviews ? t('brand.n_reviews', { n: tools.reviews }) : t('brand.waiting'))}{tool('screen_learning', tools.screen_reviews ? t('brand.n_reviews', { n: tools.screen_reviews }) : t('brand.waiting'))}
      </div>}
      <StatGrid>
        <StatCard label={t('brand.s.photos')} value={fmtNum(s.photos)} />
        <StatCard label={t('brand.s.fine')} value={fmtNum(s.fine)} tone="green" onClick={() => list.set('result', list.query.result === 'fine' ? null : 'fine')} active={list.query.result === 'fine'} />
        <StatCard label={t('brand.s.look')} value={fmtNum(s.look)} tone={s.look ? 'amber' : 'none'} />
        <StatCard label={t('brand.s.awaiting')} value={fmtNum(s.awaiting)} tone={s.awaiting ? 'blue' : 'none'} onClick={() => list.set('card', list.query.card === 'none' ? null : 'none')} active={list.query.card === 'none'} />
        {s.suspects > 0 && <StatCard label={t('brand.s.suspects')} value={fmtNum(s.suspects)} tone="amber" onClick={() => list.set('suspect', list.query.suspect ? null : '1')} active={!!list.query.suspect} />}
        {s.screens > 0 && <StatCard label={t('brand.s.screens')} value={fmtNum(s.screens)} tone="red" onClick={() => list.set('screen', list.query.screen ? null : '1')} active={!!list.query.screen} />}
        <StatCard label={t('brand.s.no_card')} value={fmtNum(s.no_card)} tone={s.no_card ? 'red' : 'none'} onClick={() => list.set('card', list.query.card === 'not_visible' ? null : 'not_visible')} active={list.query.card === 'not_visible'} />
        {s.queue > 0 && <StatCard label={t('brand.s.queue')} value={fmtNum(s.queue)} />}
      </StatGrid>
      {s.queue > 0 && <div className="mb-3"><Alert tone="blue">{t('brand.checker_off')}</Alert></div>}
      <FilterBar list={list} placeholder={t('brand.search_hint')} actions={<>
        {can('performance.update') && s.failed > 0 && <Button size="sm" onClick={() => run(() => post('/branding/retry-failed' + window.location.search), t('common.saved')).then(() => list.reload())}>{t('brand.retry_failed')}</Button>}
        {can('performance.export') && <ExportButton path="/branding/export" query={list.query} />}
      </>}>
        <FilterDate list={list} name="from" label={t('common.from')} />
        <FilterDate list={list} name="to" label={t('common.to')} />
        <div className="flex flex-wrap gap-1">{([['brand.r.today', 0], ['brand.r.yesterday', 1], ['brand.r.before', 2], ['brand.r.3days', 3]] as [string, number][]).map(([k, n]) => (
          <Button key={k} size="sm" variant="ghost" onClick={() => list.setMany({ from: ago(n), to: ago(n) })}>{t(k)}</Button>))}
          <Button size="sm" variant="ghost" onClick={() => list.setMany({ from: ago(7), to: null })}>{t('perf.r.last7')}</Button>
          <Button size="sm" variant="ghost" onClick={() => list.setMany({ from: ago(30), to: null })}>{t('perf.r.last30')}</Button></div>
        <FilterSelect list={list} name="result" label={t('brand.result')} options={['fine', 'blurred', 'no_face', 'unreadable', 'failed'].map((v) => ({ value: v, label: t(`brand.v.${v}`) }))} />
        <FilterSelect list={list} name="suspect" label={t('brand.model_suspicion')} options={[{ value: '1', label: t('brand.suspect_card') }]} />
        <FilterSelect list={list} name="card" label={t('brand.card_review')} options={['none', 'visible', 'not_visible', 'unclear'].map((v) => ({ value: v, label: t(`brand.c.${v}`) }))} />
        <FilterSelect list={list} name="screen" label={t('brand.screen_suspicion')} options={[{ value: '1', label: t('brand.suspect_screen') }]} />
        <FilterSelect list={list} name="source" label={t('brand.source')} options={['none', 'direct', 'screen', 'unclear'].map((v) => ({ value: v, label: t(`brand.s.${v}`) }))} />
        <FilterSelect list={list} name="company" label={t('perf.m.company_name')} options={companies.map((c: any) => ({ value: c.id, label: c.name }))} />
        <FilterSelect list={list} name="contract" label={t('perf.m.contract_name')} options={contracts.map((c: any) => ({ value: c.id, label: c.name }))} />
      </FilterBar>
      {can('performance.update') && list.rows.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          <Button size="sm" variant="primary" icon={<CheckCheck className="size-3.5" />} onClick={markFine}>{list.selected.size ? t('brand.mark_picked') : t('brand.mark_rest')}</Button>
          {list.selected.size > 0 && <Button size="sm" onClick={() => { setBv({}); setBulk(true); }}>{t('common.edit_selected')}</Button>}
          {list.selected.size > 0 && can('performance.delete') && <Button size="sm" variant="danger" onClick={() => remove([...list.selected])}>{t('common.delete_selected')}</Button>}
        </div>
      )}
      {view === 'table' ? <DataTable list={list} columns={columns} selectable={can('performance.update', 'performance.delete')} onRowClick={(r) => nav(`/admin/branding/${r.id}`)} /> : (
        <>
          {list.rows.length === 0 && <div className="rounded-xl border border-zinc-200 bg-white p-10 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">{t('table.no_records')}</div>}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {list.rows.map((r: any) => (
              <div key={r.id} className={cx('overflow-hidden rounded-xl border bg-white dark:bg-zinc-900', list.selected.has(r.id) ? 'border-brand ring-2 ring-brand/25' : r.card_review === 'not_visible' ? 'border-red-300' : 'border-zinc-200 dark:border-zinc-800')}>
                <button className="block w-full" onClick={() => { const n = new Set(list.selected); n.has(r.id) ? n.delete(r.id) : n.add(r.id); list.setSelected(n); }}>
                  <img src={r.photo_url} alt="" loading="lazy" className="aspect-square w-full bg-zinc-100 object-cover dark:bg-zinc-800" />
                </button>
                <div className="p-2">
                  <div className="truncate text-xs font-medium">{r.full_name}</div>
                  <div className="mb-1 flex flex-wrap gap-1"><ResultBadge r={r} /><Badge tone={CARD_TONE[r.card_review]}>{t(`brand.c.${r.card_review}`)}</Badge></div>
                  <div className="flex">{can('performance.update') && <RowButtons r={r} review={review} />}<IconButton title={t('common.view')} onClick={() => nav(`/admin/branding/${r.id}`)}><Eye /></IconButton></div>
                </div>
              </div>
            ))}
          </div>
          {list.data && list.data.total > list.data.pageSize && <div className="mt-3 flex justify-end gap-2">
            <Button size="sm" disabled={list.data.page <= 1} onClick={() => list.set('page', String(list.data!.page - 1))}>{t('table.previous')}</Button>
            <Button size="sm" disabled={list.data.page * list.data.pageSize >= list.data.total} onClick={() => list.set('page', String(list.data!.page + 1))}>{t('table.next')}</Button></div>}
        </>
      )}
      <SidePanel open={bulk} onClose={() => setBulk(false)} title={t('common.edit_selected')} footer={<>
        <Button onClick={() => setBulk(false)}>{t('common.cancel')}</Button>
        <Button variant="primary" onClick={async () => {
          const body = Object.fromEntries(Object.entries(bv).filter(([, v]) => v));
          const r = await run(() => post('/branding/bulk', { ids: [...list.selected], ...body }));
          if (r) { setBulk(false); list.setSelected(new Set()); list.reload(); }
        }}>{t('brand.apply_to', { n: list.selected.size })}</Button></>}>
        <div className="space-y-4">
          {([['card_review', ['visible', 'not_visible', 'unclear', 'clear'], 'brand.c'], ['override_result', ['fine', 'blurred', 'no_face', 'unreadable', 'undo'], 'brand.v'], ['source_review', ['direct', 'screen', 'unclear', 'clear'], 'brand.s']] as [string, string[], string][]).map(([k, opts, pre]) => (
            <Field key={k} label={t(`brand.q.${k}`)}><select className="input" value={bv[k] ?? ''} onChange={(e) => setBv({ ...bv, [k]: e.target.value })}>
              <option value="">{t('brand.no_change')}</option>{opts.map((o) => <option key={o} value={o}>{o === 'clear' ? t('brand.clear_review') : o === 'undo' ? t('brand.undo_override') : t(`${pre}.${o}`)}</option>)}
            </select></Field>
          ))}
        </div>
      </SidePanel>
    </>
  );
}

export function BrandingView() {
  const { id } = useParams();
  const { t } = useI18n();
  const { can } = useAuth();
  const run = useAction();
  const [b, setB] = useState<any>(null);
  const [note, setNote] = useState('');
  const [broken, setBroken] = useState(false);
  const load = () => get(`/branding/${id}`).then((x) => { setB(x); setNote(x.card_note ?? ''); });
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!b) return <Loading />;
  const save = async (change: Record<string, unknown>) => { if (await run(() => patch(`/branding/${id}`, change), t('common.saved'))) load(); };
  const edit = can('performance.update');
  return (
    <>
      <PageHeader title={t('brand.photo_title')} subtitle={b.full_name} back="/admin/branding" actions={<a href={b.photo_url} target="_blank" rel="noreferrer"><Button icon={<ExternalLink className="size-4" />}>{t('brand.open_original')}</Button></a>} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>{broken ? <p className="py-20 text-center text-sm text-zinc-500">{t('brand.cannot_show')}</p> : <img src={b.photo_url} alt="" onError={() => setBroken(true)} className="mx-auto max-h-[70vh] rounded-lg" />}</Card>
        <div className="space-y-4">
          <Card title={t('brand.photo_title')}><Details rows={[[t('brand.rider'), <Link className="text-brand hover:underline" to={`/admin/riders/${b.rider_id}`}>{b.full_name} <span className="num">#{b.rider_id}</span></Link>],
            [t('brand.rider_phone'), b.phone && <span className="num">{b.phone}</span>], [t('riders.account_holder_phone'), b.account_holder_phone && <span className="num">{b.account_holder_phone}</span>],
            [t('brand.captured'), <span className="num">{b.captured_at}</span>], [t('brand.contract'), b.contract_name], [t('brand.result'), <ResultBadge r={b} />],
            [t('brand.card'), <Badge tone={CARD_TONE[b.card_review]}>{t(`brand.c.${b.card_review}`)}</Badge>], [t('brand.checked_at'), b.checked_at ? <span className="num">{fmtDateTime(b.checked_at)}</span> : t('brand.v.pending'), true]]} /></Card>
          <Card title={t('brand.q.card_review')}>
            <Field label={t('common.notes')}><input className="input" maxLength={300} value={note} disabled={!edit} onChange={(e) => setNote(e.target.value)} /></Field>
            {edit && <div className="mt-3 flex flex-wrap gap-2">{['visible', 'not_visible', 'unclear'].map((v) => <Button key={v} size="sm" variant={b.card_review === v ? 'primary' : 'secondary'} onClick={() => save({ card_review: v, card_note: note })}>{t(`brand.c.${v}`)}</Button>)}
              {b.card_review !== 'none' && <Button size="sm" variant="ghost" onClick={() => save({ card_review: 'clear' })}>{t('brand.undo_review')}</Button>}</div>}
            {b.card_by_name && <p className="mt-2 text-xs text-zinc-500"><By name={b.card_by_name} at={fmtDateTime(b.card_at)} /></p>}
          </Card>
          <Card title={t('brand.q.source_review')}>
            {b.suspect_screen ? <div className="mb-3"><Alert tone="amber">{t('brand.suspect_screen')}</Alert></div> : null}
            {edit && <div className="flex flex-wrap gap-2">{['direct', 'screen', 'unclear'].map((v) => <Button key={v} size="sm" variant={b.source_review === v ? 'primary' : 'secondary'} onClick={() => save({ source_review: v })}>{t(`brand.s.${v}`)}</Button>)}</div>}
            {b.source_by_name && <p className="mt-2 text-xs text-zinc-500"><By name={b.source_by_name} at={fmtDateTime(b.source_at)} /></p>}
          </Card>
          <Card title={t('brand.q.override_result')}>
            {edit && <div className="flex flex-wrap gap-2">{['fine', 'blurred', 'no_face', 'unreadable'].map((v) => <Button key={v} size="sm" variant={b.override_result === v ? 'primary' : 'secondary'} onClick={() => save({ override_result: v })}>{t(`brand.v.${v}`)}</Button>)}
              {b.override_result && <Button size="sm" variant="ghost" onClick={() => save({ override_result: 'undo' })}>{t('brand.restore_result')}</Button>}</div>}
          </Card>
          <Card title={t('brand.measurements')}>{b.measurements ? <pre className="text-xs" dir="ltr">{JSON.stringify(b.measurements, null, 2)}</pre> : <p className="text-sm text-zinc-500">{t('brand.no_measurements')}</p>}</Card>
        </div>
      </div>
      {can('performance.delete') && <Card className="mt-4"><Button variant="danger" icon={<Trash2 className="size-4" />} onClick={() => run(() => del(`/branding/${id}`)).then((r) => r && history.back())}>{t('common.delete')}</Button></Card>}
    </>
  );
}

export function BrandingImport() {
  const { t } = useI18n();
  return (
    <>
      <PageHeader title={t('brand.import')} back="/admin/branding" />
      <ImportWizard base="/branding-import" back="/admin/branding" modeLabels={{ question: t('brand.days_recorded'), skip: t('brand.keep_stored'), replace: t('brand.replace_day') }}
        options={[{ name: 'skip_unknown', label: t('brand.skip_unknown'), defaultOn: true }, { name: 'recheck_changed', label: t('brand.recheck_changed'), defaultOn: true }]}
        extraLabels={{ new_photos: t('brand.new_photos'), changed: t('brand.changed'), unchanged: t('brand.unchanged'), would_delete: t('brand.would_delete'), recorded_days: t('brand.recorded_days'), unknown_riders: t('perf.unknown_riders') }} />
    </>
  );
}
