-- Logistics Services Platform — schema (phase 1). Run by the setup wizard, step 2.
-- Every statement is idempotent so the step can be re-run.

CREATE TABLE IF NOT EXISTS settings (
  `key` VARCHAR(100) PRIMARY KEY,
  value TEXT NULL,
  type ENUM('int','decimal','bool','date','json','text') NOT NULL DEFAULT 'text',
  category VARCHAR(40) NOT NULL DEFAULT 'general',
  description VARCHAR(255) NULL,
  editable TINYINT(1) NOT NULL DEFAULT 1,
  updated_at DATETIME NULL
);

CREATE TABLE IF NOT EXISTS roles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(60) NOT NULL UNIQUE,
  description VARCHAR(255) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id INT NOT NULL,
  perm VARCHAR(80) NOT NULL,
  PRIMARY KEY (role_id, perm),
  FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) NOT NULL UNIQUE,
  full_name VARCHAR(150) NOT NULL,
  email VARCHAR(150) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role_id INT NOT NULL,
  status ENUM('active','disabled','locked') NOT NULL DEFAULT 'active',
  locked_until DATETIME NULL,
  locale VARCHAR(10) NULL,
  last_login_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NULL,
  FOREIGN KEY (role_id) REFERENCES roles(id)
);

CREATE TABLE IF NOT EXISTS sessions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  token_hash CHAR(64) NOT NULL UNIQUE,
  user_id INT NULL,
  ip VARCHAR(64) NULL,
  user_agent VARCHAR(255) NULL,
  status ENUM('active','expired','revoked','signed_out') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_activity_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  ended_at DATETIME NULL,
  INDEX (user_id, status)
);

CREATE TABLE IF NOT EXISTS login_challenges (
  id CHAR(32) PRIMARY KEY,
  code CHAR(6) NOT NULL,
  ip VARCHAR(64) NULL,
  attempts INT NOT NULL DEFAULT 0,
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL
);

CREATE TABLE IF NOT EXISTS login_attempts (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  username_typed VARCHAR(150) NULL,
  user_id INT NULL,
  success TINYINT(1) NOT NULL,
  reason VARCHAR(40) NULL,
  ip VARCHAR(64) NULL,
  user_agent VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX (ip, created_at),
  INDEX (user_id, created_at)
);

