import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Columns3, FileUp, RefreshCw } from 'lucide-react';
import { get, post } from '../../api';
import { useAuth } from '../../auth';
import { fmtDateTime, fmtNum, useI18n } from '../../i18n';
import { Badge, Button, Card, Checkbox, cx, PageHeader, SidePanel, StatCard, StatGrid, useAction, useUi, type Tone } from '../../ui/kit';
import { DataTable, FilterBar, FilterSelect, useList, type Column } from '../../ui/table';
import { ImportWizard } from '../../ui/importer';
import { ExportButton } from '../../ui/common';

export const SEG_TONE: Record<string, Tone> = { A: 'green', B: 'green', C: 'blue', D: 'amber', E: 'amber', F: 'red' };
const pc = (v: unknown, d = 2) => (v == null ? '—' : `${(Number(v) * 100).toFixed(d)}%`);
const COLS = ['segment', 'final_score', 'on_time', 'fail_rate_score', 'gross_orders', 'completed', 'completed_in_time', 'failed_by_rider', 'verification_requests', 'verification_success', 'verification_rate', 'city', 'contract', 'month', 'source'];
const DEFAULT = ['segment', 'final_score', 'on_time', 'fail_rate_score', 'completed', 'verification_rate', 'source'];
const RATES = new Set(['final_score', 'on_time', 'fail_rate_score', 'verification_rate']);
const LABEL: Record<string, string> = { segment: 'rat.segment', final_score: 'rat.final', on_time: 'rat.on_time', fail_rate_score: 'rat.fail_rate', gross_orders: 'rat.gross', completed: 'rat.completed',
  completed_in_time: 'rat.in_time', failed_by_rider: 'rat.failed', verification_requests: 'rat.ver_requests', verification_success: 'rat.ver_success', verification_rate: 'rat.ver_rate',
  city: 'rat.city', contract: 'rat.contract', month: 'rat.month', source: 'rat.source' };

