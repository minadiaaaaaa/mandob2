import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Eye, X } from 'lucide-react';
import { get, post } from '../../api';
import { useAuth } from '../../auth';
import { fmtDateTime, useI18n } from '../../i18n';
import { Alert, Badge, Button, By, Field, IconButton, Loading, PageHeader, SidePanel, StatCard, StatGrid, toneIf, useErrorText, useUi, type Tone } from '../../ui/kit';
import { DataTable, FilterBar, FilterDate, FilterSelect, useList, type Column } from '../../ui/table';
import { FilePreview } from '../../ui/files';

const TONE: Record<string, Tone> = { pending: 'amber', approved: 'green', rejected: 'red', cancelled: 'grey' };
export const CR_DOC_TYPES = ['id', 'license', 'health', 'driver_card', 'ajeer', 'other'];
const FIELDS: Record<string, string[]> = { contact: ['phone', 'email'], document: ['doc_number', 'issue_date', 'expiry_date'], photo: [] };

export function summary(t: (k: string, v?: any) => string, r: { type: string; payload: any }) {
  const p = typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload;
  if (r.type === 'photo') return t('crq.new_photo');
  return FIELDS[r.type].filter((k) => p?.[k]).map((k) => `${t(`crq.f.${k}`)}: ${p[k]}`).join(' · ');
}