CREATE TABLE IF NOT EXISTS blocked_ips (
  id INT AUTO_INCREMENT PRIMARY KEY,
  ip VARCHAR(64) NOT NULL UNIQUE,
  reason VARCHAR(500) NOT NULL,
  failed_attempts INT NOT NULL DEFAULT 0,
  status ENUM('blocked','lifted') NOT NULL DEFAULT 'blocked',
  expires_at DATETIME NULL,
  blocked_by INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_log (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  action VARCHAR(80) NOT NULL,
  entity_type VARCHAR(60) NULL,
  entity_id VARCHAR(60) NULL,
  actor_type ENUM('user','system','api','guest','job') NOT NULL DEFAULT 'user',
  actor_id INT NULL,
  actor_name VARCHAR(150) NULL,
  status ENUM('success','failed','error','pending','denied') NOT NULL DEFAULT 'success',
  severity ENUM('info','warning','error','critical') NOT NULL DEFAULT 'info',
  ip VARCHAR(64) NULL,
  route VARCHAR(255) NULL,
  request_id VARCHAR(40) NULL,
  user_agent VARCHAR(255) NULL,
  before_json JSON NULL,
  after_json JSON NULL,
  details VARCHAR(1000) NULL,
  INDEX (created_at), INDEX (entity_type, entity_id)
);

CREATE TABLE IF NOT EXISTS cities (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name_ar VARCHAR(100) NOT NULL UNIQUE,
  name_en VARCHAR(100) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS companies (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  email VARCHAR(150) NULL,
  operator_id VARCHAR(50) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS contracts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  company_id INT NOT NULL,
  name VARCHAR(255) NOT NULL,
  description VARCHAR(500) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY (company_id, name),
  FOREIGN KEY (company_id) REFERENCES companies(id)
);

-- The rider id is the number the delivery company knows the rider by. It is typed by hand and never changes.
CREATE TABLE IF NOT EXISTS riders (
  id BIGINT PRIMARY KEY,
  full_name VARCHAR(150) NOT NULL,
  name_en VARCHAR(150) NULL,
  alias VARCHAR(150) NULL,
  national_id VARCHAR(30) NULL UNIQUE,
  status ENUM('active','inactive','suspended','terminated') NOT NULL DEFAULT 'active',
  company_id INT NULL,
  contract_id INT NULL,
  city_id INT NULL,
  hire_date DATE NULL,
  occupation VARCHAR(150) NULL,
  phone VARCHAR(30) NULL,
  account_holder_phone VARCHAR(30) NULL,
  email VARCHAR(150) NULL,
  language ENUM('ar','en','bn') NULL,
  nationality VARCHAR(100) NULL,
  birth_date DATE NULL,
  birth_place VARCHAR(150) NULL,
  blood_type ENUM('A+','A-','B+','B-','AB+','AB-','O+','O-') NULL,
  notes VARCHAR(500) NULL,
  portal_enabled TINYINT(1) NOT NULL DEFAULT 1,
  portal_password_hash VARCHAR(255) NULL,
  portal_password_set_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NULL,
  FOREIGN KEY (company_id) REFERENCES companies(id),
  FOREIGN KEY (contract_id) REFERENCES contracts(id),
  FOREIGN KEY (city_id) REFERENCES cities(id)
);

CREATE TABLE IF NOT EXISTS transport_licenses (
  id INT AUTO_INCREMENT PRIMARY KEY,
  number VARCHAR(50) NOT NULL UNIQUE,
  city_id INT NOT NULL,
  issue_date DATE NULL,
  expiry_date DATE NOT NULL,
  activity_ar VARCHAR(255) NULL,
  activity_en VARCHAR(255) NULL,
  status ENUM('valid','expired','suspended') NOT NULL DEFAULT 'valid',
  notes VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (city_id) REFERENCES cities(id)
);

-- One table for the five rider documents. Each rider has one current version per type;
-- older versions stay as "superseded". Numbers are unique per type across all versions.
CREATE TABLE IF NOT EXISTS rider_documents (
  id INT AUTO_INCREMENT PRIMARY KEY,
  rider_id BIGINT NOT NULL,
  doc_type ENUM('id','license','health','driver_card','ajeer') NOT NULL,
  doc_number VARCHAR(50) NULL,
  id_kind ENUM('national_id','iqama','passport') NULL,
  version_number VARCHAR(10) NULL,
  place_of_issue VARCHAR(100) NULL,
  license_type VARCHAR(100) NULL,
  license_type_en VARCHAR(100) NULL,
  cert_type VARCHAR(100) NULL,
  issuing_authority VARCHAR(150) NULL,
  issue_date_hijri VARCHAR(10) NULL,
  expiry_date_hijri VARCHAR(10) NULL,
  transport_license_id INT NULL,
  card_category ENUM('yearly','half_yearly','quarterly','temporary') NULL,
  beneficiary_company_id INT NULL,
  contract_summary VARCHAR(255) NULL,
  work_locations VARCHAR(255) NULL,
  issue_date DATE NULL,
  expiry_date DATE NULL,
  status ENUM('valid','expired','suspended','cancelled') NOT NULL DEFAULT 'valid',
  is_current TINYINT(1) NOT NULL DEFAULT 1,
  notes VARCHAR(500) NULL,
  created_by INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_doc_number (doc_type, doc_number),
  INDEX (rider_id, doc_type, is_current),
  FOREIGN KEY (rider_id) REFERENCES riders(id),
  FOREIGN KEY (transport_license_id) REFERENCES transport_licenses(id),
  FOREIGN KEY (beneficiary_company_id) REFERENCES companies(id)
);

CREATE TABLE IF NOT EXISTS applicants (
  id INT AUTO_INCREMENT PRIMARY KEY,
  full_name VARCHAR(150) NOT NULL,
  name_en VARCHAR(150) NULL,
  phone VARCHAR(20) NOT NULL UNIQUE,
  national_id VARCHAR(30) NULL UNIQUE,
  nationality VARCHAR(100) NULL,
  birth_date DATE NULL,
  city_id INT NULL,
  status ENUM('new','review','approved','rejected','withdrawn','hired') NOT NULL DEFAULT 'new',
  heard_from VARCHAR(100) NULL,
  featured TINYINT(1) NOT NULL DEFAULT 0,
  featured_reason VARCHAR(255) NULL,
  featured_by INT NULL,
  featured_at DATETIME NULL,
  notes VARCHAR(500) NULL,
  has_vehicle TINYINT(1) NOT NULL DEFAULT 0,
  vehicle_type VARCHAR(50) NULL,
  vehicle_plate VARCHAR(30) NULL,
  vehicle_maker VARCHAR(60) NULL,
  vehicle_model VARCHAR(60) NULL,
  vehicle_year SMALLINT NULL,
  rider_id BIGINT NULL,
  reviewed_by INT NULL,
  reviewed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (city_id) REFERENCES cities(id)
);

CREATE TABLE IF NOT EXISTS vehicles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  plate VARCHAR(30) NOT NULL UNIQUE,
  plate_key VARCHAR(30) NOT NULL,
  plate_en VARCHAR(30) NULL UNIQUE,
  vehicle_type VARCHAR(50) NOT NULL,
  registration_type VARCHAR(60) NULL,
  maker VARCHAR(60) NULL,
  model VARCHAR(60) NULL,
  color VARCHAR(40) NULL,
  year SMALLINT NULL,
  chassis VARCHAR(30) NULL,
  weight INT NULL,
  capacity INT NULL,
  ownership ENUM('owned','rented') NOT NULL DEFAULT 'owned',
  status ENUM('active','maintenance','retired') NOT NULL DEFAULT 'active',
  odometer INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX (plate_key)
);

CREATE TABLE IF NOT EXISTS operation_cards (
  id INT AUTO_INCREMENT PRIMARY KEY,
  number VARCHAR(50) NOT NULL UNIQUE,
  transport_license_id INT NOT NULL,
  issue_date DATE NULL,
  expiry_date DATE NOT NULL,
  renew_date DATE NULL,
  status ENUM('valid','expired','suspended','cancelled') NOT NULL DEFAULT 'valid',
  notes VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (transport_license_id) REFERENCES transport_licenses(id)
);

-- A card covers several vehicles; each vehicle has exactly one current card.
CREATE TABLE IF NOT EXISTS operation_card_vehicles (
  card_id INT NOT NULL,
  vehicle_id INT NOT NULL,
  is_current TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (card_id, vehicle_id),
  FOREIGN KEY (card_id) REFERENCES operation_cards(id) ON DELETE CASCADE,
  FOREIGN KEY (vehicle_id) REFERENCES vehicles(id)
);

CREATE TABLE IF NOT EXISTS vehicle_registrations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  vehicle_id INT NOT NULL,
  serial VARCHAR(30) NOT NULL UNIQUE,
  owner VARCHAR(150) NOT NULL,
  owner_id_no VARCHAR(20) NULL,
  user_rider_id BIGINT NULL,
  user_name VARCHAR(150) NULL,
  user_id_no VARCHAR(20) NULL,
  issue_date DATE NULL,
  expiry_date DATE NULL,
  status ENUM('valid','expired','cancelled') NOT NULL DEFAULT 'valid',
  is_current TINYINT(1) NOT NULL DEFAULT 1,
  notes VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (vehicle_id) REFERENCES vehicles(id),
  FOREIGN KEY (user_rider_id) REFERENCES riders(id)
);

