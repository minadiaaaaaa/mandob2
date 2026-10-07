import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Ban, CheckCircle2, ChevronDown, ChevronRight, Eye, KeyRound, Lock, LogOut, Pencil, Plus, Power, PowerOff, ShieldOff, Trash2, Unlock } from 'lucide-react';
import { ApiError, del, get, patch, post, put } from '../../api';
import { useAuth } from '../../auth';
import { fmtDateTime, fmtNum, useI18n } from '../../i18n';
import { Alert, Badge, Button, Card, Checkbox, cx, Details, Field, IconButton, Loading, Modal, PageHeader, StatCard, StatGrid, useAction, useErrorText, useUi, type Tone } from '../../ui/kit';
import { Grid, SaveBar, SelectInput, TextArea, TextInput, useForm } from '../../ui/forms';
import { DataTable, FilterBar, FilterDate, FilterSelect, useList, type Column } from '../../ui/table';
import { ExportButton, useOptions } from '../../ui/common';

const USER_STATUS: Record<string, Tone> = { active: 'green', disabled: 'grey', locked: 'red' };
const SESSION_STATUS: Record<string, Tone> = { active: 'green', expired: 'grey', revoked: 'red', signed_out: 'blue' };
const device = (ua: string | null) => {
  if (!ua) return '—';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  const br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : ua.slice(0, 30);
  return [br, os].filter(Boolean).join(' · ');
};

// ======================================================================== users
export function UsersList() {
  const { t } = useI18n();
  const { can, me } = useAuth();
  const nav = useNavigate();
  const run = useAction();
  const { confirm } = useUi();
  const list = useList('/users');
  const roles = useOptions<any>(can('roles.view') ? '/roles/options' : null);
  const act = async (r: any, kind: 'disable' | 'activate' | 'delete') => {
    const q = { disable: t('users.disable_q'), activate: t('users.activate_q'), delete: t('users.delete_q') }[kind];
    if (!(await confirm({ title: q, tone: kind === 'activate' ? 'primary' : 'danger' }))) return;
    const res = await run(() => (kind === 'delete' ? del(`/users/${r.id}`) : post(`/users/${r.id}/${kind}`)), kind === 'disable' ? undefined : t('common.saved'));
    if (res && kind === 'disable') run(async () => res, t('users.sessions_ended', { n: res.ended }));
    if (res) list.reload();
  };
  const columns: Column<any>[] = [
    { key: 'account', header: t('users.account'), sort: 'account', render: (r) => <div><div className="font-medium">{r.full_name}</div><div className="text-xs text-zinc-500" dir="ltr">{r.username}</div></div> },
    { key: 'email', header: t('users.email'), render: (r) => <span dir="ltr">{r.email}</span> },
    { key: 'role', header: t('users.role'), render: (r) => r.role_name },
    { key: 'status', header: t('users.status'), sort: 'status', render: (r) => <Badge tone={USER_STATUS[r.status]}>{t(`users.status.${r.status}`)}</Badge> },
    { key: 'last', header: t('users.last_login'), sort: 'last_login', render: (r) => (r.last_login_at ? <span className="num text-xs">{fmtDateTime(r.last_login_at)}</span> : <span className="text-xs text-zinc-500">{t('users.never')}</span>) },
    { key: 'created', header: t('users.created'), sort: 'created', render: (r) => <span className="num text-xs">{fmtDateTime(r.created_at)}</span> },
    { key: 'actions', header: t('common.actions'), render: (r) => <div className="flex">
      <IconButton title={t('common.view')} onClick={() => nav(`/admin/users/${r.id}`)}><Eye /></IconButton>
      {can('users.update') && <IconButton title={t('users.edit')} onClick={() => nav(`/admin/users/${r.id}/edit`)}><Pencil /></IconButton>}
      {r.id !== me?.id && (r.status === 'active' ? can('users.deactivate') && <IconButton title={t('users.disable')} tone="amber" onClick={() => act(r, 'disable')}><PowerOff /></IconButton>
        : can('users.activate') && <IconButton title={t('users.activate')} tone="green" onClick={() => act(r, 'activate')}><Power /></IconButton>)}
      {r.id !== me?.id && can('users.delete') && <IconButton title={t('users.delete')} tone="red" onClick={() => act(r, 'delete')}><Trash2 /></IconButton>}</div> },
  ];
  return (
    <>
      <PageHeader title={t('users.title')} actions={<>
        {can('users.export') && <ExportButton path="/users/export" query={list.query} label={t('common.export_csv')} />}
        {can('users.create') && <Link to="/admin/users/new"><Button variant="primary" icon={<Plus className="size-4" />}>{t('users.new')}</Button></Link>}
      </>} />
      <FilterBar list={list} placeholder={t('users.search_hint')}>
        {can('roles.view') ? <FilterSelect list={list} name="role" label={t('users.role')} options={roles.map((r: any) => ({ value: r.id, label: r.name }))} /> : <span className="text-xs text-zinc-500">{t('users.role_filter_needs')}</span>}
        <FilterSelect list={list} name="status" label={t('users.status')} options={Object.keys(USER_STATUS).map((v) => ({ value: v, label: t(`users.status.${v}`) }))} />
      </FilterBar>
      <DataTable list={list} columns={columns} onRowClick={(r) => nav(`/admin/users/${r.id}`)} />
    </>
  );
}