export function RatingsList() {
  const { t } = useI18n();
  const { can } = useAuth();
  const nav = useNavigate();
  const run = useAction();
  const { confirm } = useUi();
  const list = useList('/ratings');
  const [cols, setCols] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('lsp.rat.cols') ?? '') ?? DEFAULT; } catch { return DEFAULT; } });
  const [picking, setPicking] = useState(false);
  useEffect(() => { try { localStorage.setItem('lsp.rat.cols', JSON.stringify(cols)); } catch { /* ignore */ } }, [cols]);
  const d = list.data;
  const s = list.stats ?? {};
  const cell = (k: string, r: any) => k === 'segment' ? (r.segment ? <Badge tone={SEG_TONE[r.segment]}>{r.segment}</Badge> : '—')
    : RATES.has(k) ? <span className="num">{pc(r[k])}</span> : k === 'source' ? <div className="text-xs">{t(`rat.src.${r.source}`)}<div className="text-zinc-500 num">{fmtDateTime(r.updated_at)}</div></div>
    : typeof r[k] === 'number' ? <span className="num">{fmtNum(r[k])}</span> : r[k] ?? '—';
  const columns: Column<any>[] = [
    { key: 'rider', header: t('rat.rider'), sort: 'rider', render: (r) => <div><Link to={`/admin/riders/${r.rider_id}`} className="font-medium hover:text-brand">{r.full_name}</Link><div className="text-xs text-zinc-500"><span className="num">#{r.rider_id}</span>{r.city && ` · ${r.city}`}</div></div> },
    ...cols.map((k) => ({ key: k, header: t(LABEL[k]), sort: k === 'final_score' ? 'final' : undefined, render: (r: any) => cell(k, r) })),
  ];
  const remove = async () => {
    if (!(await confirm({ title: t('rat.delete_q', { n: list.selected.size }), body: t('rat.delete_body') }))) return;
    if (await run(() => post('/ratings/bulk-delete', { ids: [...list.selected] }), t('common.deleted'))) { list.setSelected(new Set()); list.reload(); }
  };
  return (
    <>
      <PageHeader title={t('rat.title')} subtitle={d?.month && <Badge tone="blue"><span className="num">{d.month}</span></Badge>} actions={<>
        <Button icon={<Columns3 className="size-4" />} onClick={() => setPicking(true)}>{t('perf.columns')}</Button>
        {can('ratings.export') && <ExportButton path="/ratings/export" query={{ ...list.query, month: d?.month, cols: cols.join(',') }} />}
        {can('ratings.import') && <Link to="/admin/rider-ratings/import"><Button icon={<FileUp className="size-4" />}>{t('rat.import')}</Button></Link>}
        {can('sync.run') && <Link to="/admin/sync"><Button icon={<RefreshCw className="size-4" />}>{t('perf.sync_hs')}</Button></Link>}
      </>} />
      <StatGrid>
        <StatCard label={t('rat.s.graded')} value={fmtNum(s.riders)} sub={d?.month && <span className="num">{d.month}</span>} />
        <StatCard label={t('rat.s.final')} value={pc(s.final)} /><StatCard label={t('rat.s.on_time')} value={pc(s.on_time)} />
        <StatCard label={t('rat.s.fail_rate')} value={pc(s.fail_rate)} /><StatCard label={t('rat.s.verification')} value={pc(s.verification)} />
        <StatCard label={t('rat.s.orders')} value={`${fmtNum(s.completed)} / ${fmtNum(s.gross)}`} sub={t('rat.n_failed', { n: fmtNum(s.failed) })} />
      </StatGrid>
      {d?.ladder && (
        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {d.ladder.map((l: any) => (
            <button key={l.segment} onClick={() => list.set('segment', list.query.segment === l.segment ? null : l.segment)}
              className={cx('rounded-xl border bg-white p-3 text-start transition hover:border-brand/60 dark:bg-zinc-900', list.query.segment === l.segment ? 'border-brand ring-2 ring-brand/25' : 'border-zinc-200 dark:border-zinc-800')}>
              <div className="flex items-center gap-2"><Badge tone={SEG_TONE[l.segment]}>{l.segment}</Badge><span className="text-xs font-medium">{t(`rat.seg.${l.segment}`)}</span></div>
              <div className="mt-2 text-xs text-zinc-500">{l.min_final != null ? <span className="num">{pc(l.min_final)}{l.upper != null && ` → ${pc(l.upper)}`}</span> : t('rat.no_floor')}</div>
              {(l.min_otd != null || l.min_fr != null) && <div className="text-[11px] text-zinc-500 num">OTD ≥ {pc(l.min_otd)} · FR ≥ {pc(l.min_fr)}</div>}
              <div className="mt-1 text-sm"><b className="num">{l.n}</b> <span className="text-xs text-zinc-500 num">({s.riders ? Math.round((l.n / s.riders) * 100) : 0}%)</span>
                {l.city_riders != null && <span className="ms-1 text-[11px] text-zinc-500">· {t('rat.city_all', { n: l.city_riders })}</span>}</div>
            </button>
          ))}
        </div>
      )}
      <FilterBar list={list} placeholder={t('rat.search_hint')}>
        <FilterSelect list={list} name="month" label={t('rat.month')} allLabel={d?.month ?? t('common.all')} options={(d?.months ?? []).map((m: any) => ({ value: m.month, label: `${m.month} (${m.n})` }))} />
        <FilterSelect list={list} name="segment" label={t('rat.segment')} options={['A', 'B', 'C', 'D', 'E', 'F'].map((x) => ({ value: x, label: `${x} — ${t(`rat.seg.${x}`)}` }))} />
      </FilterBar>
      <DataTable list={list} columns={columns} onRowClick={(r) => nav(`/admin/riders/${r.rider_id}`)} selectable={can('ratings.delete')}
        bulk={<Button size="sm" variant="danger" onClick={remove}>{t('common.delete_selected')}</Button>}
        emptyText={<div><div className="font-medium">{t('rat.none')}</div><div className="text-xs">{t('rat.none_hint')}</div></div>} />
      <SidePanel open={picking} onClose={() => setPicking(false)} title={t('perf.visible_columns')}>
        <ul className="space-y-2">{COLS.map((k) => <li key={k}><Checkbox checked={cols.includes(k)} onChange={(v) => setCols(v ? COLS.filter((x) => x === k || cols.includes(x)) : cols.filter((x) => x !== k))} label={t(LABEL[k])} /></li>)}</ul>
      </SidePanel>
    </>
  );
}

