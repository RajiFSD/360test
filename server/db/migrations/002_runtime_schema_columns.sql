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