CREATE TABLE IF NOT EXISTS insurance_companies (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name_ar VARCHAR(150) NOT NULL UNIQUE,
  name_en VARCHAR(150) NULL,
  phone VARCHAR(30) NULL,
  website VARCHAR(255) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS insurance_policies (
  id INT AUTO_INCREMENT PRIMARY KEY,
  number VARCHAR(50) NOT NULL UNIQUE,
  company_id INT NOT NULL,
  type ENUM('third_party','comprehensive') NOT NULL DEFAULT 'third_party',
  issue_date DATE NULL,
  start_date DATE NULL,
  expiry_date DATE NOT NULL,
  status ENUM('valid','expired','cancelled') NOT NULL DEFAULT 'valid',
  notes VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (company_id) REFERENCES insurance_companies(id)
);

CREATE TABLE IF NOT EXISTS vehicle_insurance (
  id INT AUTO_INCREMENT PRIMARY KEY,
  vehicle_id INT NOT NULL,
  policy_id INT NOT NULL,
  sub_policy VARCHAR(50) NULL,
  start_date DATE NULL,
  expiry_date DATE NOT NULL,
  status ENUM('valid','expired','cancelled') NOT NULL DEFAULT 'valid',
  is_current TINYINT(1) NOT NULL DEFAULT 1,
  notes VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY (vehicle_id, policy_id),
  FOREIGN KEY (vehicle_id) REFERENCES vehicles(id),
  FOREIGN KEY (policy_id) REFERENCES insurance_policies(id)
);

CREATE TABLE IF NOT EXISTS vehicle_assignments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  rider_id BIGINT NOT NULL,
  vehicle_id INT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NULL,
  is_current TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX (vehicle_id, is_current), INDEX (rider_id, is_current),
  FOREIGN KEY (rider_id) REFERENCES riders(id),
  FOREIGN KEY (vehicle_id) REFERENCES vehicles(id)
);

CREATE TABLE IF NOT EXISTS fuel_cards (
  id INT AUTO_INCREMENT PRIMARY KEY,
  number VARCHAR(50) NOT NULL UNIQUE,
  provider VARCHAR(100) NULL,
  status ENUM('active','blocked','expired') NOT NULL DEFAULT 'active',
  issue_date DATE NULL,
  balance DECIMAL(12,2) NOT NULL DEFAULT 0,
  monthly_limit DECIMAL(12,2) NULL,
  rider_id BIGINT NULL,
  vehicle_id INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (rider_id) REFERENCES riders(id),
  FOREIGN KEY (vehicle_id) REFERENCES vehicles(id)
);

