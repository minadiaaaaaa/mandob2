// The permission matrix from the guide (section 10.4): group → module → actions.
// A permission is "module.action". Labels live in the web translations.
export const MATRIX: Record<string, Record<string, string[]>> = {
  riders: {
    riders: ['view', 'create', 'update', 'delete', 'activate', 'deactivate', 'export', 'import', 'upload', 'download', 'print'],
    id_documents: ['view', 'create', 'update', 'delete', 'upload', 'download', 'renew', 'export'],
    driving_licenses: ['view', 'create', 'update', 'delete', 'upload', 'download', 'renew', 'export'],
    health_certs: ['view', 'create', 'update', 'delete', 'upload', 'download', 'renew', 'export'],
    driver_cards: ['view', 'create', 'update', 'delete', 'upload', 'download', 'renew', 'export', 'print'],
    ajeer_permits: ['view', 'create', 'update', 'delete', 'upload', 'download', 'renew', 'export'],
    leaves: ['view', 'create', 'update', 'delete', 'approve', 'cancel', 'print', 'export', 'settings', 'stamp'],
    documents: ['view', 'create', 'update', 'delete', 'export'],
    drivers: ['view', 'create', 'update', 'delete'],
    renewals: ['view', 'create', 'update', 'delete', 'export', 'print', 'upload', 'download'],
    applicants: ['view', 'create', 'update', 'delete', 'export', 'import', 'hire'],
    rider_portal: ['view_requests', 'review_requests', 'view_issues', 'manage_issues', 'manage_portal'],
    finance: ['view', 'import', 'manage'],
    absences: ['view', 'import', 'manage'],
    live_riders: ['view', 'manage'],
  },
  advances: {
    advances: ['view', 'create', 'update', 'delete', 'upload', 'download', 'export', 'import', 'approve', 'reject', 'disburse', 'cancel', 'print'],
    advance_installments: ['view', 'update', 'repay', 'waive', 'export'],
  },
  fleet: {
    vehicles: ['view', 'create', 'update', 'delete', 'activate', 'deactivate', 'export', 'import', 'upload', 'download'],
    transport_licenses: ['view', 'create', 'update', 'delete', 'upload', 'download', 'renew', 'export'],
    operation_cards: ['view', 'create', 'update', 'delete', 'upload', 'download', 'renew', 'export', 'print'],
    vehicle_registrations: ['view', 'create', 'update', 'delete', 'upload', 'download', 'renew', 'export'],
    vehicle_assignments: ['view', 'create', 'update', 'delete', 'export'],
    fuel_cards: ['view', 'create', 'update', 'delete', 'activate', 'deactivate', 'export'],
    insurance_companies: ['view', 'create', 'update', 'delete', 'activate', 'deactivate'],
    insurance_policies: ['view', 'create', 'update', 'delete', 'upload', 'download', 'renew', 'export'],
    vehicle_insurance: ['view', 'create', 'update', 'delete', 'upload', 'download', 'renew', 'export', 'print'],
    oil_changes: ['view', 'create', 'update', 'delete', 'export'],
  },
  performance: {
    performance: ['view', 'create', 'update', 'delete', 'export', 'import'],
    companies: ['view', 'create', 'update', 'delete', 'activate', 'deactivate'],
    contracts: ['view', 'create', 'update', 'delete', 'activate', 'deactivate'],
    sync: ['view', 'run', 'update', 'upload', 'manage_session'],
    ratings: ['view', 'create', 'update', 'delete', 'export', 'import'],
  },
  reports: {
    reports: ['view', 'export', 'print'],
    alerts: ['view', 'export', 'send'],
    dashboard: ['view', 'export'],
  },
  notifications: {
    notifications: ['view', 'create', 'delete', 'send', 'export'],
    notification_prefs: ['view', 'update'],
  },
  files: { attachments: ['view', 'upload', 'download', 'delete'] },
  email: {
    email_templates: ['view', 'create', 'update', 'delete', 'activate', 'deactivate'],
    smtp: ['view', 'update', 'activate', 'deactivate'],
    email_log: ['view', 'export'],
  },
  access: {
    users: ['view', 'create', 'update', 'delete', 'activate', 'deactivate', 'export'],
    roles: ['view', 'create', 'update', 'delete', 'activate', 'deactivate'],
    permissions: ['view', 'update'],
    sessions: ['view', 'delete'],
    blocked_ips: ['view', 'create', 'update', 'delete'],
  },
  lookups: { cities: ['view', 'create', 'update', 'delete', 'export', 'import'] },
  system: {
    organization: ['view', 'update', 'upload', 'download'],
    system_settings: ['view', 'update'],
    backups: ['view', 'create', 'delete', 'download', 'restore', 'verify', 'settings'],
    logs: ['view', 'export', 'delete'],
    audit_log: ['view', 'export'],
    login_log: ['view', 'export'],
    cron_jobs: ['view', 'run', 'export'],
    platform_settings: ['view', 'update', 'export'],
    secrets: ['view', 'update', 'create', 'delete'],
    languages: ['view', 'manage'],
  },
};