export function ChangeRequests() {
  const { t } = useI18n();
  const list = useList('/change-requests', { status: 'pending' });
  const [open, setOpen] = useState<number | null>(null);
  const s = list.stats ?? {};
  const status = list.query.status;
  const columns: Column<any>[] = [
    { key: 'rider', header: t('crq.rider'), render: (r) => <div><div className="font-medium">{r.full_name}</div><div className="text-xs text-zinc-500 num">#{r.rider_id}</div></div> },
    { key: 'type', header: t('crq.type'), render: (r) => <div>{t(`crq.t.${r.type}`)}{r.doc_type && <div className="text-xs text-zinc-500">{t(`crq.d.${r.doc_type}`)}</div>}</div> },
    { key: 'change', header: t('crq.requested_change'), render: (r) => <span className="line-clamp-2 max-w-72 text-xs" dir="auto">{summary(t, r)}</span> },
    { key: 'files', header: t('crq.files'), render: (r) => <span className="num">{r.files}</span> },
    { key: 'submitted', header: t('crq.submitted'), sort: 'submitted', render: (r) => <span className="num text-xs">{fmtDateTime(r.created_at)}</span> },
    { key: 'status', header: t('crq.status'), render: (r) => <Badge tone={TONE[r.status]}>{t(`crq.s.${r.status}`)}</Badge> },
    { key: 'reviewed', header: t('crq.reviewed_by'), render: (r) => (r.reviewed_by_name ? <div className="text-xs"><By name={r.reviewed_by_name} at={fmtDateTime(r.reviewed_at)} /></div> : '—') },
    { key: 'actions', header: t('common.actions'), render: (r) => <IconButton title={r.status === 'pending' ? t('crq.review') : t('crq.view')} onClick={() => setOpen(r.id)}><Eye /></IconButton> },
  ];
  const card = (k: string, n: number, tone: Tone) => <StatCard label={t(`crq.c.${k}`)} value={n ?? 0} tone={toneIf(n, tone)} active={status === k} onClick={() => list.set('status', status === k ? 'any' : k)} />;
  return (
    <>
      <PageHeader title={t('crq.title')} subtitle={t('crq.subtitle')} actions={list.query.rider && (
        <Button size="sm" variant="ghost" icon={<X className="size-3.5" />} onClick={() => list.set('rider', null)}>{t('crq.rider_only', { id: list.query.rider })}</Button>
      )} />
      <StatGrid>{card('pending', s.pending, 'amber')}{card('approved', s.approved, 'green')}{card('rejected', s.rejected, 'red')}</StatGrid>
      <FilterBar list={list} placeholder={t('crq.search_hint')}>
        <FilterSelect list={list} name="status" label={t('crq.status')} allLabel={t('crq.s.pending')} options={[...['approved', 'rejected', 'cancelled'].map((k) => ({ value: k, label: t(`crq.s.${k}`) })), { value: 'any', label: t('common.all') }]} />
        <FilterSelect list={list} name="type" label={t('crq.type')} options={Object.keys(FIELDS).map((k) => ({ value: k, label: t(`crq.t.${k}`) }))} />
        <FilterSelect list={list} name="doc_type" label={t('crq.doc_type')} options={CR_DOC_TYPES.map((k) => ({ value: k, label: t(`crq.d.${k}`) }))} />
        <FilterDate list={list} name="from" label={t('common.from_date')} />
        <FilterDate list={list} name="to" label={t('common.to_date')} />
      </FilterBar>
      <DataTable list={list} columns={columns} onRowClick={(r) => setOpen(r.id)} />
      <ReviewPanel id={open} onClose={() => setOpen(null)} onDone={() => { setOpen(null); list.reload(); }} />
    </>
  );
}

function ReviewPanel({ id, onClose, onDone }: { id: number | null; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const { can } = useAuth();
  const { confirm, toast } = useUi();
  const errText = useErrorText();
  const [r, setR] = useState<any>(null);
  const [note, setNote] = useState('');
  const [noteErr, setNoteErr] = useState(false);
  const [preview, setPreview] = useState<number | null>(null);
  const load = () => id && get(`/change-requests/${id}`).then(setR).catch(() => onClose());
  useEffect(() => { setR(null); setNote(''); setNoteErr(false); setPreview(null); load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const decide = async (d: 'approve' | 'reject') => {
    if (d === 'reject' && !note.trim()) { setNoteErr(true); return; }
    if (!(await confirm({ title: t(d === 'approve' ? 'crq.approve_q' : 'crq.reject_q'), confirm: t(d === 'approve' ? 'crq.yes_approve' : 'crq.yes_reject'), tone: d === 'approve' ? 'primary' : 'danger' }))) return;
    try { await post(`/change-requests/${id}/${d}`, { note }); toast(t('common.saved')); onDone(); }
    catch (e: any) { toast(errText(e), 'red'); if (e?.code === 'request_not_pending') load(); }
  };
  const fields = r ? FIELDS[r.type] : [];
  return (
    <SidePanel open={!!id} onClose={onClose} title={<>{t('crq.panel_title')} <span className="num">#{id}</span></>}>
      {!r ? <Loading /> : (
        <div className="space-y-5 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{r.full_name}</span><span className="num text-zinc-500">#{r.rider_id}</span>
            <Badge tone={TONE[r.status]}>{t(`crq.s.${r.status}`)}</Badge>
            <Link to={`/admin/riders/${r.rider_id}`} className="ms-auto text-xs text-brand hover:underline">{t('crq.rider_profile')}</Link>
          </div>
          <div className="text-xs text-zinc-500">{t(`crq.t.${r.type}`)}{r.doc_type && ` · ${t(`crq.d.${r.doc_type}`)}`} · <span className="num">{fmtDateTime(r.created_at)}</span></div>
          {r.type === 'document' && r.doc_type !== 'other' && !r.current && <Alert tone="amber">{t('crq.no_document')}</Alert>}
          {fields.length > 0 && (
            <section>
              <h4 className="mb-2 font-semibold">{t('crq.comparison')}</h4>
              <table className="w-full text-xs"><thead className="text-zinc-500"><tr><th className="py-1 text-start">{t('crq.field')}</th><th className="text-start">{t('crq.current')}</th><th className="text-start">{t('crq.requested')}</th></tr></thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {fields.filter((k) => r.payload?.[k]).map((k) => {
                    const cur = r.current?.[k] ?? null; const was = r.snapshot?.[k] ?? null; const want = r.payload[k];
                    return (
                      <tr key={k} className="align-top">
                        <td className="py-2 pe-2 font-medium">{t(`crq.f.${k}`)}</td>
                        <td className="py-2 pe-2"><span className="num">{cur ?? '—'}</span>
                          {r.status === 'pending' && was !== null && String(was) !== String(cur) && <div className="mt-1 text-amber-700 dark:text-amber-400">{t('crq.changed_since')} <span className="num">{was}</span></div>}</td>
                        <td className="py-2"><span className="num font-medium">{want}</span>{String(want) === String(cur ?? '') && <div className="mt-1 text-zinc-500">{t('crq.same_as_current')}</div>}
                          {k === 'doc_number' && r.doc_type === 'id' && <div className="mt-1 text-zinc-500">{t('crq.id_number_kept')}</div>}</td>
                      </tr>
                    );
                  })}
                </tbody></table>
            </section>
          )}
          {r.type === 'photo' && (
            <section className="grid grid-cols-2 gap-3">
              {[[t('crq.current_photo'), r.current_photo], [t('crq.requested_photo'), r.files.find((f: any) => f.attachment_type === 'photo')?.id ?? r.files[0]?.id]].map(([label, aid]) => (
                <div key={label}><div className="mb-1 text-xs text-zinc-500">{label}</div>
                  <div className="flex aspect-square items-center justify-center overflow-hidden rounded-lg bg-zinc-100 dark:bg-zinc-800">{aid ? <img src={`/api/attachments/${aid}/file`} alt="" className="h-full w-full object-cover" /> : '—'}</div></div>
              ))}
            </section>
          )}
          {r.files.length > 0 && r.type !== 'photo' && (
            <section>
              <h4 className="mb-2 font-semibold">{t('crq.attached_files')}</h4>
              <ul className="space-y-1">{r.files.map((f: any) => (
                <li key={f.id}>
                  <button className="text-brand hover:underline" onClick={() => setPreview(preview === f.id ? null : f.id)}>{f.file_name}</button>
                  <a className="ms-2 text-xs text-zinc-500 hover:underline" href={`/api/attachments/${f.id}/file`} target="_blank" rel="noreferrer">{t('files.open')}</a>
                  {preview === f.id && <FilePreview src={`/api/attachments/${f.id}/file`} mime={f.mime} />}
                </li>
              ))}</ul>
            </section>
          )}
          <section>
            <h4 className="mb-2 font-semibold">{t('crq.notes_history')}</h4>
            {r.rider_note && <div className="mb-2 rounded-lg bg-zinc-50 p-2 dark:bg-zinc-800"><div className="text-xs text-zinc-500">{t('crq.rider_note')}</div>{r.rider_note}</div>}
            <ul className="space-y-1 text-xs text-zinc-500">
              <li>{t('crq.h_submitted')} · <span className="num">{fmtDateTime(r.created_at)}</span></li>
              {r.reviewed_at && <li>{t(`crq.s.${r.status}`)} · <By name={r.reviewed_by_name} at={fmtDateTime(r.reviewed_at)} />{r.review_note && <div className="mt-1 text-zinc-700 dark:text-zinc-300">{r.review_note}</div>}</li>}
            </ul>
          </section>
          {r.status === 'pending' && (can('rider_portal.review_requests') ? (
            <section className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
              <h4 className="mb-2 font-semibold">{t('crq.decision')}</h4>
              <Field label={t('crq.note_to_rider')} error={noteErr ? t('err.reject_note_required') : undefined} hint={t('crq.note_hint')}>
                <textarea className="input" rows={3} maxLength={500} value={note} aria-invalid={noteErr} onChange={(e) => { setNote(e.target.value); setNoteErr(false); }} />
              </Field>
              <div className="mt-3 flex gap-2">
                <Button variant="primary" onClick={() => decide('approve')}>{t('crq.approve')}</Button>
                <Button variant="danger" onClick={() => decide('reject')}>{t('crq.reject')}</Button>
              </div>
            </section>
          ) : <Alert tone="amber">{t('crq.no_review_perm')}</Alert>)}
        </div>
      )}
    </SidePanel>
  );
}