CREATE TABLE IF NOT EXISTS oil_schedules (
  id INT AUTO_INCREMENT PRIMARY KEY,
  vehicle_id INT NOT NULL UNIQUE,
  interval_days INT NOT NULL,
  warn_days INT NOT NULL DEFAULT 7,
  last_change DATE NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (vehicle_id) REFERENCES vehicles(id)
);

CREATE TABLE IF NOT EXISTS oil_changes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  vehicle_id INT NOT NULL,
  change_date DATE NOT NULL,
  odometer INT NULL,
  performed_by VARCHAR(150) NULL,
  cost DECIMAL(12,2) NULL,
  notes VARCHAR(300) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY (vehicle_id, change_date),
  FOREIGN KEY (vehicle_id) REFERENCES vehicles(id)
);

-- Renewal log (chapter 5). Rows are history and are never edited.
CREATE TABLE IF NOT EXISTS renewals (
  id INT AUTO_INCREMENT PRIMARY KEY,
  doc_kind VARCHAR(30) NOT NULL,
  doc_id INT NOT NULL,
  new_doc_id INT NULL,
  owner_type ENUM('rider','vehicle','organization') NOT NULL,
  owner_label VARCHAR(255) NULL,
  previous_number VARCHAR(100) NULL,
  new_number VARCHAR(100) NULL,
  previous_expiry DATE NULL,
  new_expiry DATE NOT NULL,
  operation ENUM('renewal','replacement','reissue','correction') NOT NULL DEFAULT 'renewal',
  renewal_date DATE NOT NULL,
  cost DECIMAL(12,2) NULL,
  reference VARCHAR(100) NULL,
  notes VARCHAR(500) NULL,
  recorded_by INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX (doc_kind, doc_id)
);

CREATE TABLE IF NOT EXISTS attachments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  entity_type VARCHAR(40) NOT NULL,
  entity_id VARCHAR(40) NOT NULL,
  attachment_type VARCHAR(40) NULL,
  file_name VARCHAR(255) NOT NULL,
  stored_name VARCHAR(255) NOT NULL,
  mime VARCHAR(100) NOT NULL,
  size INT NOT NULL,
  note VARCHAR(255) NULL,
  is_current TINYINT(1) NOT NULL DEFAULT 1,
  uploaded_by INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX (entity_type, entity_id)
);

-- "Private keys" tab: integration secrets, encrypted at rest with the server key.
CREATE TABLE IF NOT EXISTS secrets (
  name VARCHAR(100) PRIMARY KEY,
  value TEXT NULL,
  description VARCHAR(255) NULL,
  encrypted TINYINT(1) NOT NULL DEFAULT 1,
  updated_at DATETIME NULL
);

-- ======================================================================== phase 2
-- Notifications (chapter 9). Title and body are translation keys, shown in the reader's language.
CREATE TABLE IF NOT EXISTS notifications (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NULL,
  rider_id BIGINT NULL,
  category ENUM('document_expiry','oil_change','advance_status','installment_due','backup','security','performance','system','general') NOT NULL DEFAULT 'general',
  severity ENUM('info','warning','critical') NOT NULL DEFAULT 'info',
  title VARCHAR(120) NOT NULL,
  body VARCHAR(120) NULL,
  params JSON NULL,
  entity_type VARCHAR(40) NULL,
  entity_id VARCHAR(40) NULL,
  link VARCHAR(255) NULL,
  dedupe VARCHAR(190) NULL UNIQUE,
  read_at DATETIME NULL,
  emailed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX (user_id, read_at), INDEX (rider_id, read_at), INDEX (created_at)
);
CREATE TABLE IF NOT EXISTS notification_prefs (
  user_id INT NOT NULL,
  category VARCHAR(40) NOT NULL,
  in_app TINYINT(1) NOT NULL DEFAULT 1,
  email TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, category)
);

-- 3.1 leave requests and their letters. The letter number runs within the year of the leave's start.
CREATE TABLE IF NOT EXISTS leaves (
  id INT AUTO_INCREMENT PRIMARY KEY,
  letter_no VARCHAR(20) NOT NULL UNIQUE,
  seq_year SMALLINT NOT NULL,
  seq INT NOT NULL,
  rider_id BIGINT NOT NULL,
  leave_type ENUM('emergency','annual','sick','unpaid','other') NOT NULL DEFAULT 'emergency',
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  reason VARCHAR(500) NOT NULL,
  reason_paragraph VARCHAR(1000) NULL,
  internal_note TEXT NULL,
  status ENUM('pending','approved','rejected','cancelled') NOT NULL DEFAULT 'pending',
  answer_note VARCHAR(500) NULL,
  answered_by INT NULL,
  answered_at DATETIME NULL,
  source ENUM('office','rider') NOT NULL DEFAULT 'office',
  stamped TINYINT(1) NOT NULL DEFAULT 0,
  created_by INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NULL,
  UNIQUE KEY (seq_year, seq),
  INDEX (rider_id, start_date),
  FOREIGN KEY (rider_id) REFERENCES riders(id)
);

