import type { ReactNode } from 'react';
import { Link, Route, Routes, useParams } from 'react-router-dom';
import { RequireAuth, useAuth } from './auth';
import { AdminLayout } from './layout';
import { useI18n } from './i18n';
import { Alert, Button } from './ui/kit';
import Login from './pages/Login';
import Setup from './pages/Setup';
import PublicSite from './pages/PublicSite';
import Dashboard from './pages/Dashboard';
import RidersList from './pages/riders/RidersList';
import RiderForm from './pages/riders/RiderForm';
import RiderView from './pages/riders/RiderView';
import RiderDocuments from './pages/riders/RiderDocuments';
import { DOC_MODULE, DOC_SLUG } from './pages/riders/shared';
import { RidersBulkEdit, RidersImport } from './pages/riders/RidersBulk';
import { ApplicantForm, ApplicantsImport, ApplicantsList, ApplicantView } from './pages/riders/Applicants';
import { VehicleForm, VehiclesImport, VehiclesList, VehicleView } from './pages/fleet/Vehicles';
import { CardForm, CardsImport, CardsList, CardView, LicenseForm, LicensesList, LicenseView, RegistrationForm, RegistrationsList, RegistrationView } from './pages/fleet/Cards';
import {
  AssignmentForm, AssignmentsList, AssignmentView, CoverForm, CoversBulk, CoversList, CoverView, FleetImport, FuelCardForm, FuelCardsBulk, FuelCardsList, FuelCardView,
  InsurerForm, InsurersList, InsurerView, OilBulk, OilChangeEdit, OilChangeView, OilHistory, OilRecord, OilSchedule, OilScheduleForm, OilScheduleView, PoliciesList, PolicyForm, PolicyView,
} from './pages/fleet/Fleet2';
import { CompaniesList, CompanyForm, CompanyView, ContractForm, ContractsList, ContractView } from './pages/performance/Companies';
import { BlockedIps, Profile, RoleEdit, RolesList, RoleView, SessionsList, UserForm, UsersList, UserView } from './pages/admin/Access';
import { AttachmentsIndex, AuditLog, LoginAttempts, Settings } from './pages/system/System';
import { AlertsList, RenewalForm, RenewalsList, RenewalView } from './pages/docs/Renewals';

// A screen opened by a direct link without its permission.
function Guard({ perm, children }: { perm: string[]; children: ReactNode }) {
  const { can } = useAuth();
  const { t } = useI18n();
  if (can(...perm)) return <>{children}</>;
  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      <Alert tone="amber" title={t('err.cannot_open')}>{t('err.cannot_open_text')}</Alert>
      <Link to="/admin"><Button className="mt-4">{t('err.back_to_dashboard')}</Button></Link>
    </div>
  );
}
const g = (perm: string | string[], el: ReactNode) => <Guard perm={Array.isArray(perm) ? perm : [perm]}>{el}</Guard>;

function NotFound() {
  const { t } = useI18n();
  return <div className="py-20 text-center"><h1 className="text-2xl font-semibold">404</h1><p className="mt-2 text-zinc-500">{t('err.not_found')}</p><Link to="/admin"><Button className="mt-4">{t('err.back_to_dashboard')}</Button></Link></div>;
}
// ponytail: the rider portal (chapter 12) is a later phase; its links land here meanwhile.
function RiderPortalSoon() {
  const { t } = useI18n();
  return <div className="flex min-h-screen items-center justify-center p-4"><Alert tone="blue" title={t('portal.soon_title')}>{t('portal.soon_text')} <Link className="text-brand underline" to="/">{t('login.back_to_site')}</Link></Alert></div>;
}
// /admin/riders/<rider id> is the profile; /admin/riders/driving-licenses etc. are the document screens.
function RiderOrDocs() {
  const { slug = '' } = useParams();
  const type = DOC_SLUG[slug];
  return type ? g(`${DOC_MODULE[type]}.view`, <RiderDocuments />) : g('riders.view', <RiderView />);
}

