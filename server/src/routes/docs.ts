import { Router, type Request } from 'express';
import { exec, one, q, tx } from '../db.js';
import { HttpError, clean, eq, fail, fieldError, langOf, list, listAll, sendExport, today, tr, where, type Query, type Spec } from '../http.js';
import { can } from '../auth.js';
import { audit } from '../audit.js';
import { claimScan } from '../scans.js';
import { logRenewal } from './fleet.js';

// Chapter 5: the expiry alerts screen (read-only) and the renewal log.
export const docsRouter = Router();

// ======================================================================== expiry alerts
// Every current document of the eleven types, as one list. `ref` is the record the "Open record" icon goes to.
const ORG = "(SELECT value FROM settings WHERE `key` = 'org.name')";
function alertsUnion(day: string) {
  return `
    SELECT d.doc_type kind, 'rider' owner_type, d.id record_id, d.rider_id ref_id, r.full_name owner,
      CASE WHEN d.doc_type = 'id' THEN r.national_id ELSE d.doc_number END number, d.issue_date, d.expiry_date
    FROM rider_documents d JOIN riders r ON r.id = d.rider_id WHERE d.is_current = 1 AND d.expiry_date IS NOT NULL
    UNION ALL
    SELECT 'operation_card', 'vehicle', oc.id, oc.id,
      (SELECT GROUP_CONCAT(v.plate ORDER BY v.plate SEPARATOR ' · ') FROM operation_card_vehicles x JOIN vehicles v ON v.id = x.vehicle_id WHERE x.card_id = oc.id AND x.is_current = 1),
      oc.number, oc.issue_date, oc.expiry_date
    FROM operation_cards oc WHERE oc.status <> 'cancelled'
    UNION ALL
    SELECT 'vehicle_registration', 'vehicle', g.id, g.id, v.plate, g.serial, g.issue_date, g.expiry_date
    FROM vehicle_registrations g JOIN vehicles v ON v.id = g.vehicle_id WHERE g.is_current = 1 AND g.expiry_date IS NOT NULL
    UNION ALL
    SELECT 'vehicle_insurance', 'vehicle', vi.id, vi.id, v.plate, COALESCE(vi.sub_policy, p.number), vi.start_date, vi.expiry_date
    FROM vehicle_insurance vi JOIN vehicles v ON v.id = vi.vehicle_id JOIN insurance_policies p ON p.id = vi.policy_id WHERE vi.is_current = 1 AND vi.status <> 'cancelled'
    UNION ALL
    SELECT 'insurance_policy', 'organization', p.id, p.id, ic.name_ar, p.number, p.issue_date, p.expiry_date
    FROM insurance_policies p JOIN insurance_companies ic ON ic.id = p.company_id WHERE p.status <> 'cancelled'
    UNION ALL
    SELECT 'oil_change', 'vehicle', s.id, s.vehicle_id, v.plate, NULL, s.last_change, DATE_ADD(s.last_change, INTERVAL s.interval_days DAY)
    FROM oil_schedules s JOIN vehicles v ON v.id = s.vehicle_id
    UNION ALL
    SELECT 'transport_license', 'organization', t.id, t.id, ${ORG}, t.number, t.issue_date, t.expiry_date FROM transport_licenses t`;
}
const ALERT_KINDS = ['id', 'license', 'health', 'driver_card', 'ajeer', 'operation_card', 'vehicle_registration', 'vehicle_insurance', 'insurance_policy', 'oil_change', 'transport_license'];
const windowOf = (q: Query) => ([7, 30, 60, 90].includes(Number(q.window)) ? Number(q.window) : 30);