-- 3.2 absences as the delivery company recorded them. Only internal_note belongs to the office.
CREATE TABLE IF NOT EXISTS rider_absences (
  id INT AUTO_INCREMENT PRIMARY KEY,
  rider_id BIGINT NOT NULL,
  external_id VARCHAR(60) NULL UNIQUE,
  start_at DATETIME NOT NULL,
  end_at DATETIME NOT NULL,
  days DECIMAL(7,3) NOT NULL,
  reason VARCHAR(40) NULL,
  paid TINYINT(1) NULL,
  status VARCHAR(40) NULL,
  contract VARCHAR(150) NULL,
  company_comment VARCHAR(500) NULL,
  internal_note VARCHAR(500) NULL,
  source ENUM('import','sync') NOT NULL DEFAULT 'import',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NULL,
  INDEX (rider_id, start_at),
  FOREIGN KEY (rider_id) REFERENCES riders(id)
);

-- 3.3 advances and their monthly instalments.
CREATE TABLE IF NOT EXISTS advances (
  id INT AUTO_INCREMENT PRIMARY KEY,
  number VARCHAR(20) NOT NULL UNIQUE,
  seq_year SMALLINT NOT NULL,
  seq INT NOT NULL,
  rider_id BIGINT NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  installments INT NOT NULL DEFAULT 1,
  request_date DATE NOT NULL,
  first_due DATE NULL,
  deduct_from ENUM('salary','commission','wallet','other') NOT NULL DEFAULT 'salary',
  reason VARCHAR(500) NULL,
  notes VARCHAR(500) NULL,
  status ENUM('pending','approved','rejected','disbursed','repaying','settled','cancelled') NOT NULL DEFAULT 'pending',
  decided_by INT NULL,
  decided_at DATETIME NULL,
  decision_note VARCHAR(500) NULL,
  payout_method ENUM('cash','bank','wallet','other') NULL,
  disbursed_on DATE NULL,
  disbursed_by INT NULL,
  created_by INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY (seq_year, seq),
  INDEX (rider_id, status),
  FOREIGN KEY (rider_id) REFERENCES riders(id)
);
CREATE TABLE IF NOT EXISTS advance_installments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  advance_id INT NOT NULL,
  n INT NOT NULL,
  due_date DATE NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  paid DECIMAL(12,2) NOT NULL DEFAULT 0,
  status ENUM('due','partial','paid','waived') NOT NULL DEFAULT 'due',
  paid_on DATE NULL,
  waive_reason VARCHAR(300) NULL,
  updated_by INT NULL,
  updated_at DATETIME NULL,
  UNIQUE KEY (advance_id, n),
  INDEX (status, due_date),
  FOREIGN KEY (advance_id) REFERENCES advances(id) ON DELETE CASCADE
);

-- 3.4 data change requests from the rider portal. payload: the requested values; snapshot: the values when submitted.
CREATE TABLE IF NOT EXISTS rider_change_requests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  rider_id BIGINT NOT NULL,
  type ENUM('contact','photo','document') NOT NULL,
  doc_type ENUM('id','license','health','driver_card','ajeer','other') NULL,
  payload JSON NOT NULL,
  snapshot JSON NULL,
  rider_note VARCHAR(500) NULL,
  status ENUM('pending','approved','rejected','cancelled') NOT NULL DEFAULT 'pending',
  review_note VARCHAR(500) NULL,
  reviewed_by INT NULL,
  reviewed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX (rider_id, status),
  FOREIGN KEY (rider_id) REFERENCES riders(id)
);

-- 3.5 conversations with riders. Unread = messages after the other side's read mark.
CREATE TABLE IF NOT EXISTS rider_issues (
  id INT AUTO_INCREMENT PRIMARY KEY,
  rider_id BIGINT NOT NULL,
  subject VARCHAR(200) NOT NULL,
  category ENUM('account','performance','attendance','payment','vehicle','app','other') NOT NULL DEFAULT 'other',
  priority ENUM('low','normal','high','urgent') NOT NULL DEFAULT 'normal',
  status ENUM('open','in_progress','resolved','closed') NOT NULL DEFAULT 'open',
  opened_by ENUM('rider','staff') NOT NULL DEFAULT 'rider',
  assignee_id INT NULL,
  staff_read_at DATETIME(3) NULL,
  rider_read_at DATETIME(3) NULL,
  last_activity_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  resolved_at DATETIME NULL,
  closed_at DATETIME NULL,
  created_by INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX (rider_id), INDEX (status, last_activity_at),
  FOREIGN KEY (rider_id) REFERENCES riders(id)
);
CREATE TABLE IF NOT EXISTS rider_issue_messages (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  issue_id INT NOT NULL,
  author ENUM('rider','staff') NOT NULL,
  user_id INT NULL,
  body TEXT NULL,
  internal TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX (issue_id, id),
  FOREIGN KEY (issue_id) REFERENCES rider_issues(id) ON DELETE CASCADE
);