export function UserForm() {
  const { id } = useParams();
  const { t } = useI18n();
  const { me } = useAuth();
  const nav = useNavigate();
  const roles = useOptions<any>('/roles/options');
  const form = useForm<Record<string, any>>({ username: '', full_name: '', email: '', role_id: '', status: 'active', password: '', confirm: '' });
  const [loaded, setLoaded] = useState<any>(id ? null : {});
  useEffect(() => { if (id) get(`/users/${id}`).then((u) => { setLoaded(u); form.reset({ username: u.username, full_name: u.full_name, email: u.email, role_id: u.role_id }); }); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!loaded) return <Loading />;
  const active = roles.filter((r: any) => r.is_active || String(r.id) === String(form.values.role_id));
  const self = !!id && Number(id) === me?.id;
  return (
    <form onSubmit={async (e) => { e.preventDefault(); const r = await form.submit(() => (id ? patch(`/users/${id}`, form.changes) : post('/users', form.values))); if (r) nav(`/admin/users/${id ?? r.id}`); }}>
      <PageHeader title={id ? t('users.edit') : t('users.new')} back={id ? `/admin/users/${id}` : '/admin/users'} />
      {!id && roles.length > 0 && !roles.some((r: any) => r.is_active) && <div className="mb-4"><Alert tone="amber">{t('users.no_active_role')}</Alert></div>}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title={t('users.account_details')}><div className="space-y-3">
          <TextInput form={form} name="username" label={t('users.username')} required dir="ltr" hint={t('users.username_hint')} />
          <TextInput form={form} name="full_name" label={t('users.full_name')} required />
          <TextInput form={form} name="email" label={t('users.email')} required type="email" dir="ltr" />
        </div></Card>
        {!id && <Card title={t('users.password')}><div className="space-y-3">
          <TextInput form={form} name="password" label={t('users.password')} required type="password" hint={t('users.password_hint')} />
          <TextInput form={form} name="confirm" label={t('users.repeat_password')} required type="password" />
        </div></Card>}
        <Card title={t('users.role_status')}><div className="space-y-3">
          <SelectInput form={form} name="role_id" label={t('users.role')} required disabled={self} hint={self ? t('users.own_role') : undefined} options={active.map((r: any) => ({ value: r.id, label: r.is_active ? r.name : `${r.name} (${t('common.disabled')})` }))} />
          {!id && <SelectInput form={form} name="status" label={t('users.status')} empty={false} options={Object.keys(USER_STATUS).map((v) => ({ value: v, label: t(`users.status.${v}`) }))} />}
        </div></Card>
      </div>
      <SaveBar form={form} editing={!!id} label={id ? t('common.save_changes') : t('users.create')} onCancel={() => nav(-1)} />
    </form>
  );
}

export function PermissionTree({ perms, filterable = true }: { perms: string[]; filterable?: boolean }) {
  const { t } = useI18n();
  const [f, setF] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const byModule = perms.reduce<Record<string, string[]>>((m, p) => { const [mod, a] = p.split('.'); (m[mod] ??= []).push(a); return m; }, {});
  const mods = Object.entries(byModule).filter(([m]) => !f || t(`perm.m.${m}`).includes(f) || m.includes(f.toLowerCase()));
  return (
    <div>
      {filterable && <div className="mb-3 flex gap-2"><input className="input" placeholder={t('roles.filter_perms')} value={f} onChange={(e) => setF(e.target.value)} />
        <Button size="sm" onClick={() => setOpen(Object.fromEntries(Object.keys(byModule).map((m) => [m, true])))}>{t('roles.expand_all')}</Button><Button size="sm" onClick={() => setOpen({})}>{t('roles.collapse_all')}</Button></div>}
      <ul className="space-y-1">{mods.map(([m, acts]) => (
        <li key={m} className="rounded-lg border border-zinc-200 dark:border-zinc-800">
          <button type="button" onClick={() => setOpen({ ...open, [m]: !open[m] })} className="flex w-full items-center gap-2 px-3 py-2 text-sm">{open[m] || f ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}{t(`perm.m.${m}`)}<span className="ms-auto text-xs text-zinc-500 num">{acts.length}</span></button>
          {(open[m] || f) && <div className="flex flex-wrap gap-1 border-t border-zinc-100 px-3 py-2 dark:border-zinc-800">{acts.map((a) => <Badge key={a}>{t(`perm.a.${a}`)}</Badge>)}</div>}
        </li>
      ))}</ul>
    </div>
  );
}

export function UserView() {
  const { id } = useParams();
  const { t } = useI18n();
  const { can } = useAuth();
  const nav = useNavigate();
  const run = useAction();
  const errText = useErrorText();
  const { confirm, toast } = useUi();
  const [u, setU] = useState<any>(null);
  const [pwOpen, setPwOpen] = useState(false);
  const [pw, setPw] = useState('');
  const [holding, setHolding] = useState<any[] | null>(null);
  const load = useCallback(() => get(`/users/${id}`).then(setU), [id]);
  useEffect(() => { load(); }, [load]);
  if (!u) return <Loading />;
  const toggle = async () => {
    const disabling = u.status === 'active';
    if (!(await confirm({ title: disabling ? t('users.disable_q') : t('users.activate_q'), tone: disabling ? 'danger' : 'primary' }))) return;
    const r = await run(() => post(`/users/${id}/${disabling ? 'disable' : 'activate'}`));
    if (r) { if (disabling) toast(t('users.sessions_ended', { n: r.ended })); load(); }
  };
  const remove = async () => {
    if (!(await confirm({ title: t('users.delete_q') }))) return;
    try { await del(`/users/${id}`); nav('/admin/users'); }
    catch (e) { if (e instanceof ApiError && e.code === 'user_has_history') setHolding(e.params.holding); else toast(errText(e), 'red'); }
  };
  return (
    <>
      <PageHeader title={u.full_name} back="/admin/users" subtitle={<span className="flex flex-wrap items-center gap-2"><span dir="ltr">{u.username} · {u.email}</span><Badge tone={USER_STATUS[u.status]}>{t(`users.status.${u.status}`)}</Badge>{u.self && <Badge tone="blue">{t('users.your_account')}</Badge>}</span>}
        actions={can('users.update') && <Link to={`/admin/users/${id}/edit`}><Button icon={<Pencil className="size-4" />}>{t('users.edit_details')}</Button></Link>} />
      {u.last_manager && <div className="mb-4"><Alert tone="amber">{t('users.last_manager')}</Alert></div>}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title={t('users.role_status')}><Details cols={1} rows={[[t('users.role'), u.role_name], [t('users.status'), t(`users.status.${u.status}`)], [t('users.perms_granted'), fmtNum(u.perms.length), true], [t('users.open_sessions'), fmtNum(u.open_sessions), true]]} /></Card>
        <Card title={t('users.activity')}><Details cols={1} rows={[[t('users.last_login'), u.last_login_at ? fmtDateTime(u.last_login_at) : t('users.never'), true], [t('users.created'), fmtDateTime(u.created_at)], [t('users.last_changed'), fmtDateTime(u.updated_at)]]} /></Card>
        <Card title={t('users.password')}>{can('users.update') && <Button icon={<KeyRound className="size-4" />} onClick={() => setPwOpen(true)}>{t('users.set_password')}</Button>}</Card>
      </div>
      <Card title={t('users.what_can_do')} className="mt-4"><PermissionTree perms={u.perms} /></Card>
      <Card title={t('users.sensitive')} className="mt-4">
        {holding && <div className="mb-3"><Alert tone="amber" title={t('users.holding')}>{holding.map((h) => <div key={h.k}>{t(`users.hold.${h.k}`)}: {h.n}</div>)}</Alert></div>}
        {!u.self && <div className="flex flex-wrap gap-2">
          {(u.status === 'active' ? can('users.deactivate') : can('users.activate')) && <Button variant={u.status === 'active' ? 'warn' : 'primary'} onClick={toggle}>{u.status === 'active' ? t('users.disable') : t('users.activate')}</Button>}
          {can('users.delete') && (holding ? can('users.deactivate') && u.status === 'active' && <Button variant="warn" onClick={toggle}>{t('users.disable_instead')}</Button>
            : <Button variant="danger" icon={<Trash2 className="size-4" />} onClick={remove}>{t('users.delete')}</Button>)}
        </div>}
      </Card>
      <Modal open={pwOpen} onClose={() => setPwOpen(false)} title={t('users.set_password')} footer={<><Button onClick={() => setPwOpen(false)}>{t('common.cancel')}</Button>
        <Button variant="primary" disabled={pw.length < 10} onClick={async () => { const r = await run(() => post(`/users/${id}/password`, { password: pw })); if (r) { toast(t('users.password_set', { n: r.ended })); setPwOpen(false); setPw(''); } }}>{t('users.set_the_password')}</Button></>}>
        <Alert tone="amber">{t('users.set_password_warning')}</Alert>
        <Field label={t('users.new_password')} hint={t('users.password_hint')} className="mt-3"><input className="input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
      </Modal>
    </>
  );
}

// ======================================================================== roles
export function RolesList() {
  const { t } = useI18n();
  const { can } = useAuth();
  const nav = useNavigate();
  const run = useAction();
  const { confirm } = useUi();
  const [d, setD] = useState<any>(null);
  const [search, setSearch] = useState('');
  const load = useCallback(() => get('/roles', { search }).then(setD), [search]);
  useEffect(() => { const h = setTimeout(load, 250); return () => clearTimeout(h); }, [load]);
  if (!can('roles.view')) return <Alert tone="amber">{t('table.no_permission')}</Alert>;
  if (!d) return <Loading />;
  const act = async (r: any, kind: 'disable' | 'activate' | 'delete') => {
    if (!(await confirm({ title: t(`roles.${kind}_q`), tone: kind === 'activate' ? 'primary' : 'danger' }))) return;
    if (await run(() => (kind === 'delete' ? del(`/roles/${r.id}`) : post(`/roles/${r.id}/${kind}`)), t('common.saved'))) load();
  };
  return (
    <>
      <PageHeader title={t('roles.title')} actions={<><Button size="sm" onClick={load}>{t('common.refresh')}</Button>{can('roles.create') && <Link to="/admin/roles/new"><Button variant="primary" icon={<Plus className="size-4" />}>{t('roles.new')}</Button></Link>}</>} />
      <StatGrid>
        <StatCard label={t('roles.s.roles')} value={fmtNum(d.stats.roles)} /><StatCard label={t('roles.s.active')} value={fmtNum(d.stats.active)} tone="green" />
        <StatCard label={t('roles.s.users')} value={fmtNum(d.stats.users)} /><StatCard label={t('roles.s.perms')} value={fmtNum(d.stats.perms)} />
      </StatGrid>
      <div className="mb-3"><input className="input max-w-xs" placeholder={t('roles.search')} value={search} onChange={(e) => setSearch(e.target.value)} /></div>
      <Card pad={false}>
        <table className="w-full text-sm"><thead className="bg-zinc-50 text-xs text-zinc-500 dark:bg-zinc-900"><tr>{['roles.role', 'roles.status', 'roles.users', 'roles.perms', 'roles.created', 'common.actions'].map((k) => <th key={k} className="px-3 py-2.5 text-start font-medium">{t(k)}</th>)}</tr></thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">{d.rows.map((r: any) => (
            <tr key={r.id} className="cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50" onClick={(e) => !(e.target as HTMLElement).closest('button') && nav(`/admin/roles/${r.id}`)}>
              <td className="px-3 py-2.5"><div className="font-medium">{r.name}</div><div className="text-xs text-zinc-500">{r.description}</div></td>
              <td className="px-3 py-2.5"><Badge tone={r.is_active ? 'green' : 'grey'}>{r.is_active ? t('common.active') : t('common.disabled')}</Badge></td>
              <td className="px-3 py-2.5 num">{r.users}</td><td className="px-3 py-2.5 num">{r.perms} / {d.total}</td><td className="px-3 py-2.5 num text-xs">{fmtDateTime(r.created_at)}</td>
              <td className="px-3 py-2.5"><div className="flex">
                <IconButton title={t('roles.view')} onClick={() => nav(`/admin/roles/${r.id}`)}><Eye /></IconButton>
                {(can('roles.update') || can('permissions.update')) && <IconButton title={t('common.edit')} onClick={() => nav(`/admin/roles/${r.id}/edit`)}><Pencil /></IconButton>}
                {(r.is_active ? can('roles.deactivate') : can('roles.activate')) && <IconButton title={r.is_active ? t('common.disable') : t('common.activate')} onClick={() => act(r, r.is_active ? 'disable' : 'activate')}>{r.is_active ? <PowerOff /> : <Power />}</IconButton>}
                {can('roles.delete') && <IconButton title={t('roles.delete')} tone="red" onClick={() => act(r, 'delete')}><Trash2 /></IconButton>}</div></td>
            </tr>
          ))}</tbody></table>
      </Card>
      <p className="mt-2 text-xs text-zinc-500">{t('roles.hint')}</p>
    </>
  );
}

