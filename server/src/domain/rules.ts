// Business rules defined once, on the server. The API validates with them, the dashboard and the alerts count with
// them, and the screens read them from GET /meta/rules instead of keeping their own copies.
// Later phases add their rules here (branches, accident stages, oil change after 20 days, health-score weights…).
import { settingInt } from '../db.js';

// ---------- statuses ----------
export const RIDER_STATUSES = ['active', 'inactive', 'suspended', 'terminated'] as const;
export const VEHICLE_STATUSES = ['active', 'maintenance', 'retired'] as const;
export const USER_STATUSES = ['active', 'disabled', 'locked'] as const;
export type RiderStatus = (typeof RIDER_STATUSES)[number];
export type VehicleStatus = (typeof VEHICLE_STATUSES)[number];

// ---------- expiry alerts: how many days ahead each document counts as "expiring soon" ----------
// Each company sets its own number of days (System › Settings); these are the setting keys and their defaults.
export const EXPIRY_ALERTS = {
  id: { setting: 'id_document.expiry_alert_days', days: 60 },
  license: { setting: 'driving_license.expiry_alert_days', days: 30 },
  health: { setting: 'health_cert.expiry_alert_days', days: 30 },
  driver_card: { setting: 'driver_card.expiry_alert_days', days: 30 },
  ajeer: { setting: 'ajeer_permit.expiry_alert_days', days: 60 },
  operation_card: { setting: 'operation_card.expiry_alert_days', days: 30 },
  vehicle_registration: { setting: 'vehicle_registration.expiry_alert_days', days: 30 },
  transport_license: { setting: 'transport_license.expiry_alert_days', days: 60 },
  vehicle_insurance: { setting: 'vehicle_insurance.expiry_alert_days', days: 30 },
  insurance_policy: { setting: 'insurance_policy.expiry_alert_days', days: 45 },
} as const;
export type ExpiryKind = keyof typeof EXPIRY_ALERTS;

export const expiryDays = (kind: ExpiryKind) => settingInt(EXPIRY_ALERTS[kind].setting, EXPIRY_ALERTS[kind].days);
export async function expiryWindows(): Promise<Record<ExpiryKind, number>> {
  const out = {} as Record<ExpiryKind, number>;
  for (const kind of Object.keys(EXPIRY_ALERTS) as ExpiryKind[]) out[kind] = await expiryDays(kind);
  return out;
}

// What the screens need, in one answer.
export async function publicRules() {
  return {
    statuses: { rider: RIDER_STATUSES, vehicle: VEHICLE_STATUSES, user: USER_STATUSES },
    expiry_days: await expiryWindows(),
  };
}