-- ======================================================================== chapter 8: finance
-- All figures are the delivery company's; the office changes only a fine's status, note and amount.
CREATE TABLE IF NOT EXISTS fines (
  id INT AUTO_INCREMENT PRIMARY KEY,
  rider_id BIGINT NOT NULL,
  fine_date DATE NOT NULL,
  invoice_no VARCHAR(60) NOT NULL DEFAULT '',
  category VARCHAR(255) NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  company VARCHAR(150) NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'SAR',
  status ENUM('open','disputed','waived','deducted') NOT NULL DEFAULT 'open',
  internal_note VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NULL,
  UNIQUE KEY uq_fine (rider_id, fine_date, invoice_no, category(150), amount),
  INDEX (fine_date),
  FOREIGN KEY (rider_id) REFERENCES riders(id)
);
CREATE TABLE IF NOT EXISTS wallet_snapshots (
  rider_id BIGINT NOT NULL,
  snapshot_date DATE NOT NULL,
  balance DECIMAL(12,2) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (rider_id, snapshot_date),
  FOREIGN KEY (rider_id) REFERENCES riders(id)
);
CREATE TABLE IF NOT EXISTS wallet_entries (
  id INT AUTO_INCREMENT PRIMARY KEY,
  rider_id BIGINT NOT NULL,
  entry_date DATE NOT NULL,
  description VARCHAR(500) NOT NULL DEFAULT '',
  amount DECIMAL(12,2) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_entry (rider_id, entry_date, description(200), amount),
  INDEX (entry_date),
  FOREIGN KEY (rider_id) REFERENCES riders(id)
);
CREATE TABLE IF NOT EXISTS billing (
  id INT AUTO_INCREMENT PRIMARY KEY,
  rider_id BIGINT NOT NULL,
  month CHAR(7) NOT NULL,
  contract VARCHAR(150) NULL,
  completed_orders INT NULL,
  basic_payment DECIMAL(12,2) NULL, distance_payment DECIMAL(12,2) NULL, ftr_bonus DECIMAL(12,2) NULL,
  rider_payment_basic DECIMAL(12,2) NULL, rider_payment_scoring DECIMAL(12,2) NULL,
  fine_acceptance DECIMAL(12,2) NULL, fine_contact DECIMAL(12,2) NULL, fine_declined DECIMAL(12,2) NULL, fine_late DECIMAL(12,2) NULL,
  fine_no_show DECIMAL(12,2) NULL, fine_no_show_special DECIMAL(12,2) NULL, fine_daily_acceptance DECIMAL(12,2) NULL, fine_missed_days DECIMAL(12,2) NULL,
  ded_stacking DECIMAL(12,2) NULL, ded_car DECIMAL(12,2) NULL, ded_google DECIMAL(12,2) NULL, total_deductions DECIMAL(12,2) NULL,
  rider_balance DECIMAL(12,2) NULL, pending_balance DECIMAL(12,2) NULL, amount_excl_vat DECIMAL(12,2) NULL, vat DECIMAL(12,2) NULL,
  amount_incl_vat DECIMAL(12,2) NULL, net_ftr DECIMAL(12,2) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY (rider_id, month),
  INDEX (month),
  FOREIGN KEY (rider_id) REFERENCES riders(id)
);

-- ======================================================================== chapter 6: performance and sync
-- 6.1 one row per rider per day, as the delivery company reports it. Empty means "not received", not zero.
CREATE TABLE IF NOT EXISTS daily_performance (
  id INT AUTO_INCREMENT PRIMARY KEY,
  rider_id BIGINT NOT NULL,
  work_date DATE NOT NULL,
  contract_id INT NULL,
  batch VARCHAR(50) NULL, tga_status VARCHAR(50) NULL, error_codes VARCHAR(50) NULL,
  shifts INT NULL, working_days INT NULL,
  planned_hours DECIMAL(7,2) NULL, actual_hours DECIMAL(7,2) NULL, break_hours DECIMAL(7,2) NULL, lost_hours DECIMAL(7,2) NULL,
  attendance_rate DECIMAL(7,4) NULL, acceptance_rate DECIMAL(7,4) NULL, contact_rate DECIMAL(7,4) NULL,
  no_shows INT NULL, no_show_rate DECIMAL(7,4) NULL,
  notified INT NULL, accepted INT NULL, completed INT NULL, stacked INT NULL, declined INT NULL, cancelled INT NULL,
  deductions INT NULL, not_accepted INT NULL, manual_undispatched INT NULL, chat_response_rate DECIMAL(7,4) NULL,
  source ENUM('manual','import','sync') NOT NULL DEFAULT 'manual',
  created_by INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NULL,
  UNIQUE KEY (rider_id, work_date),
  INDEX (work_date),
  FOREIGN KEY (rider_id) REFERENCES riders(id)
);