export function RoleView() {
  const { id } = useParams();
  const { t } = useI18n();
  const { can } = useAuth();
  const nav = useNavigate();
  const run = useAction();
  const { confirm } = useUi();
  const [r, setR] = useState<any>(null);
  const load = useCallback(() => get(`/roles/${id}`).then(setR), [id]);
  useEffect(() => { load(); }, [load]);
  if (!r) return <Loading />;
  const act = async (kind: 'disable' | 'activate' | 'delete') => {
    if (!(await confirm({ title: t(`roles.${kind}_q`), tone: kind === 'activate' ? 'primary' : 'danger' }))) return;
    if (await run(() => (kind === 'delete' ? del(`/roles/${id}`) : post(`/roles/${id}/${kind}`)), t('common.saved'))) { if (kind === 'delete') nav('/admin/roles'); else load(); }
  };
  return (
    <>
      <PageHeader title={r.name} subtitle={r.description} back="/admin/roles" actions={(can('roles.update') || can('permissions.update')) && <Link to={`/admin/roles/${id}/edit`}><Button icon={<Pencil className="size-4" />}>{t('common.edit')}</Button></Link>} />
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <StatCard label={t('roles.status')} value={r.is_active ? t('common.active') : t('common.disabled')} tone={r.is_active ? 'green' : 'grey'} />
        <StatCard label={t('roles.users_on')} value={fmtNum(r.users)} /><StatCard label={t('roles.perm_count')} value={`${r.perms.length} / ${r.total}`} /><StatCard label={t('roles.created')} value={fmtDateTime(r.created_at)} />
      </div>
      <Card title={t('roles.holds')} subtitle={t('roles.count_of', { count: r.perms.length, total: r.total })}>
        {r.perms.length ? <PermissionTree perms={r.perms} /> : <div className="text-center"><p className="text-sm text-zinc-500">{t('roles.no_perms')}</p>{can('permissions.update') && <Link to={`/admin/roles/${id}/edit`}><Button className="mt-2" variant="primary">{t('roles.grant')}</Button></Link>}</div>}
      </Card>
      <Card title={t('users.sensitive')} className="mt-4"><div className="flex gap-2">
        {(r.is_active ? can('roles.deactivate') : can('roles.activate')) && <Button variant="warn" onClick={() => act(r.is_active ? 'disable' : 'activate')}>{r.is_active ? t('common.disable') : t('common.activate')}</Button>}
        {can('roles.delete') && <Button variant="danger" icon={<Trash2 className="size-4" />} onClick={() => act('delete')}>{t('roles.delete')}</Button>}
      </div></Card>
    </>
  );
}