function alertsSpec(day: string, win: number): Spec {
  const days = `DATEDIFF(a.expiry_date, '${day}')`;
  return {
    from: `FROM (${alertsUnion(day)}) a`,
    select: `a.*, CONCAT(a.kind, ':', a.record_id) _key, ${days} days_left, CASE WHEN ${days} < 0 THEN 'expired' WHEN ${days} <= ${win} THEN 'near' ELSE 'valid' END state`,
    search: ['a.owner', 'a.number'],
    filters: {
      kind: eq('a.kind'),
      owner_type: eq('a.owner_type'),
      status: (v) => ({ expired: `${days} < 0`, near: `${days} BETWEEN 0 AND ${win}`, valid: `${days} > ${win}` } as Record<string, string>)[v] ?? null,
      // choosing a window shows what expires within it, together with what has already expired
      window: () => `${days} <= ${win}`,
    },
    sorts: { kind: 'a.kind', owner: 'a.owner', issued: 'a.issue_date', expires: 'a.expiry_date', days: `${days}` },
    defaultSort: 'days',
  };
}

docsRouter.get('/alerts', can('alerts.view'), async (req, res) => {
  const query = req.query as Query;
  const win = windowOf(query);
  const spec = alertsSpec(await today(), win);
  const w = where(spec, query, ['status']); // the cards show the three statuses side by side
  const [stats] = await q(`SELECT COUNT(*) documents, COALESCE(SUM(state = 'expired'),0) expired, COALESCE(SUM(state = 'near'),0) near,
    COALESCE(SUM(state = 'valid'),0) valid FROM (SELECT ${spec.select} ${spec.from}${w.sql}) s`, w.params);
  res.json({ ...(await list(spec, query)), stats: { ...stats, window: win } });
});

docsRouter.get('/alerts/export', can('alerts.export'), async (req, res) => {
  const query = req.query as Query;
  const win = windowOf(query);
  const rows = await listAll(alertsSpec(await today(), win), query);
  const fill = (r: any) => (r.state === 'expired' ? 'red' : r.state === 'near' ? 'amber' : 'green');
  const count = (s: string) => rows.filter((r: any) => r.state === s).length;
  const lang = await langOf(req);
  await sendExport(req, res, {
    format: query.format === 'csv' ? 'csv' : 'xlsx', title: 'alerts.title', rows,
    summary: [['alerts.s.expired', count('expired')], ['alerts.s.near_title', count('near')], ['alerts.s.valid', count('valid')]],
    cols: [
      { key: 'kind', label: 'alerts.document', value: (r) => tr(lang, `alerts.kind.${r.kind}`) }, { key: 'owner_type', label: 'alerts.owner_type', value: (r) => tr(lang, `alerts.owner.${r.owner_type}`) },
      { key: 'owner', label: 'alerts.belongs_to' }, { key: 'number', label: 'alerts.number' }, { key: 'issue_date', label: 'alerts.issued' },
      { key: 'expiry_date', label: 'alerts.expires' }, { key: 'days_left', label: 'alerts.days_left', fill }, { key: 'state', label: 'alerts.status', fill, value: (r) => tr(lang, `alerts.state.${r.state}`) },
    ],
  });
});

// ======================================================================== renewal log
// The nine kinds that can be renewed. "replace": the old record is archived and a new current one is created;
// "in_place": the same record gets the new dates (an operation card may cover several vehicles).
type Kind = { table: string; owner: 'rider' | 'vehicle' | 'organization'; mode: 'replace' | 'in_place'; entity: string; numberCol: string | null; docType?: string };
const RIDER_DOC = (t: string): Kind => ({ table: 'rider_documents', owner: 'rider', mode: 'replace', entity: `rider_doc_${t}`, numberCol: t === 'id' ? null : 'doc_number', docType: t });
export const KINDS: Record<string, Kind> = {
  id: RIDER_DOC('id'), license: RIDER_DOC('license'), health: RIDER_DOC('health'), driver_card: RIDER_DOC('driver_card'), ajeer: RIDER_DOC('ajeer'),
  vehicle_registration: { table: 'vehicle_registrations', owner: 'vehicle', mode: 'replace', entity: 'vehicle_registration', numberCol: 'serial' },
  operation_card: { table: 'operation_cards', owner: 'vehicle', mode: 'in_place', entity: 'operation_card', numberCol: 'number' },
  vehicle_insurance: { table: 'vehicle_insurance', owner: 'vehicle', mode: 'in_place', entity: 'vehicle_insurance', numberCol: 'sub_policy' },
  transport_license: { table: 'transport_licenses', owner: 'organization', mode: 'in_place', entity: 'transport_license', numberCol: 'number' },
};