-- 6.3 start-of-shift photos: the automatic check and the staff review are kept apart.
CREATE TABLE IF NOT EXISTS branding_photos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  rider_id BIGINT NOT NULL,
  captured_at DATETIME NOT NULL,
  photo_url VARCHAR(1000) NOT NULL,
  contract_name VARCHAR(150) NULL,
  check_result ENUM('pending','fine','blurred','no_face','unreadable','failed') NOT NULL DEFAULT 'pending',
  override_result ENUM('fine','blurred','no_face','unreadable') NULL,
  override_by INT NULL,
  card_review ENUM('none','visible','not_visible','unclear') NOT NULL DEFAULT 'none',
  card_note VARCHAR(300) NULL,
  card_by INT NULL, card_at DATETIME NULL,
  source_review ENUM('none','direct','screen','unclear') NOT NULL DEFAULT 'none',
  source_by INT NULL, source_at DATETIME NULL,
  suspect_card TINYINT(1) NOT NULL DEFAULT 0,
  suspect_screen TINYINT(1) NOT NULL DEFAULT 0,
  measurements JSON NULL,
  checked_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY (rider_id, captured_at),
  INDEX (captured_at),
  FOREIGN KEY (rider_id) REFERENCES riders(id)
);

-- 6.4 the company's monthly rating, and the segment floors it draws city-wide.
CREATE TABLE IF NOT EXISTS monthly_ratings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  rider_id BIGINT NOT NULL,
  month CHAR(7) NOT NULL,
  segment CHAR(1) NULL,
  final_score DECIMAL(7,4) NULL, on_time DECIMAL(7,4) NULL, fail_rate_score DECIMAL(7,4) NULL,
  gross_orders INT NULL, completed INT NULL, completed_in_time INT NULL, failed_by_rider INT NULL,
  verification_requests INT NULL, verification_success INT NULL, verification_rate DECIMAL(7,4) NULL,
  city VARCHAR(100) NULL, contract VARCHAR(150) NULL,
  source ENUM('sync','file','manual') NOT NULL DEFAULT 'file',
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY (rider_id, month),
  INDEX (month),
  FOREIGN KEY (rider_id) REFERENCES riders(id)
);
CREATE TABLE IF NOT EXISTS rating_cutoffs (
  month CHAR(7) NOT NULL,
  segment CHAR(1) NOT NULL,
  min_final DECIMAL(7,4) NULL, min_otd DECIMAL(7,4) NULL, min_fr DECIMAL(7,4) NULL,
  city_riders INT NULL,
  PRIMARY KEY (month, segment)
);

-- 6.5 sync: the sources, their runs, and (3.6) the live board read from the platform.
CREATE TABLE IF NOT EXISTS sync_sources (
  code VARCHAR(40) PRIMARY KEY,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  sync_from DATE NULL,
  create_riders TINYINT(1) NOT NULL DEFAULT 0,
  report_url VARCHAR(500) NULL
);
CREATE TABLE IF NOT EXISTS sync_runs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  source VARCHAR(40) NOT NULL,
  report_day DATE NULL,
  status ENUM('running','succeeded','failed','skipped','needs_sign_in') NOT NULL DEFAULT 'running',
  trigger_type ENUM('manual','scheduled','catch_up','extension') NOT NULL DEFAULT 'manual',
  started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at DATETIME NULL,
  rows_read INT NULL, added INT NULL, replaced INT NULL,
  user_id INT NULL,
  message VARCHAR(1000) NULL,
  INDEX (source, report_day), INDEX (started_at)
);
CREATE TABLE IF NOT EXISTS live_board (
  rider_id BIGINT PRIMARY KEY,
  name VARCHAR(150) NULL,
  status VARCHAR(40) NULL,
  seen_at DATETIME NOT NULL,
  lat DECIMAL(9,6) NULL, lng DECIMAL(9,6) NULL, located_at DATETIME NULL,
  shift_start VARCHAR(10) NULL, shift_end VARCHAR(10) NULL,
  worked_min INT NULL, late_min INT NULL, breaks INT NULL, break_min INT NULL,
  completed INT NULL, cancelled INT NULL, active_orders INT NULL, wallet DECIMAL(12,2) NULL,
  work_day DATE NULL
);
CREATE TABLE IF NOT EXISTS live_points (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  rider_id BIGINT NOT NULL,
  at DATETIME NOT NULL,
  work_day DATE NOT NULL,
  lat DECIMAL(9,6) NOT NULL, lng DECIMAL(9,6) NOT NULL,
  accuracy INT NULL,
  status VARCHAR(40) NULL,
  has_order TINYINT(1) NOT NULL DEFAULT 0,
  INDEX (rider_id, work_day, at), INDEX (at)
);
CREATE TABLE IF NOT EXISTS live_days (
  rider_id BIGINT NOT NULL,
  work_day DATE NOT NULL,
  shifts INT NULL, worked_min INT NULL, late_min INT NULL, breaks INT NULL, break_min INT NULL,
  completed INT NULL, cancelled INT NULL, wallet DECIMAL(12,2) NULL,
  PRIMARY KEY (rider_id, work_day)
);

