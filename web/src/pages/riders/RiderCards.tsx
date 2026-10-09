import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { get, post } from '../../api';
import { useAuth } from '../../auth';
import { fmtDateTime, fmtNum, useI18n } from '../../i18n';
import { Badge, Button, Card, Details, Field, Modal, StatCard, useAction, useUi } from '../../ui/kit';
import { LEAVE_TONE } from '../ops/Leaves';
import { FinancialSummary } from '../finance/Finance';
import { RatingCard } from '../performance/Ratings';

// The rider's leaves (3.1), absence (3.2) and financial summary (8.5) inside the rider's record.
export function RiderOpsCards({ riderId }: { riderId: number | string }) {
  const { can } = useAuth();
  return (
    <div className="mt-4 space-y-4">
      {can('rider_portal.manage_portal') && <PortalAccountCard riderId={riderId} />}
      {can('finance.view') && <FinancialSummary riderId={riderId} />}
      {can('ratings.view') && <RatingCard riderId={riderId} />}
      <div className="grid gap-4 lg:grid-cols-2">
        {can('leaves.view') && <LeavesCard riderId={riderId} />}
        {can('absences.view') && <AbsenceCard riderId={riderId} />}
      </div>
    </div>
  );
}

function LeavesCard({ riderId }: { riderId: number | string }) {
  const { t } = useI18n();
  const { can } = useAuth();
  const [rows, setRows] = useState<any[] | null>(null);
  useEffect(() => { get('/leaves', { rider: riderId, pageSize: 10 }).then((d) => setRows(d.rows)).catch(() => setRows([])); }, [riderId]);
  return (
    <Card title={t('leaves.title')} pad={false} actions={<>
      <Link to={`/admin/leaves?search=${riderId}`}><Button size="sm" variant="ghost">{t('common.view')}</Button></Link>
      {can('leaves.create') && <Link to={`/admin/leaves/new?rider=${riderId}`}><Button size="sm" icon={<Plus className="size-3.5" />}>{t('leaves.request')}</Button></Link>}
    </>}>
      {!rows?.length ? <p className="p-4 text-sm text-zinc-500">{t('table.no_records')}</p> : (
        <ul className="divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
          {rows.slice(0, 5).map((l) => (
            <li key={l.id}><Link to={`/admin/leaves/${l.id}`} className="flex items-center gap-2 px-4 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
              <span className="num font-medium">{l.letter_no}</span><span className="text-zinc-500">{t(`leaves.t.${l.leave_type}`)}</span>
              <span className="num text-xs text-zinc-500">{l.start_date === l.end_date ? l.start_date : `${l.start_date} → ${l.end_date}`}</span>
              <Badge tone={LEAVE_TONE[l.status]} className="ms-auto">{t(`leaves.s.${l.status}`)}</Badge>
            </Link></li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function AbsenceCard({ riderId }: { riderId: number | string }) {
  const { t } = useI18n();
  const [a, setA] = useState<any>(null);
  useEffect(() => { get(`/absences/rider/${riderId}`).then(setA).catch(() => {}); }, [riderId]);
  if (!a) return null;
  return (
    <Card title={t('abs.card')} actions={<Link to={`/admin/absences?search=${riderId}`}><Button size="sm" variant="ghost">{t('common.view')}</Button></Link>}>
      <div className="mb-3 grid grid-cols-3 gap-2">
        <StatCard label={t('abs.total_days')} value={fmtNum(a.total)} />
        <StatCard label={t('abs.this_year')} value={fmtNum(a.this_year)} />
        <StatCard label={t('abs.unpaid_days')} value={fmtNum(a.unpaid)} tone={a.unpaid ? 'amber' : 'none'} />
      </div>
      {a.latest.length === 0 ? <p className="text-sm text-zinc-500">{t('table.no_records')}</p> : (
        <ul className="space-y-1 text-xs">{a.latest.map((x: any) => (
          <li key={x.id} className="flex gap-2"><span className="num">{x.start_at.slice(0, 10)}</span><span className="text-zinc-500">{t('abs.n_days', { n: x.days })}</span>
            <span className="text-zinc-500">{x.reason ?? ''}</span>{x.paid === 0 && <Badge tone="amber" className="ms-auto">{t('abs.paid_no')}</Badge>}</li>
        ))}</ul>
      )}
    </Card>
  );
}

// 12.14 "Rider portal account": access, password, sign-ins. Only for "Manage portal accounts".
function PortalAccountCard({ riderId }: { riderId: number | string }) {
  const { t } = useI18n();
  const { confirm, toast } = useUi();
  const run = useAction();
  const [a, setA] = useState<any>(null);
  const load = useCallback(() => get(`/riders/${riderId}/portal`).then(setA).catch(() => {}), [riderId]);
  useEffect(() => { load(); }, [load]);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const savePassword = async () => {
    const r = await run(() => post(`/riders/${riderId}/portal/reset-password`, { password, confirm: passwordConfirm }));
    if (r) { setPasswordOpen(false); setPassword(''); setPasswordConfirm(''); load(); toast(t('portal_acc.reset_ok', { n: r.ended ?? 0 })); }
  };
  if (!a) return null;
  const act = async (what: 'disable' | 'enable' | 'reset-password', okKey: string) => {
    if (!(await confirm({ title: t(`portal_acc.${what}_q`), body: t(`portal_acc.${what}_body`), tone: what === 'enable' ? 'primary' : 'danger', confirm: t(`portal_acc.${what}`) }))) return;
    const r = await run(() => post(`/riders/${riderId}/portal/${what}`));
    if (r) { load(); toast(t(okKey, { n: r.ended ?? 0 })); }
  };
  return (
    <Card title={t('portal_acc.title')} actions={<>
      {a.portal_enabled ? <Button size="sm" variant="danger" onClick={() => act('disable', 'portal_acc.disabled_ok')}>{t('portal_acc.disable')}</Button>
        : <Button size="sm" variant="primary" onClick={() => act('enable', 'portal_acc.enabled_ok')}>{t('portal_acc.enable')}</Button>}
      <Button size="sm" onClick={() => setPasswordOpen(true)}>{t('portal_acc.assign_password')}</Button>
    </>}>
      <Modal open={passwordOpen} onClose={() => { setPasswordOpen(false); setPassword(''); setPasswordConfirm(''); }} title={t('portal_acc.assign_password')} footer={<Button onClick={savePassword}>{t('common.confirm')}</Button>}>
        <p className="mb-3 text-sm">{t('portal_acc.password_help')}</p>
        <Field label={t('portal_acc.password')}><input className="input" type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} /></Field>
        <Field label={t('portal_acc.confirm_password')}><input className="input" type="password" autoComplete="new-password" value={passwordConfirm} onChange={e => setPasswordConfirm(e.target.value)} /></Field>
      </Modal>
      <Details cols={3} rows={[
        [t('portal_acc.access'), <Badge tone={a.portal_enabled ? 'green' : 'red'}>{a.portal_enabled ? t('portal_acc.enabled') : t('portal_acc.disabled')}</Badge>, true],
        [t('portal_acc.password'), a.has_password ? <>{t('portal_acc.set')} · <span className="num">{fmtDateTime(a.portal_password_set_at)}</span></> : t('portal_acc.not_set'), true],
        [t('portal_acc.last_sign_in'), a.last_login_at ? <span className="num">{fmtDateTime(a.last_login_at)}</span> : t('portal_acc.never'), true],
        [t('portal_acc.sessions'), fmtNum(a.active_sessions), true],
        [t('portal_acc.verified_email'), a.verified_email ?? '—', true],
      ]} />
      {!['active', 'inactive'].includes(a.status) && <p className="mt-3 text-xs text-amber-600">{t('portal_acc.status_blocks')}</p>}
      <h3 className="mb-1 mt-4 text-xs font-semibold text-zinc-500">{t('portal_acc.attempts')}</h3>
      {!a.attempts.length ? <p className="text-sm text-zinc-500">{t('portal_acc.never')}</p> : (
        <ul className="divide-y divide-zinc-100 text-sm dark:divide-zinc-800">{a.attempts.map((x: any, i: number) => (
          <li key={i} className="flex flex-wrap items-center gap-2 py-1.5"><Badge tone={x.success ? 'green' : 'red'}>{x.success ? t('portal_acc.success') : t('portal_acc.failed')}</Badge>
            {!x.success && <span className="text-xs">{t(`portal_acc.reason.${x.reason}`)}</span>}<span className="ms-auto text-xs text-zinc-500 num">{x.ip} · {fmtDateTime(x.created_at)}</span></li>))}</ul>
      )}
    </Card>
  );
}