// The renewable documents of a kind, soonest to expire first; with id=… a single one.
async function kindDocs(kind: string, id?: number) {
  const day = await today();
  const k = KINDS[kind];
  const one_ = id ? ' AND x.id = ?' : '';
  const p = id ? [id] : [];
  const days = `DATEDIFF(x.expiry_date, '${day}')`;
  const sql: Record<string, string> = {
    rider_documents: `SELECT x.id, x.rider_id owner_id, r.full_name owner, CASE WHEN x.doc_type = 'id' THEN r.national_id ELSE x.doc_number END number, x.issue_date, x.expiry_date, ${days} days_left
      FROM rider_documents x JOIN riders r ON r.id = x.rider_id WHERE x.doc_type = '${k.docType}' AND x.is_current = 1${one_}`,
    vehicle_registrations: `SELECT x.id, x.vehicle_id owner_id, v.plate owner, x.serial number, x.issue_date, x.expiry_date, ${days} days_left
      FROM vehicle_registrations x JOIN vehicles v ON v.id = x.vehicle_id WHERE x.is_current = 1${one_}`,
    operation_cards: `SELECT x.id, NULL owner_id, COALESCE((SELECT GROUP_CONCAT(v.plate ORDER BY v.plate SEPARATOR ' · ') FROM operation_card_vehicles c JOIN vehicles v ON v.id = c.vehicle_id WHERE c.card_id = x.id AND c.is_current = 1), '') owner,
      x.number, x.issue_date, x.expiry_date, ${days} days_left FROM operation_cards x WHERE x.status <> 'cancelled'${one_}`,
    vehicle_insurance: `SELECT x.id, x.vehicle_id owner_id, v.plate owner, COALESCE(x.sub_policy, p.number) number, x.start_date issue_date, x.expiry_date, ${days} days_left
      FROM vehicle_insurance x JOIN vehicles v ON v.id = x.vehicle_id JOIN insurance_policies p ON p.id = x.policy_id WHERE x.status <> 'cancelled'${one_}`,
    transport_licenses: `SELECT x.id, NULL owner_id, ${ORG} owner, x.number, x.issue_date, x.expiry_date, ${days} days_left FROM transport_licenses x WHERE 1${one_}`,
  };
  return q<any>(`${sql[k.table]} ORDER BY x.expiry_date IS NULL, x.expiry_date LIMIT 2000`, p);
}

const renewalSpec: Spec = {
  from: 'FROM renewals rn LEFT JOIN users u ON u.id = rn.recorded_by',
  select: `rn.*, u.full_name recorded_by_name, DATEDIFF(rn.new_expiry, rn.previous_expiry) extended_days`,
  search: ['rn.owner_label', 'rn.previous_number', 'rn.new_number', 'rn.reference'],
  filters: {
    kind: eq('rn.doc_kind'), owner_type: eq('rn.owner_type'),
    from: (v) => ['rn.renewal_date >= ?', [v]], to: (v) => ['rn.renewal_date <= ?', [v]],
    // reached from another screen already filtered on one document: "kind:id"
    doc: (v) => { const [k, id] = v.split(':'); return ['rn.doc_kind = ? AND (rn.doc_id = ? OR rn.new_doc_id = ?)', [k, Number(id), Number(id)]]; },
    owner: (v) => ['rn.owner_label = ?', [v]],
  },
  sorts: { date: 'rn.renewal_date DESC, rn.id', kind: 'rn.doc_kind', owner: 'rn.owner_label', expiry: 'rn.new_expiry', cost: 'rn.cost' },
  defaultSort: '-date',
};