-- ======================================================================== chapter 11: email, errors, jobs, backups, languages
CREATE TABLE IF NOT EXISTS email_templates (
  tkey VARCHAR(80) PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  subject VARCHAR(255) NOT NULL,
  body_html TEXT NOT NULL,
  placeholders VARCHAR(500) NULL,
  grp ENUM('documents','advances','security','portal','system') NOT NULL DEFAULT 'system',
  is_system TINYINT(1) NOT NULL DEFAULT 0,
  is_required TINYINT(1) NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  updated_at DATETIME NULL
);
CREATE TABLE IF NOT EXISTS email_log (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  template_key VARCHAR(80) NULL,
  to_email VARCHAR(255) NOT NULL,
  to_name VARCHAR(150) NULL,
  cc VARCHAR(500) NULL,
  subject VARCHAR(255) NOT NULL,
  body MEDIUMTEXT NULL,
  account ENUM('system','riders') NOT NULL DEFAULT 'system',
  status ENUM('queued','sent','failed') NOT NULL DEFAULT 'queued',
  error_code VARCHAR(60) NULL,
  error_message VARCHAR(1000) NULL,
  entity_type VARCHAR(40) NULL,
  entity_id VARCHAR(40) NULL,
  retries INT NOT NULL DEFAULT 0,
  provider_id VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at DATETIME NULL,
  last_attempt_at DATETIME NULL,
  INDEX (created_at), INDEX (status)
);
CREATE TABLE IF NOT EXISTS error_log (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  level ENUM('info','warning','error','critical') NOT NULL DEFAULT 'error',
  code VARCHAR(80) NULL,
  module VARCHAR(80) NULL,
  message VARCHAR(1000) NOT NULL,
  route VARCHAR(255) NULL,
  method VARCHAR(10) NULL,
  user_id INT NULL,
  request_id VARCHAR(40) NULL,
  stack TEXT NULL,
  INDEX (created_at)
);
CREATE TABLE IF NOT EXISTS cron_runs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  job VARCHAR(40) NOT NULL,
  started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at DATETIME NULL,
  outcome ENUM('running','completed','failed') NOT NULL DEFAULT 'running',
  records INT NOT NULL DEFAULT 0,
  notifications INT NOT NULL DEFAULT 0,
  emails INT NOT NULL DEFAULT 0,
  error VARCHAR(1000) NULL,
  details JSON NULL,
  manual TINYINT(1) NOT NULL DEFAULT 0,
  INDEX (job, started_at)
);
CREATE TABLE IF NOT EXISTS backups (
  id INT AUTO_INCREMENT PRIMARY KEY,
  file_name VARCHAR(255) NOT NULL UNIQUE,
  status ENUM('running','completed','failed') NOT NULL DEFAULT 'running',
  type ENUM('full','db','files') NOT NULL DEFAULT 'full',
  kind ENUM('manual','auto','safety','upload','registered') NOT NULL DEFAULT 'manual',
  note VARCHAR(500) NULL,
  tables_n INT NULL, rows_n INT NULL, files_n INT NULL, missing_files INT NULL,
  size BIGINT NULL,
  encrypted TINYINT(1) NOT NULL DEFAULT 1,
  key_fp VARCHAR(20) NULL,
  checksum CHAR(64) NULL,
  error VARCHAR(1000) NULL,
  created_by INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS restores (
  id INT AUTO_INCREMENT PRIMARY KEY,
  backup_id INT NULL,
  file_name VARCHAR(255) NULL,
  status ENUM('running','completed','failed') NOT NULL DEFAULT 'running',
  user_id INT NULL,
  details VARCHAR(1000) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS languages (
  code VARCHAR(10) PRIMARY KEY,
  name_native VARCHAR(60) NOT NULL,
  name_en VARCHAR(60) NOT NULL,
  dir ENUM('rtl','ltr') NOT NULL DEFAULT 'ltr',
  font VARCHAR(100) NULL,
  flag VARCHAR(16) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS translation_overrides (
  lang VARCHAR(10) NOT NULL,
  tkey VARCHAR(120) NOT NULL,
  value TEXT NOT NULL,
  updated_by INT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (lang, tkey)
);
