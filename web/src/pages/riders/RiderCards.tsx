import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { get } from '../../api';
import { useAuth } from '../../auth';
import { fmtNum, useI18n } from '../../i18n';
import { Badge, Button, Card, StatCard } from '../../ui/kit';
import { LEAVE_TONE } from '../ops/Leaves';
import { FinancialSummary } from '../finance/Finance';

// The rider's leaves (3.1), absence (3.2) and financial summary (8.5) inside the rider's record.
export function RiderOpsCards({ riderId }: { riderId: number | string }) {
  const { can } = useAuth();
  return (
    <div className="mt-4 space-y-4">
      {can('finance.view') && <FinancialSummary riderId={riderId} />}
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
