import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { get } from '../api';
import { useAuth } from '../auth';
import { fmtDateTime, useI18n } from '../i18n';
import { cx } from './kit';
import { useNoteText } from './notes';

// The bell: your latest eight notifications, unread first. Read-only; it refreshes every minute.
export function NotificationBell() {
  const { t } = useI18n();
  const { can } = useAuth();
  const text = useNoteText();
  const [d, setD] = useState<{ rows: any[]; unread: number; top: string } | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const load = () => get('/notifications/mine').then((x) => { setD(x); setFailed(false); }).catch(() => setFailed(true));
    load();
    const h = setInterval(load, 60000);
    return () => clearInterval(h);
  }, []);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  const n = d?.unread ?? 0;
  return (
    <div className="relative" ref={box}>
      <button onClick={() => setOpen(!open)} title={t('note.title')} aria-label={t('note.title')} className="relative rounded-lg p-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">
        <Bell className="size-4" />
        {n > 0 && <span className={cx('absolute -end-0.5 -top-0.5 min-w-4 rounded-full px-1 text-center text-[10px] font-semibold leading-4 num',
          d?.top === 'critical' ? 'bg-red-600 text-white' : d?.top === 'warning' ? 'bg-amber-400 text-amber-950' : 'bg-brand text-white')}>{n > 99 ? '99+' : n}</span>}
      </button>
      {open && (
        <div className="pop-in absolute end-0 mt-1 w-80 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          <div className="border-b border-zinc-100 px-3 py-2 dark:border-zinc-800"><div className="font-semibold text-sm">{t('note.title')}</div><div className="text-xs text-zinc-500">{t('note.n_unread', { n })}</div></div>
          <ul className="scroll-thin max-h-96 divide-y divide-zinc-100 overflow-y-auto dark:divide-zinc-800">
            {failed && <li className="p-4 text-center text-xs text-red-600">{t('note.load_failed')}</li>}
            {!failed && d?.rows.length === 0 && <li className="p-4 text-center text-xs text-zinc-500">{t('note.none')}</li>}
            {d?.rows.map((r) => { const x = text(r); return (
              <li key={r.id} className={cx('px-3 py-2 text-xs', !r.read_at && 'bg-brand-soft')}>
                <div className="flex items-start gap-2"><span className={cx('mt-1 size-2 shrink-0 rounded-full', r.severity === 'critical' ? 'bg-red-500' : r.severity === 'warning' ? 'bg-amber-500' : 'bg-blue-500')} />
                  <div className="min-w-0"><div className="font-medium text-zinc-800 dark:text-zinc-100">{x.title}</div>{x.body && <div className="text-zinc-500">{x.body}</div>}<div className="mt-0.5 text-zinc-400 num">{fmtDateTime(r.created_at)}</div></div></div>
              </li>
            ); })}
          </ul>
          {can('notifications.view') && <Link to="/admin/notifications" onClick={() => setOpen(false)} className="block border-t border-zinc-100 px-3 py-2 text-center text-xs font-medium text-brand hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800">{t('note.view_all')}</Link>}
        </div>
      )}
    </div>
  );
}