export function RatingsImport() {
  const { t } = useI18n();
  return (
    <>
      <PageHeader title={t('rat.import')} back="/admin/rider-ratings" />
      <ImportWizard base="/ratings/import" back="/admin/rider-ratings" options={[{ name: 'create_riders', label: t('rat.create_riders') }]}
        extraLabels={{ unknown_riders: t('perf.unknown_riders'), months: t('rat.months_in_file') }} intro={<p className="text-sm text-zinc-500">{t('rat.import_intro')}</p>} />
    </>
  );
}

// The rider file's "HungerStation monthly rating" card.
export function RatingCard({ riderId }: { riderId: number | string }) {
  const { t } = useI18n();
  const { can } = useAuth();
  const [rows, setRows] = useState<any[] | null>(null);
  const [all, setAll] = useState(false);
  useEffect(() => { if (can('ratings.view')) get(`/ratings/rider/${riderId}`).then(setRows).catch(() => setRows([])); }, [riderId, can]);
  if (!can('ratings.view') || !rows) return null;
  const latest = rows[rows.length - 1];
  const best = rows.reduce((b, r) => (b == null || Number(r.final_score) > Number(b.final_score) ? r : b), null as any);
  const avg = rows.length ? rows.reduce((s, r) => s + Number(r.final_score ?? 0), 0) / rows.length : 0;
  const shown = all ? rows : rows.slice(-6);
  return (
    <Card title={t('rat.card')} actions={latest && <Link to={`/admin/rider-ratings?month=${latest.month}&search=${riderId}`}><Button size="sm" variant="ghost">{t('rat.all_ratings')}</Button></Link>}>
      {!rows.length ? <p className="text-sm text-zinc-500">{t('rat.card_empty')}</p> : <>
        <div className="mb-3 grid grid-cols-3 gap-2">
          <StatCard label={t('rat.latest')} value={latest.segment ?? '—'} sub={pc(latest.final_score)} tone={SEG_TONE[latest.segment] ?? 'none'} />
          <StatCard label={t('rat.best_month')} value={<span className="num">{best.month}</span>} sub={pc(best.final_score)} />
          <StatCard label={t('rat.avg_score')} value={pc(avg)} sub={t('rat.n_months', { n: rows.length })} />
        </div>
        <div className="mb-3 flex flex-wrap gap-1" dir="ltr">{rows.map((r) => <Badge key={r.month} tone={SEG_TONE[r.segment] ?? 'grey'}>{r.segment ?? '·'}</Badge>)}</div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {shown.map((r) => (
            <div key={r.month} className="rounded-lg border border-zinc-200 p-2 text-xs dark:border-zinc-700" title={`${t('rat.needed')}: ${pc(r.floor)} · ${t('rat.next_needed')}: ${pc(r.next_floor)}`}>
              <div className="flex items-center justify-between"><span className="num font-medium">{r.month}</span><Badge tone={SEG_TONE[r.segment] ?? 'grey'}>{r.segment ?? '—'}</Badge></div>
              <div className="mt-1 text-sm font-semibold num">{pc(r.final_score)}</div>
              <div className="text-zinc-500 num">OTD {pc(r.on_time, 1)} · FR {pc(r.fail_rate_score, 1)}</div>
              <div className="text-zinc-500 num">{fmtNum(r.completed)} · {t('rat.ver_rate')} {pc(r.verification_rate, 0)}</div>
            </div>
          ))}
        </div>
        {rows.length > 6 && <Button size="sm" variant="ghost" className="mt-2" onClick={() => setAll(!all)}>{all ? t('rat.show_less') : t('rat.show_all')}</Button>}
      </>}
    </Card>
  );
}