docsRouter.get('/renewals', can('renewals.view'), async (req, res) => {
  const day = await today();
  const month = day.slice(0, 7);
  // the cards show the whole log and do not follow the filters
  const [stats] = await q(`SELECT COUNT(*) total, COALESCE(SUM(cost),0) cost, COALESCE(SUM(DATE_FORMAT(renewal_date, '%Y-%m') = ?),0) month,
    COALESCE(SUM(CASE WHEN DATE_FORMAT(renewal_date, '%Y-%m') = ? THEN cost END),0) month_cost FROM renewals`, [month, month]);
  const kinds = await q('SELECT doc_kind kind, COUNT(*) n, COALESCE(SUM(cost),0) cost FROM renewals GROUP BY doc_kind ORDER BY n DESC');
  res.json({ ...(await list(renewalSpec, req.query as Query)), stats: { ...stats, kinds } });
});

docsRouter.get('/renewals/export', can('renewals.export'), async (req, res) => {
  const lang = await langOf(req);
  await sendExport(req, res, { format: 'csv', title: 'ren.title', rows: await listAll(renewalSpec, req.query as Query), cols: [
    { key: 'id', label: 'ren.identifier' }, { key: 'doc_kind', label: 'ren.kind', value: (r) => tr(lang, `alerts.kind.${r.doc_kind}`) }, { key: 'doc_id', label: 'ren.record_id' },
    { key: 'owner_type', label: 'ren.belongs_to', value: (r) => tr(lang, `alerts.owner.${r.owner_type}`) }, { key: 'owner_label', label: 'ren.owner' }, { key: 'previous_number', label: 'ren.previous_number' },
    { key: 'new_number', label: 'ren.new_number' }, { key: 'previous_expiry', label: 'ren.previous_expiry' }, { key: 'new_expiry', label: 'ren.new_expiry' },
    { key: 'extended_days', label: 'ren.extended_by' }, { key: 'operation', label: 'ren.operation', value: (r) => tr(lang, `ren.op.${r.operation}`) }, { key: 'renewal_date', label: 'ren.renewal_date' },
    { key: 'cost', label: 'ren.cost' }, { key: 'reference', label: 'ren.reference' }, { key: 'recorded_by_name', label: 'ren.recorded_by' }, { key: 'notes', label: 'common.notes' },
  ] });
});

docsRouter.get('/renewals/documents', can('renewals.create'), async (req, res) => {
  const kind = String(req.query.kind ?? '');
  if (!KINDS[kind]) fail(422, 'invalid');
  res.json(await kindDocs(kind));
});

docsRouter.get('/renewals/:id', can('renewals.view'), async (req, res) => {
  const r = await one<any>(`SELECT ${renewalSpec.select} ${renewalSpec.from} WHERE rn.id = ?`, [req.params.id]);
  if (!r) fail(404, 'not_found');
  const kind = r.doc_kind;
  // The document chain: every record this document has been, linked by the replace renewals.
  const ids = new Set<number>([r.doc_id, ...(r.new_doc_id ? [r.new_doc_id] : [])]);
  for (let i = 0; i < 50; i++) {
    const links = await q<any>('SELECT doc_id, new_doc_id FROM renewals WHERE doc_kind = ? AND (doc_id IN (?) OR new_doc_id IN (?))', [r.doc_kind, [...ids], [...ids]]);
    const before = ids.size;
    for (const l of links) { ids.add(l.doc_id); if (l.new_doc_id) ids.add(l.new_doc_id); }
    if (ids.size === before) break;
  }
  const chain = await q(`SELECT id, renewal_date, previous_expiry, new_expiry, operation, cost FROM renewals
    WHERE doc_kind = ? AND (doc_id IN (?) OR new_doc_id IN (?)) ORDER BY renewal_date, id`, [r.doc_kind, [...ids], [...ids]]);
  // the files belong to the document itself: the record that resulted from the renewal
  const current = KINDS[kind] ? (await kindDocs(kind, r.new_doc_id ?? r.doc_id))[0] ?? null : null;
  res.json({ ...r, kind, mode: KINDS[kind]?.mode, entity: KINDS[kind]?.entity, current, chain });
});