// Role edit: name & description, and the permission matrix — two cards with their own save buttons.
export function RoleEdit() {
  const { id } = useParams();
  const { t } = useI18n();
  const { can } = useAuth();
  const nav = useNavigate();
  const run = useAction();
  const { confirm, toast } = useUi();
  const form = useForm<Record<string, any>>({ name: '', description: '' });
  const [role, setRole] = useState<any>(id ? null : {});
  const [catalog, setCatalog] = useState<{ matrix: Record<string, Record<string, string[]>>; admin: string[] } | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [q, setQ] = useState('');
  const [created, setCreated] = useState<number | null>(null);
  const load = useCallback(async () => {
    if (!id) return;
    const r = await get(`/roles/${id}`);
    setRole(r); setSel(new Set(r.perms)); form.reset({ name: r.name, description: r.description ?? '' });
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); if (can('permissions.view', 'roles.view')) get('/roles/catalog').then(setCatalog); }, [load, can]);
  const saved = useMemo(() => new Set<string>(role?.perms ?? []), [role]);
  if (!role) return <Loading />;
  if (created) return (
    <Card><div className="py-6 text-center"><CheckCircle2 className="mx-auto size-10 text-emerald-500" /><h2 className="mt-2 font-semibold">{t('roles.created_msg')}</h2><p className="mt-1 text-sm text-amber-700">{t('roles.created_warning')}</p>
      <div className="mt-4 flex justify-center gap-2"><Link to={`/admin/roles/${created}/edit`}><Button variant="primary">{t('roles.grant_now')}</Button></Link><Link to={`/admin/roles/${created}`}><Button>{t('roles.view')}</Button></Link><Button onClick={() => { setCreated(null); form.reset({ name: '', description: '' }); }}>{t('roles.create_another')}</Button></div></div></Card>
  );
  const protectedSet = new Set<string>(role.protected ?? []);
  const added = [...sel].filter((p) => !saved.has(p)).length;
  const removed = [...saved].filter((p) => !sel.has(p)).length;
  const total = catalog ? Object.values(catalog.matrix).reduce((s, mods) => s + Object.values(mods).reduce((x, a) => x + a.length, 0), 0) : 0;
  const setMany = (perms: string[], on: boolean) => { const n = new Set(sel); for (const p of perms) { if (on) n.add(p); else if (!protectedSet.has(p)) n.delete(p); } setSel(n); };
  const savePerms = async () => {
    if (sel.size === 0 && !(await confirm({ title: t('roles.empty_warning'), tone: 'warn' }))) return;
    const r = await run(() => put(`/roles/${id}/permissions`, { perms: [...sel] }));
    if (r) { toast(t('roles.saved_perms', { added: r.added, removed: r.removed })); load(); }
  };
  const ql = q.trim().toLowerCase();

  return (
    <>
      <PageHeader title={id ? t('roles.edit_title', { name: role.name }) : t('roles.new')} back={id ? `/admin/roles/${id}` : '/admin/roles'} />
      {(!id || can('roles.update')) && (
        <form className="mb-4" onSubmit={async (e) => {
          e.preventDefault();
          const r = await form.submit(() => (id ? patch(`/roles/${id}`, form.changes) : post('/roles', form.values)));
          if (r) { if (id) { toast(t('common.saved')); load(); } else setCreated(r.id); }
        }}>
          <Card title={t('roles.name_desc')}><Grid>
            <TextInput form={form} name="name" label={t('roles.name')} required hint={t('roles.name_hint')} /><TextArea form={form} name="description" label={t('roles.description')} rows={2} />
          </Grid><div className="mt-3"><Button type="submit" variant="primary" loading={form.busy} disabled={!!id && !form.changed.length}>{id ? t('roles.save_name') : t('roles.create')}</Button></div></Card>
        </form>
      )}
      {id && (can('permissions.update') ? catalog && (
        <Card title={t('roles.matrix')} subtitle={<span className="num">{t('roles.selected_of', { count: sel.size, total })}{(added || removed) ? ` · ${t('roles.unsaved', { added, removed })}` : ''}</span>}
          actions={<><Button size="sm" onClick={() => setSel(new Set(saved))} disabled={!added && !removed}>{t('roles.restore')}</Button><Button size="sm" variant="primary" onClick={savePerms} disabled={!added && !removed}>{t('roles.save_perms')}</Button></>}>
          <div className="mb-3 flex flex-wrap gap-2"><input className="input max-w-sm" placeholder={t('roles.search_matrix')} value={q} onChange={(e) => setQ(e.target.value)} />
            <Button size="sm" onClick={() => setOpen(Object.fromEntries(Object.values(catalog.matrix).flatMap((m) => Object.keys(m)).map((m) => [m, true])))}>{t('roles.expand_all')}</Button>
            <Button size="sm" onClick={() => setOpen({})}>{t('roles.collapse_all')}</Button></div>
          <div className="space-y-4">{Object.entries(catalog.matrix).map(([group, mods]) => {
            const visible = Object.entries(mods).filter(([m, acts]) => !ql || t(`perm.m.${m}`).toLowerCase().includes(ql) || m.includes(ql) || acts.some((a) => `${m}.${a}`.includes(ql)));
            if (!visible.length) return null;
            const groupPerms = Object.entries(mods).flatMap(([m, acts]) => acts.map((a) => `${m}.${a}`));
            return (
              <div key={group}>
                <div className="mb-1 flex items-center gap-2"><h3 className="text-sm font-semibold">{t(`perm.g.${group}`)}</h3>
                  <button type="button" className="text-xs text-brand hover:underline" onClick={() => setMany(groupPerms, true)}>{t('roles.select_group')}</button>
                  <button type="button" className="text-xs text-zinc-500 hover:underline" onClick={() => setMany(groupPerms, false)}>{t('roles.clear_group')}</button></div>
                <div className="space-y-1">{visible.map(([m, acts]) => {
                  const keys = acts.map((a) => `${m}.${a}`);
                  const on = keys.filter((k) => sel.has(k)).length;
                  const isOpen = open[m] || !!ql;
                  return (
                    <div key={m} className="rounded-lg border border-zinc-200 dark:border-zinc-800">
                      <button type="button" onClick={() => setOpen({ ...open, [m]: !open[m] })} className="flex w-full items-center gap-2 px-3 py-2 text-sm">
                        {isOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}{t(`perm.m.${m}`)}<span className="text-xs text-zinc-400" dir="ltr">{m}</span>
                        <span className={cx('ms-auto text-xs num', on ? 'text-brand' : 'text-zinc-400')}>{on}/{keys.length}</span>
                      </button>
                      {isOpen && (
                        <div className="border-t border-zinc-100 px-3 py-2 dark:border-zinc-800">
                          <div className="mb-2 flex gap-3 text-xs"><button type="button" className="text-brand hover:underline" onClick={() => setMany(keys, true)}>{t('roles.select_all')}</button><button type="button" className="text-zinc-500 hover:underline" onClick={() => setMany(keys, false)}>{t('roles.clear_all')}</button></div>
                          <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-4">{keys.map((k) => {
                            const prot = protectedSet.has(k);
                            const admin = catalog.admin.includes(k);
                            return (
                              <div key={k} className="flex items-center gap-1.5">
                                <Checkbox checked={sel.has(k)} disabled={prot} onChange={(v) => setMany([k], v)} label={t(`perm.a.${k.split('.')[1]}`)} />
                                {admin && <Badge tone="blue">{t('roles.administrative')}</Badge>}
                                {prot && <span title={t('roles.protected_hint')}><Badge tone="amber"><Lock className="size-3" />{t('roles.protected')}</Badge></span>}
                              </div>
                            );
                          })}</div>
                        </div>
                      )}
                    </div>
                  );
                })}</div>
              </div>
            );
          })}</div>
        </Card>
      ) : <Alert tone="blue">{t('roles.cannot_edit_perms')}</Alert>)}
    </>
  );
}