// The system must never lose these: at least one active role with an active user keeps each of them.
export const ADMIN_PERMS = ['users.update', 'roles.update', 'permissions.update'];

export const ALL_PERMS = Object.values(MATRIX).flatMap((mods) =>
  Object.entries(mods).flatMap(([m, acts]) => acts.map((a) => `${m}.${a}`)),
);

const pick = (groups: string[], keep: (module: string, action: string) => boolean) =>
  groups.flatMap((g) => Object.entries(MATRIX[g]).flatMap(([m, acts]) => acts.filter((a) => keep(m, a)).map((a) => `${m}.${a}`)));

const ACCESS_AND_SENSITIVE = new Set([
  'users', 'roles', 'permissions', 'sessions', 'blocked_ips', 'logs', 'audit_log', 'login_log', 'cron_jobs',
  'backups', 'system_settings', 'organization', 'smtp', 'email_log', 'email_templates', 'secrets', 'platform_settings', 'languages',
]);

// The five built-in roles as the guide describes their state at installation.
export const BUILTIN_ROLES: { name: string; description: string; perms: string[] }[] = [
  { name: 'Super Admin', description: 'Full permissions on the system without exception', perms: ALL_PERMS },
  {
    name: 'Fleet Manager',
    description: 'Manages riders, vehicles, documents and maintenance, without managing users or approving advances',
    perms: [
      ...pick(['riders', 'fleet', 'performance', 'reports', 'notifications', 'files', 'lookups'], (_m, a) => a !== 'delete' && a !== 'stamp'),
      ...pick(['email'], (m, a) => m === 'email_templates' && a !== 'delete'),
      ...['view', 'create', 'update', 'upload', 'download', 'export', 'import', 'print'].map((a) => `advances.${a}`),
      'advance_installments.view', 'advance_installments.repay',
      'organization.view', 'system_settings.view', 'platform_settings.view', 'languages.view',
    ],
  },
  {
    name: 'Documents Officer',
    description: 'Follows up rider and vehicle documents, renews them and uploads their attachments',
    perms: [
      ...pick(['riders', 'fleet'], (m, a) =>
        !['rider_portal', 'finance', 'absences', 'live_riders'].includes(m) &&
        ['view', 'create', 'update', 'upload', 'download', 'renew', 'export', 'print'].includes(a)),
      'attachments.view', 'attachments.upload', 'attachments.download',
      ...pick(['reports'], (_m, a) => a !== 'send'),
      'rider_portal.view_requests', 'rider_portal.review_requests',
    ],
  },
  {
    name: 'Data Entry',
    description: 'Enters daily performance and rider data without delete or export',
    perms: [
      ...pick(['riders', 'performance'], (m, a) =>
        !['finance', 'absences', 'sync', 'rider_portal'].includes(m) && ['view', 'create', 'update', 'import', 'upload'].includes(a)),
      'sync.view', 'sync.run',
      'advances.view', 'advances.create', 'advances.upload',
      'attachments.view', 'attachments.upload',
      'finance.view', 'finance.import', 'absences.view', 'absences.import',
    ],
  },
  {
    name: 'Viewer',
    description: 'Views and exports operational data and reports only, with no editing and no administrative access',
    perms: Object.values(MATRIX).flatMap((mods) =>
      Object.entries(mods).filter(([m]) => !ACCESS_AND_SENSITIVE.has(m))
        .flatMap(([m, acts]) => acts.filter((a) => ['view', 'export', 'print'].includes(a)).map((a) => `${m}.${a}`))),
  },
];