export default function App() {
  const { t } = useI18n();
  const imp = (base: string, back: string, title: string, perm: string, extra?: Record<string, string>) => g(perm, <FleetImport base={base} back={back} title={title} extra={extra} />);
  return (
    <Routes>
      <Route path="/" element={<PublicSite />} />
      <Route path="/setup" element={<Setup />} />
      <Route path="/rider/*" element={<RiderPortalSoon />} />
      <Route path="/admin/login" element={<Login />} />
      <Route path="/admin" element={<RequireAuth><AdminLayout /></RequireAuth>}>
        <Route index element={g('dashboard.view', <Dashboard />)} />
        <Route path="profile" element={<Profile />} />

        <Route path="riders" element={g('riders.view', <RidersList />)} />
        <Route path="riders/new" element={g('riders.create', <RiderForm />)} />
        <Route path="riders/bulk-edit" element={g('riders.update', <RidersBulkEdit />)} />
        <Route path="riders/import" element={g('riders.import', <RidersImport />)} />
        <Route path="riders/:slug" element={<RiderOrDocs />} />
        <Route path="riders/:id/edit" element={g('riders.update', <RiderForm />)} />
        <Route path="rider-applicants" element={g('applicants.view', <ApplicantsList />)} />
        <Route path="rider-applicants/new" element={g('applicants.create', <ApplicantForm />)} />
        <Route path="rider-applicants/import" element={g('applicants.import', <ApplicantsImport />)} />
        <Route path="rider-applicants/:id" element={g('applicants.view', <ApplicantView />)} />
        <Route path="rider-applicants/:id/edit" element={g('applicants.update', <ApplicantForm />)} />

        <Route path="vehicles" element={g('vehicles.view', <VehiclesList />)} />
        <Route path="vehicles/new" element={g('vehicles.create', <VehicleForm />)} />
        <Route path="vehicles/import" element={g('vehicles.import', <VehiclesImport />)} />
        <Route path="vehicles/:id" element={g('vehicles.view', <VehicleView />)} />
        <Route path="vehicles/:id/edit" element={g('vehicles.update', <VehicleForm />)} />
        <Route path="operation-cards" element={g('operation_cards.view', <CardsList />)} />
        <Route path="operation-cards/new" element={g('operation_cards.create', <CardForm />)} />
        <Route path="operation-cards/import" element={g('operation_cards.create', <CardsImport />)} />
        <Route path="operation-cards/:id" element={g('operation_cards.view', <CardView />)} />
        <Route path="operation-cards/:id/edit" element={g('operation_cards.update', <CardForm />)} />
        <Route path="vehicle-registrations" element={g('vehicle_registrations.view', <RegistrationsList />)} />
        <Route path="vehicle-registrations/new" element={g('vehicle_registrations.create', <RegistrationForm />)} />
        <Route path="vehicle-registrations/:id" element={g('vehicle_registrations.view', <RegistrationView />)} />
        <Route path="vehicle-registrations/:id/edit" element={g('vehicle_registrations.update', <RegistrationForm />)} />
        <Route path="insurance/companies" element={g('insurance_companies.view', <InsurersList />)} />
        <Route path="insurance/companies/new" element={g('insurance_companies.create', <InsurerForm />)} />
        <Route path="insurance/companies/import" element={imp('/insurance/companies/import', '/admin/insurance/companies', t('ic.import_title'), 'insurance_companies.create')} />
        <Route path="insurance/companies/:id" element={g('insurance_companies.view', <InsurerView />)} />
        <Route path="insurance/companies/:id/edit" element={g('insurance_companies.update', <InsurerForm />)} />
        <Route path="insurance/policies" element={g('insurance_policies.view', <PoliciesList />)} />
        <Route path="insurance/policies/new" element={g('insurance_policies.create', <PolicyForm />)} />
        <Route path="insurance/policies/import" element={imp('/insurance/policies/import', '/admin/insurance/policies', t('pol.import_title'), 'insurance_policies.create')} />
        <Route path="insurance/policies/:id" element={g('insurance_policies.view', <PolicyView />)} />
        <Route path="insurance/policies/:id/edit" element={g('insurance_policies.update', <PolicyForm />)} />
        <Route path="insurance/vehicles" element={g('vehicle_insurance.view', <CoversList />)} />
        <Route path="insurance/vehicles/new" element={g('vehicle_insurance.create', <CoverForm />)} />
        <Route path="insurance/vehicles/bulk-edit" element={g('vehicle_insurance.update', <CoversBulk />)} />
        <Route path="insurance/vehicles/import" element={imp('/insurance/vehicles/import', '/admin/insurance/vehicles', t('vi.import_title'), 'vehicle_insurance.create', { lost_current: t('vi.lost_current') })} />
        <Route path="insurance/vehicles/:id" element={g('vehicle_insurance.view', <CoverView />)} />
        <Route path="insurance/vehicles/:id/edit" element={g('vehicle_insurance.update', <CoverForm />)} />
        <Route path="vehicle-assignments" element={g('vehicle_assignments.view', <AssignmentsList />)} />
        <Route path="vehicle-assignments/new" element={g('vehicle_assignments.create', <AssignmentForm />)} />
        <Route path="vehicle-assignments/import" element={imp('/vehicle-assignments/import', '/admin/vehicle-assignments', t('va.import_title'), 'vehicle_assignments.create', { would_close_current: t('va.would_close') })} />
        <Route path="vehicle-assignments/:id" element={g('vehicle_assignments.view', <AssignmentView />)} />
        <Route path="vehicle-assignments/:id/edit" element={g('vehicle_assignments.update', <AssignmentForm />)} />
        <Route path="fuel-cards" element={g('fuel_cards.view', <FuelCardsList />)} />
        <Route path="fuel-cards/new" element={g('fuel_cards.create', <FuelCardForm />)} />
        <Route path="fuel-cards/bulk-edit" element={g('fuel_cards.update', <FuelCardsBulk />)} />
        <Route path="fuel-cards/import" element={imp('/fuel-cards/import', '/admin/fuel-cards', t('fc.import_title'), 'fuel_cards.create')} />
        <Route path="fuel-cards/:id" element={g('fuel_cards.view', <FuelCardView />)} />
        <Route path="fuel-cards/:id/edit" element={g('fuel_cards.update', <FuelCardForm />)} />
        <Route path="oil-changes" element={g('oil_changes.view', <OilSchedule />)} />
        <Route path="oil-changes/new" element={g('oil_changes.create', <OilScheduleForm />)} />
        <Route path="oil-changes/bulk-edit" element={g('oil_changes.update', <OilBulk />)} />
        <Route path="oil-changes/import" element={imp('/oil-changes/import', '/admin/oil-changes', t('oil.import_schedule'), 'oil_changes.create')} />
        <Route path="oil-changes/history" element={g('oil_changes.view', <OilHistory />)} />
        <Route path="oil-changes/history/new" element={g('oil_changes.create', <OilRecord />)} />
        <Route path="oil-changes/history/import" element={imp('/oil-changes/history/import', '/admin/oil-changes/history', t('oil.import_history'), 'oil_changes.create', { rolled_forward: t('oil.rolled_forward') })} />
        <Route path="oil-changes/history/:id" element={g('oil_changes.view', <OilChangeView />)} />
        <Route path="oil-changes/history/:id/edit" element={g('oil_changes.update', <OilChangeEdit />)} />
        <Route path="oil-changes/:id" element={g('oil_changes.view', <OilScheduleView />)} />
        <Route path="oil-changes/:id/edit" element={g('oil_changes.update', <OilScheduleForm />)} />

        <Route path="alerts" element={g('alerts.view', <AlertsList />)} />
        <Route path="renewals" element={g('renewals.view', <RenewalsList />)} />
        <Route path="renewals/new" element={g('renewals.create', <RenewalForm />)} />
        <Route path="renewals/:id" element={g('renewals.view', <RenewalView />)} />
        <Route path="transport-licenses" element={g('transport_licenses.view', <LicensesList />)} />
        <Route path="transport-licenses/new" element={g('transport_licenses.create', <LicenseForm />)} />
        <Route path="transport-licenses/:id" element={g('transport_licenses.view', <LicenseView />)} />
        <Route path="transport-licenses/:id/edit" element={g('transport_licenses.update', <LicenseForm />)} />

        <Route path="companies" element={g('companies.view', <CompaniesList />)} />
        <Route path="companies/new" element={g('companies.create', <CompanyForm />)} />
        <Route path="companies/:id" element={g('companies.view', <CompanyView />)} />
        <Route path="companies/:id/edit" element={g('companies.update', <CompanyForm />)} />
        <Route path="contracts" element={g('contracts.view', <ContractsList />)} />
        <Route path="contracts/new" element={g('contracts.create', <ContractForm />)} />
        <Route path="contracts/:id" element={g('contracts.view', <ContractView />)} />
        <Route path="contracts/:id/edit" element={g('contracts.update', <ContractForm />)} />

        <Route path="users" element={g('users.view', <UsersList />)} />
        <Route path="users/new" element={g('users.create', <UserForm />)} />
        <Route path="users/:id" element={g('users.view', <UserView />)} />
        <Route path="users/:id/edit" element={g('users.update', <UserForm />)} />
        <Route path="roles" element={g(['roles.view', 'permissions.view'], <RolesList />)} />
        <Route path="roles/new" element={g('roles.create', <RoleEdit />)} />
        <Route path="roles/:id" element={g('roles.view', <RoleView />)} />
        <Route path="roles/:id/edit" element={g(['roles.update', 'permissions.update'], <RoleEdit />)} />
        <Route path="sessions" element={g('sessions.view', <SessionsList />)} />
        <Route path="blocked-ips" element={g('blocked_ips.view', <BlockedIps />)} />

        <Route path="settings" element={g(['system_settings.view', 'organization.view', 'platform_settings.view', 'secrets.view'], <Settings />)} />
        <Route path="settings/:tab" element={g(['system_settings.view', 'organization.view', 'platform_settings.view', 'secrets.view'], <Settings />)} />
        <Route path="attachments" element={g('attachments.view', <AttachmentsIndex />)} />
        <Route path="logs/audit" element={g(['audit_log.view', 'logs.view'], <AuditLog />)} />
        <Route path="logs/login" element={g('login_log.view', <LoginAttempts />)} />
        <Route path="*" element={<NotFound />} />
      </Route>
      <Route path="*" element={<PublicSite />} />
    </Routes>
  );
}