const renewalRules = {
  kind: { req: true, enum: Object.keys(KINDS) }, doc_id: { req: true, type: 'int' as const }, scan: { max: 40 },
  new_expiry: { req: true, type: 'date' as const }, renewal_date: { type: 'date' as const }, new_issue: { type: 'date' as const },
  new_number: { max: 100 }, operation: { enum: ['renewal', 'replacement', 'reissue', 'correction'] },
  cost: { type: 'num' as const, min: 0 }, reference: { max: 100 }, notes: { max: 500 },
};

async function renew(req: Request) {
  const v = clean(req.body, renewalRules);
  if (!v.scan) fieldError('scan', 'renewal_scan_required');
  const k = KINDS[v.kind];
  const doc = await one<any>(`SELECT * FROM ${k.table} WHERE id = ?`, [v.doc_id]);
  const listed = doc && (await kindDocs(v.kind, v.doc_id))[0];
  // renewed meanwhile (no longer current) or deleted
  if (!doc || !listed) fail(409, 'renewal_doc_gone');
  if (doc.expiry_date && v.new_expiry < doc.expiry_date) fieldError('new_expiry', 'renewal_shortens', { date: doc.expiry_date });
  const renewalDate = v.renewal_date ?? (await today());
  const issue = v.new_issue ?? renewalDate;
  const newNumber = k.numberCol ? v.new_number ?? null : null;

  return tx(async () => {
    let currentId = doc.id;
    let newDocId: number | null = null;
    if (k.mode === 'replace') {
      const { id: _id, created_at: _c, ...base } = doc;
      const copy: Record<string, any> = { ...base, expiry_date: v.new_expiry, issue_date: issue, status: 'valid', is_current: 1 };
      if (k.numberCol && newNumber) copy[k.numberCol] = newNumber;
      if (k.table === 'rider_documents') { copy.created_by = req.user!.id; copy.issue_date_hijri = null; copy.expiry_date_hijri = null; }
      await exec(`UPDATE ${k.table} SET is_current = 0, status = 'expired' WHERE id = ?`, [doc.id]);
      try {
        newDocId = (await exec(`INSERT INTO ${k.table} SET ?`, [copy])).insertId;
      } catch (e: any) {
        // the number of these documents is never repeated, and the old record keeps its number
        if (e?.code === 'ER_DUP_ENTRY') fieldError('new_number', 'renewal_number_needed');
        throw e;
      }
      currentId = newDocId;
    } else {
      const set: Record<string, any> = { expiry_date: v.new_expiry, status: 'valid' };
      if (k.table === 'vehicle_insurance') set.start_date = issue;
      else set.issue_date = issue;
      if (k.table === 'operation_cards') set.renew_date = renewalDate;
      if (k.numberCol && newNumber) set[k.numberCol] = newNumber;
      await exec(`UPDATE ${k.table} SET ? WHERE id = ?`, [set, doc.id]);
    }
    await claimScan(req, v.scan, k.entity, currentId);
    return logRenewal(req, {
      doc_kind: v.kind, doc_id: doc.id, new_doc_id: newDocId, owner_type: k.owner, owner_label: listed.owner || null,
      previous_number: listed.number ?? null, new_number: newNumber ?? listed.number ?? null, previous_expiry: doc.expiry_date ?? null,
      new_expiry: v.new_expiry, operation: v.operation ?? 'renewal', renewal_date: renewalDate, cost: v.cost ?? null,
      reference: v.reference ?? null, notes: v.notes ?? null,
    });
  });
}

docsRouter.post('/renewals', can('renewals.create'), async (req, res) => {
  try {
    res.json({ id: await renew(req) });
  } catch (e) {
    // refused attempts are recorded too
    if (e instanceof HttpError) await audit(req, { action: 'renewal.create', entity_type: req.body?.kind, entity_id: req.body?.doc_id, status: 'failed', severity: 'warning', details: e.code });
    throw e;
  }
});
