-- SmartOutpass full schema (generated from db/migrations by `npm run db:schema`; do not edit by hand)
-- Usage: mysql -u <user> -p -e "CREATE DATABASE smartoutpass CHARACTER SET utf8mb4" && mysql -u <user> -p smartoutpass < db/schema.sql
SET time_zone = '+00:00';

-- ===== 001_init.sql =====
-- SmartOutpass initial schema (MariaDB 10.6+ / MySQL 8+ compatible)
-- All DATETIME columns store UTC.

CREATE TABLE departments (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  code VARCHAR(20) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_departments_code (code),
  UNIQUE KEY uq_departments_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE users (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  role ENUM('student','warden','faculty','security','parent','admin') NOT NULL,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(190) NOT NULL,
  phone VARCHAR(30) NULL,
  password_hash VARCHAR(100) NOT NULL,
  roll_no VARCHAR(40) NULL,
  department_id INT UNSIGNED NULL,
  hostel_id INT UNSIGNED NULL,
  photo_url VARCHAR(500) NULL,
  push_token VARCHAR(255) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_users_email (email),
  UNIQUE KEY uq_users_roll_no (roll_no),
  KEY idx_users_role (role, is_active),
  KEY idx_users_name (name),
  CONSTRAINT fk_users_department FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE hostels (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  warden_id INT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_hostels_name (name),
  CONSTRAINT fk_hostels_warden FOREIGN KEY (warden_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE users
  ADD CONSTRAINT fk_users_hostel FOREIGN KEY (hostel_id) REFERENCES hostels(id) ON DELETE SET NULL;

CREATE TABLE refresh_tokens (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL,
  family_id CHAR(36) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  revoked_at DATETIME(3) NULL,
  replaced_by BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  user_agent VARCHAR(255) NULL,
  ip VARCHAR(64) NULL,
  UNIQUE KEY uq_refresh_hash (token_hash),
  KEY idx_refresh_family (family_id),
  KEY idx_refresh_user (user_id),
  CONSTRAINT fk_refresh_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE parent_student_links (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  parent_id INT UNSIGNED NOT NULL,
  student_id INT UNSIGNED NOT NULL,
  relation VARCHAR(40) NULL,
  verified TINYINT(1) NOT NULL DEFAULT 0,
  verified_by INT UNSIGNED NULL,
  verified_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_parent_student (parent_id, student_id),
  KEY idx_links_student (student_id, verified),
  CONSTRAINT fk_links_parent FOREIGN KEY (parent_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_links_student FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_links_verifier FOREIGN KEY (verified_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE outpass_requests (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  student_id INT UNSIGNED NOT NULL,
  reason VARCHAR(500) NOT NULL,
  reason_category ENUM('HOME_VISIT','MEDICAL','FAMILY_EVENT','ACADEMIC','PERSONAL','SHOPPING','OTHER') NOT NULL,
  destination_type ENUM('HOME','OTHER') NOT NULL,
  dest_address VARCHAR(500) NOT NULL,
  dest_lat DECIMAL(10,7) NOT NULL,
  dest_lng DECIMAL(10,7) NOT NULL,
  depart_at DATETIME(3) NOT NULL,
  expected_return_at DATETIME(3) NOT NULL,
  attachment_url VARCHAR(500) NULL,
  status ENUM('PENDING','APPROVED','REJECTED','CANCELLED','ACTIVE','OVERDUE','COMPLETED','EXPIRED') NOT NULL DEFAULT 'PENDING',
  reviewed_by INT UNSIGNED NULL,
  reviewed_at DATETIME(3) NULL,
  remarks VARCHAR(500) NULL,
  risk_score TINYINT UNSIGNED NULL,
  delay_probability DECIMAL(5,4) NULL,
  predicted_delay_min SMALLINT UNSIGNED NULL,
  risk_reasons JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_outpass_student (student_id, created_at),
  KEY idx_outpass_status (status, created_at),
  KEY idx_outpass_depart (depart_at),
  CONSTRAINT fk_outpass_student FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_outpass_reviewer FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE trips (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  request_id INT UNSIGNED NOT NULL,
  qr_token_id CHAR(36) NOT NULL,
  status ENUM('APPROVED','ACTIVE','OVERDUE','COMPLETED','CANCELLED') NOT NULL DEFAULT 'APPROVED',
  exit_at DATETIME(3) NULL,
  exit_guard_id INT UNSIGNED NULL,
  entry_at DATETIME(3) NULL,
  entry_guard_id INT UNSIGNED NULL,
  left_campus_at DATETIME(3) NULL,
  reached_destination_at DATETIME(3) NULL,
  returned_at DATETIME(3) NULL,
  completed_at DATETIME(3) NULL,
  escalation_level TINYINT UNSIGNED NOT NULL DEFAULT 0,
  dest_streak TINYINT UNSIGNED NOT NULL DEFAULT 0,
  campus_streak TINYINT UNSIGNED NOT NULL DEFAULT 0,
  last_ping_at DATETIME(3) NULL,
  signal_lost_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_trips_request (request_id),
  UNIQUE KEY uq_trips_qr (qr_token_id),
  KEY idx_trips_status (status, last_ping_at),
  CONSTRAINT fk_trips_request FOREIGN KEY (request_id) REFERENCES outpass_requests(id) ON DELETE CASCADE,
  CONSTRAINT fk_trips_exit_guard FOREIGN KEY (exit_guard_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_trips_entry_guard FOREIGN KEY (entry_guard_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- One row per trip event; the UNIQUE key guarantees each event is emitted/notified only once.
CREATE TABLE trip_events (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  trip_id INT UNSIGNED NOT NULL,
  type VARCHAR(40) NOT NULL,
  occurred_at DATETIME(3) NOT NULL,
  data JSON NULL,
  UNIQUE KEY uq_trip_event (trip_id, type),
  CONSTRAINT fk_trip_events_trip FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE tracking_consents (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  trip_id INT UNSIGNED NOT NULL,
  student_id INT UNSIGNED NOT NULL,
  scope VARCHAR(40) NOT NULL DEFAULT 'TRIP_LOCATION',
  consent_text VARCHAR(500) NOT NULL,
  granted_at DATETIME(3) NOT NULL,
  revoked_at DATETIME(3) NULL,
  revoke_reason ENUM('USER','TRIP_COMPLETED','TRIP_CANCELLED') NULL,
  ip VARCHAR(64) NULL,
  user_agent VARCHAR(255) NULL,
  KEY idx_consent_trip (trip_id, revoked_at),
  CONSTRAINT fk_consent_trip FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE,
  CONSTRAINT fk_consent_student FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE location_pings (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  trip_id INT UNSIGNED NOT NULL,
  lat DECIMAL(10,7) NOT NULL,
  lng DECIMAL(10,7) NOT NULL,
  accuracy FLOAT NULL,
  speed FLOAT NULL,
  battery FLOAT NULL,
  recorded_at DATETIME(3) NOT NULL,
  received_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_pings_trip_time (trip_id, recorded_at),
  KEY idx_pings_recorded (recorded_at),
  CONSTRAINT fk_pings_trip FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE geofences (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  type ENUM('CAMPUS','DESTINATION','CUSTOM') NOT NULL,
  shape ENUM('CIRCLE','POLYGON') NOT NULL DEFAULT 'CIRCLE',
  center_lat DECIMAL(10,7) NOT NULL,
  center_lng DECIMAL(10,7) NOT NULL,
  radius_m INT UNSIGNED NULL,
  polygon JSON NULL,
  trip_id INT UNSIGNED NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_geofences_type (type, is_active),
  KEY idx_geofences_trip (trip_id),
  CONSTRAINT fk_geofences_trip FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE gate_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  trip_id INT UNSIGNED NULL,
  guard_id INT UNSIGNED NOT NULL,
  type ENUM('EXIT','ENTRY') NULL,
  scanned_at DATETIME(3) NOT NULL,
  result VARCHAR(40) NOT NULL,
  method ENUM('QR','MANUAL') NOT NULL DEFAULT 'QR',
  note VARCHAR(255) NULL,
  KEY idx_gate_trip (trip_id, type),
  KEY idx_gate_time (scanned_at),
  CONSTRAINT fk_gate_trip FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE SET NULL,
  CONSTRAINT fk_gate_guard FOREIGN KEY (guard_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE notifications (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  trip_id INT UNSIGNED NULL,
  type VARCHAR(40) NOT NULL,
  title VARCHAR(200) NOT NULL,
  body VARCHAR(1000) NOT NULL,
  data JSON NULL,
  channel ENUM('IN_APP','PUSH','SMS') NOT NULL,
  status ENUM('QUEUED','SENT','FAILED','SKIPPED') NOT NULL DEFAULT 'QUEUED',
  error VARCHAR(500) NULL,
  read_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_notifications_user (user_id, channel, created_at),
  KEY idx_notifications_trip (trip_id),
  CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_notifications_trip FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE audit_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  actor_id INT UNSIGNED NULL,
  action VARCHAR(60) NOT NULL,
  entity VARCHAR(40) NULL,
  entity_id VARCHAR(40) NULL,
  details JSON NULL,
  ip VARCHAR(64) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_audit_actor (actor_id, created_at),
  KEY idx_audit_action (action, created_at),
  KEY idx_audit_entity (entity, entity_id),
  CONSTRAINT fk_audit_actor FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE settings (
  `key` VARCHAR(60) PRIMARY KEY,
  `value` VARCHAR(500) NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Historical/synthetic trips used to train the delay model.
CREATE TABLE ai_trip_samples (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  source_trip_id INT UNSIGNED NULL,
  student_id INT UNSIGNED NULL,
  reason_category VARCHAR(20) NOT NULL,
  destination_type ENUM('HOME','OTHER') NOT NULL,
  distance_km FLOAT NOT NULL,
  depart_at DATETIME(3) NOT NULL,
  expected_return_at DATETIME(3) NOT NULL,
  actual_return_at DATETIME(3) NOT NULL,
  requested_at DATETIME(3) NOT NULL,
  approved_at DATETIME(3) NULL,
  day_of_week TINYINT UNSIGNED NOT NULL,
  return_hour TINYINT UNSIGNED NOT NULL,
  duration_hours FLOAT NOT NULL,
  past_delay_rate FLOAT NOT NULL,
  delay_minutes INT NOT NULL,
  is_late TINYINT(1) NOT NULL,
  UNIQUE KEY uq_samples_trip (source_trip_id),
  KEY idx_samples_student (student_id),
  KEY idx_samples_depart (depart_at),
  CONSTRAINT fk_samples_student FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ===== 002_runtime_schema_columns.sql =====
-- Bring databases created by an older version of 001_init.sql up to the
-- schema required by the current jobs, routes, and audit writer.
-- Each ALTER is conditional so this also works on databases where 001
-- already created some (or all) of these columns.

SET @ddl = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'trips' AND column_name = 'escalation_level') = 0,
  'ALTER TABLE trips ADD COLUMN escalation_level TINYINT UNSIGNED NOT NULL DEFAULT 0',
  'SELECT 1'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'trips' AND column_name = 'dest_streak') = 0,
  'ALTER TABLE trips ADD COLUMN dest_streak TINYINT UNSIGNED NOT NULL DEFAULT 0',
  'SELECT 1'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'trips' AND column_name = 'campus_streak') = 0,
  'ALTER TABLE trips ADD COLUMN campus_streak TINYINT UNSIGNED NOT NULL DEFAULT 0',
  'SELECT 1'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'trips' AND column_name = 'last_ping_at') = 0,
  'ALTER TABLE trips ADD COLUMN last_ping_at DATETIME(3) NULL',
  'SELECT 1'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'trips' AND column_name = 'signal_lost_at') = 0,
  'ALTER TABLE trips ADD COLUMN signal_lost_at DATETIME(3) NULL',
  'SELECT 1'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'audit_logs' AND column_name = 'entity') = 0,
  'ALTER TABLE audit_logs ADD COLUMN entity VARCHAR(40) NULL',
  'SELECT 1'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'audit_logs' AND column_name = 'entity_id') = 0,
  'ALTER TABLE audit_logs ADD COLUMN entity_id VARCHAR(40) NULL',
  'SELECT 1'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