// ======================================================================== active sessions
export function SessionsList() {
  const { t } = useI18n();
  const { can, refresh } = useAuth();
  const run = useAction();
  const { confirm } = useUi();
  const list = useList('/sessions');
  const endOne = async (s: any) => {
    if (!(await confirm({ title: s.current ? t('sessions.end_mine_q') : t('sessions.end_q', { name: s.full_name ?? '' }) }))) return;
    const r = await run(() => del(`/sessions/${s.id}`), t('sessions.ended'));
    if (r?.self) await refresh(); else if (r) list.reload();
  };
  const endAll = async (s: any) => {
    if (!(await confirm({ title: t('sessions.end_all_q', { name: s.full_name ?? '' }) }))) return;
    const r = await run(() => post(`/sessions/user/${s.user_id}/end-all`));
    if (r) { if (r.self) await refresh(); else { run(async () => r, t('users.sessions_ended', { n: r.ended })); list.reload(); } }
  };
  const columns: Column<any>[] = [
    { key: 'user', header: t('sessions.user'), render: (r) => <div><div className="font-medium">{r.full_name ?? t('sessions.deleted_user')}</div><div className="text-xs text-zinc-500">{r.role_name}</div>{r.current && <Badge tone="blue">{t('sessions.yours')}</Badge>}</div> },
    { key: 'status', header: t('sessions.status'), sort: 'status', render: (r) => <Badge tone={SESSION_STATUS[r.status]}>{t(`sessions.status.${r.status}`)}</Badge> },
    { key: 'ip', header: t('sessions.ip'), render: (r) => <span className="num">{r.ip}</span> },
    { key: 'device', header: t('sessions.device'), render: (r) => <span className="text-xs">{device(r.user_agent)}</span> },
    { key: 'started', header: t('sessions.started'), sort: 'started', render: (r) => <span className="num text-xs">{fmtDateTime(r.created_at)}</span> },
    { key: 'last', header: t('sessions.last_activity'), sort: 'last_activity', render: (r) => <span className="num text-xs">{fmtDateTime(r.last_activity_at)}</span> },
    { key: 'expires', header: t('sessions.expires'), sort: 'expires', render: (r) => <span className="num text-xs">{fmtDateTime(r.expires_at)}</span> },
    ...(can('sessions.delete') ? [{ key: 'actions', header: t('common.actions'), render: (r: any) => <div className="flex">
      {r.status === 'active' && <IconButton title={r.current ? t('sessions.end_mine') : t('sessions.end')} tone="red" onClick={() => endOne(r)}><LogOut /></IconButton>}
      {r.user_id && <IconButton title={t('sessions.end_everywhere')} tone="amber" onClick={() => endAll(r)}><ShieldOff /></IconButton>}</div> }] : []),
  ];
  return (
    <>
      <PageHeader title={t('sessions.title')} />
      <FilterBar list={list} placeholder={t('sessions.search_hint')}>
        <FilterSelect list={list} name="status" label={t('sessions.status')} options={Object.keys(SESSION_STATUS).map((v) => ({ value: v, label: t(`sessions.status.${v}`) }))} />
        <FilterDate list={list} name="from" label={t('common.from')} /><FilterDate list={list} name="to" label={t('common.to')} />
      </FilterBar>
      <DataTable list={list} columns={columns} />
    </>
  );
}

