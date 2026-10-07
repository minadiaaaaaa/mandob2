import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { get } from '../api';
import { useAuth } from '../auth';
import { fmtNum, useI18n } from '../i18n';
import { Card, PageHeader, StatCard, StatGrid } from '../ui/kit';

type Badges = Record<string, { expired: number; soon: number }>;

// ponytail: the full dashboard (12 figures, 10 charts, latest events) arrives with chapter 9; this shows the
// expiry counts that exist now plus the guide's "quick daily tasks" table.
export default function Dashboard() {
  const { t } = useI18n();
  const { can, me } = useAuth();
  const [b, setB] = useState<Badges>({});
  useEffect(() => { get<Badges>('/meta/badges').then(setB).catch(() => {}); }, []);
  const expired = Object.values(b).reduce((s, x) => s + x.expired, 0);
  const soon = Object.values(b).reduce((s, x) => s + x.soon, 0);
  const tasks: [string, string, string][] = ([
    ['dash.t.add_rider', '/admin/riders/new', 'riders.create'],
    ['dash.t.hand_vehicle', '/admin/vehicle-assignments/new', 'vehicle_assignments.create'],
    ['dash.t.oil_change', '/admin/oil-changes/history/new', 'oil_changes.create'],
    ['dash.t.expiring_docs', '/admin/riders/id-documents?validity=expired,near', 'id_documents.view'],
    ['dash.t.add_employee', '/admin/users/new', 'users.create'],
  ] as [string, string, string][]).filter(([, , p]) => can(p));
  return (
    <>
      <PageHeader title={t('dash.title')} subtitle={t('dash.subtitle')} />
      <StatGrid>
        <StatCard label={t('dash.expired_documents')} value={fmtNum(expired)} tone={expired ? 'red' : 'none'} />
        <StatCard label={t('dash.expiring_soon')} value={fmtNum(soon)} tone={soon ? 'amber' : 'none'} />
      </StatGrid>
      <Card title={t('dash.quick_tasks')} subtitle={t('dash.hello', { name: me?.full_name })}>
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {tasks.map(([k, to]) => <li key={k}><Link to={to} className="flex py-2.5 text-sm hover:text-brand">{t(k)}</Link></li>)}
        </ul>
      </Card>
    </>
  );
}
