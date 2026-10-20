-- Self-registration with admin approval.
--   registration_status: PENDING (self-registered, awaiting admin) | APPROVED | REJECTED. Existing users = APPROVED.
--   registration_note:   rejection reason shown to the user at login.
--   registration_details: what the user submitted that has no column (parent: children roll numbers + relation).
-- Each ALTER is conditional so the migration is safe to re-run.

SET @ddl = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'registration_status') = 0,
  "ALTER TABLE users ADD COLUMN registration_status ENUM('PENDING','APPROVED','REJECTED') NOT NULL DEFAULT 'APPROVED' AFTER must_change_password",
  'SELECT 1'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'registration_note') = 0,
  'ALTER TABLE users ADD COLUMN registration_note VARCHAR(500) NULL AFTER registration_status',
  'SELECT 1'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'registration_details') = 0,
  'ALTER TABLE users ADD COLUMN registration_details JSON NULL AFTER registration_note',
  'SELECT 1'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'registration_reviewed_by') = 0,
  'ALTER TABLE users ADD COLUMN registration_reviewed_by INT UNSIGNED NULL AFTER registration_details, ADD COLUMN registration_reviewed_at DATETIME(3) NULL AFTER registration_reviewed_by',
  'SELECT 1'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl = IF(
  (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'users' AND index_name = 'idx_users_registration') = 0,
  'CREATE INDEX idx_users_registration ON users (registration_status, created_at)',
  'SELECT 1'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