// ======================================================================== blocked IPs
export function BlockedIps() {
  const { t } = useI18n();
  const { can } = useAuth();
  const run = useAction();
  const { confirm } = useUi();
  const list = useList('/blocked-ips');
  const [adding, setAdding] = useState(false);
  const form = useForm<Record<string, any>>({ ip: '', reason: '', expires_at: '' });
  const columns: Column<any>[] = [
    { key: 'ip', header: t('ips.ip'), render: (r) => <span className="num font-medium">{r.ip}</span> },
    { key: 'reason', header: t('ips.reason'), render: (r) => <span className="text-xs">{r.reason}</span> },
    { key: 'attempts', header: t('ips.attempts'), render: (r) => <span className="num">{r.failed_attempts}</span> },
    { key: 'status', header: t('ips.status'), render: (r) => <Badge tone={r.live ? 'red' : 'grey'}>{r.live ? t('ips.blocked') : t('ips.lifted')}</Badge> },
    { key: 'until', header: t('ips.until'), render: (r) => (r.expires_at ? <span className="num text-xs">{fmtDateTime(r.expires_at)}</span> : <Badge tone="red">{t('ips.permanent')}</Badge>) },
    { key: 'by', header: t('ips.by'), render: (r) => r.blocked_by_name ?? '' },
    { key: 'on', header: t('ips.on'), sort: 'created', render: (r) => <span className="num text-xs">{fmtDateTime(r.created_at)}</span> },
    { key: 'actions', header: t('common.actions'), render: (r) => <div className="flex">
      {r.live && can('blocked_ips.update') && <IconButton title={t('ips.lift')} tone="green" onClick={async () => { if (!(await confirm({ title: t('ips.lift_q'), tone: 'primary' }))) return; if (await run(() => post(`/blocked-ips/${r.id}/lift`), t('common.saved'))) list.reload(); }}><Unlock /></IconButton>}
      {can('blocked_ips.delete') && <IconButton title={t('ips.delete')} tone="red" onClick={async () => { if (!(await confirm({ title: t('ips.delete_q'), body: t('ips.delete_warning') }))) return; if (await run(() => del(`/blocked-ips/${r.id}`), t('common.deleted'))) list.reload(); }}><Trash2 /></IconButton>}</div> },
  ];
  return (
    <>
      <PageHeader title={t('ips.title')} subtitle={t('ips.subtitle')} actions={can('blocked_ips.create') && <Button variant={adding ? 'secondary' : 'primary'} icon={!adding && <Ban className="size-4" />} onClick={() => setAdding(!adding)}>{adding ? t('common.cancel') : t('ips.block')}</Button>} />
      {adding && (
        <form className="mb-4" onSubmit={async (e) => { e.preventDefault(); if (await form.submit(() => post('/blocked-ips', form.values))) { run(async () => true, t('ips.blocked_msg')); form.reset({ ip: '', reason: '', expires_at: '' }); setAdding(false); list.reload(); } }}>
          <Card title={t('ips.block_new')}><Grid cols={3}>
            <TextInput form={form} name="ip" label={t('ips.ip')} required dir="ltr" placeholder="203.0.113.24" /><TextInput form={form} name="reason" label={t('ips.reason_for')} required />
            <TextInput form={form} name="expires_at" label={t('ips.expires_on')} type="date" hint={t('ips.expires_hint')} />
          </Grid><Button type="submit" variant="danger" className="mt-3" loading={form.busy}>{t('ips.block_the')}</Button></Card>
        </form>
      )}
      <FilterBar list={list} placeholder={t('ips.search_hint')}>
        <FilterSelect list={list} name="status" label={t('ips.status')} options={[{ value: 'blocked', label: t('ips.blocked_now') }, { value: 'lifted', label: t('ips.block_lifted') }]} />
        <FilterDate list={list} name="from" label={t('common.from')} /><FilterDate list={list} name="to" label={t('common.to')} />
      </FilterBar>
      <DataTable list={list} columns={columns} />
    </>
  );
}

// ======================================================================== profile
export function Profile() {
  const { t, setLang, langs } = useI18n();
  const { refresh, me } = useAuth();
  const run = useAction();
  const { confirm, toast } = useUi();
  const [p, setP] = useState<any>(null);
  const [sessions, setSessions] = useState<any[]>([]);
  const [attempts, setAttempts] = useState<any[]>([]);
  const [more, setMore] = useState(false);
  const form = useForm<Record<string, any>>({ full_name: '', email: '', locale: '' });
  const pw = useForm<Record<string, any>>({ current: '', password: '', confirm: '' });
  const load = useCallback(async () => {
    const [pp, ss, aa] = await Promise.all([get('/profile'), get('/profile/sessions'), get('/profile/attempts', { limit: more ? 100 : 20 })]);
    setP(pp); setSessions(ss); setAttempts(aa); form.reset({ full_name: pp.full_name, email: pp.email, locale: pp.locale ?? '' });
  }, [more]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);
  if (!p) return <Loading />;
  return (
    <>
      <PageHeader title={t('profile.title')} actions={<Button size="sm" onClick={load}>{t('common.refresh')}</Button>} />
      <Card className="mb-4"><div className="flex flex-wrap items-center gap-4">
        <span className="flex size-14 items-center justify-center rounded-full bg-brand text-lg font-semibold text-white">{p.full_name.slice(0, 2)}</span>
        <div><div className="text-lg font-semibold">{p.full_name}</div><div className="text-sm text-zinc-500" dir="ltr">{p.username}</div>
          <div className="mt-1 flex gap-2"><Badge tone="blue">{p.role}</Badge><Badge tone={USER_STATUS[p.status]}>{t(`users.status.${p.status}`)}</Badge></div></div>
        <div className="ms-auto text-sm"><div className="text-zinc-500">{t('profile.last_success')}</div><div className="num">{fmtDateTime(p.last_login_at)}</div><div className="mt-1 max-w-xs text-xs text-amber-700">{t('profile.not_you')}</div></div>
      </div></Card>
      <Card title={t('profile.readonly')} className="mb-4"><Details cols={3} rows={[[t('users.username'), p.username], [t('users.role'), p.role], [t('users.status'), t(`users.status.${p.status}`)], [t('users.created'), fmtDateTime(p.created_at)], [t('users.last_changed'), fmtDateTime(p.updated_at)]]} /></Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <form onSubmit={async (e) => { e.preventDefault(); if (await form.submit(() => patch('/profile', form.changes))) { toast(t('profile.saved')); if (form.changes.locale !== undefined) setLang((form.values.locale || me?.org_language || 'ar') as any); await refresh(); load(); } }}>
          <Card title={t('profile.my_details')}><div className="space-y-3">
            <TextInput form={form} name="full_name" label={t('users.full_name')} required /><TextInput form={form} name="email" label={t('users.email')} type="email" required dir="ltr" />
            <SelectInput form={form} name="locale" label={t('profile.language')} empty={t('profile.org_language')} options={langs.map((l) => ({ value: l.code, label: l.name }))} />
            <Button type="submit" variant="primary" disabled={!form.changed.length} loading={form.busy}>{t('common.save_changes')}</Button>
          </div></Card>
        </form>
        <form onSubmit={async (e) => { e.preventDefault(); const r = await pw.submit(() => post('/profile/password', pw.values)); if (r) { toast(t('profile.password_changed', { n: r.ended })); pw.reset({ current: '', password: '', confirm: '' }); } }}>
          <Card title={t('profile.change_password')}><div className="space-y-3">
            <TextInput form={pw} name="current" label={t('profile.current_password')} type="password" required />
            <TextInput form={pw} name="password" label={t('profile.new_password')} type="password" required hint={t('users.password_hint')} />
            <TextInput form={pw} name="confirm" label={t('profile.repeat_password')} type="password" required />
            <Button type="submit" variant="primary" loading={pw.busy}>{t('profile.change_password')}</Button>
          </div></Card>
        </form>
      </div>
      <Card title={t('profile.my_devices')} className="mt-4" pad={false}>
        <table className="w-full text-sm"><thead className="bg-zinc-50 text-xs text-zinc-500 dark:bg-zinc-900"><tr>{['sessions.status', 'sessions.ip', 'sessions.device', 'sessions.started', 'sessions.last_activity', 'sessions.expires', 'common.actions'].map((k) => <th key={k} className="px-3 py-2 text-start">{t(k)}</th>)}</tr></thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">{sessions.map((s) => (
            <tr key={s.id}><td className="px-3 py-2"><Badge tone={SESSION_STATUS[s.status]}>{t(`sessions.status.${s.status}`)}</Badge> {s.current && <Badge tone="blue">{t('profile.this_device')}</Badge>}</td>
              <td className="px-3 py-2 num">{s.ip}</td><td className="px-3 py-2 text-xs">{device(s.user_agent)}</td><td className="px-3 py-2 num text-xs">{fmtDateTime(s.created_at)}</td>
              <td className="px-3 py-2 num text-xs">{fmtDateTime(s.last_activity_at)}</td><td className="px-3 py-2 num text-xs">{fmtDateTime(s.expires_at)}</td>
              <td className="px-3 py-2">{s.status === 'active' ? <Button size="sm" variant="ghost" className="text-red-600" onClick={async () => {
                if (!(await confirm({ title: t('profile.end_q') }))) return;
                const r = await run(() => del(`/profile/sessions/${s.id}`), t('sessions.ended'));
                if (r?.self) await refresh(); else if (r) load();
              }}>{s.current ? t('profile.end_current') : t('sessions.end')}</Button> : '—'}</td></tr>
          ))}</tbody></table>
      </Card>
      <Card title={t('profile.history')} className="mt-4" pad={false}>
        <table className="w-full text-sm"><thead className="bg-zinc-50 text-xs text-zinc-500 dark:bg-zinc-900"><tr>{['login.at', 'login.outcome', 'login.reason', 'sessions.ip', 'sessions.device'].map((k) => <th key={k} className="px-3 py-2 text-start">{t(k)}</th>)}</tr></thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">{attempts.map((a, i) => (
            <tr key={i}><td className="px-3 py-2 num text-xs">{fmtDateTime(a.created_at)}</td><td className="px-3 py-2"><Badge tone={a.success ? 'green' : 'red'}>{a.success ? t('login.success') : t('login.failed')}</Badge></td>
              <td className="px-3 py-2 font-mono text-xs" dir="ltr">{a.reason ?? ''}</td><td className="px-3 py-2 num">{a.ip}</td><td className="px-3 py-2 text-xs">{device(a.user_agent)}</td></tr>
          ))}</tbody></table>
        {!more && attempts.length >= 20 && <div className="p-2 text-center"><Button size="sm" variant="ghost" onClick={() => setMore(true)}>{t('profile.older')}</Button></div>}
      </Card>
    </>
  );
}
