-- Daily (recurring) passes. Backward compatible: existing requests become ONE_TIME, existing trips get their
-- own window copied from their request, and every statement is conditional so the migration can be re-run.

-- 1) outpass_requests.pass_type + daily categories
SET @ddl = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'outpass_requests' AND column_name = 'pass_type') = 0,
  "ALTER TABLE outpass_requests ADD COLUMN pass_type ENUM('ONE_TIME','DAILY') NOT NULL DEFAULT 'ONE_TIME' AFTER student_id",
  'SELECT 1'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

ALTER TABLE outpass_requests MODIFY COLUMN reason_category
  ENUM('HOME_VISIT','MEDICAL','FAMILY_EVENT','ACADEMIC','PERSONAL','SHOPPING','OTHER','COLLEGE_WORK','INTERNSHIP','TUITION','SPORTS') NOT NULL;

-- 2) Schedule of a daily pass (one row per DAILY request)
CREATE TABLE IF NOT EXISTS outpass_schedules (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  request_id INT UNSIGNED NOT NULL,
  dest_name VARCHAR(160) NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  days_of_week SET('MON','TUE','WED','THU','FRI','SAT','SUN') NOT NULL,
  depart_time TIME NOT NULL,
  return_time TIME NOT NULL,
  status ENUM('ACTIVE','PAUSED','CANCELLED','EXPIRED') NOT NULL DEFAULT 'ACTIVE',
  consent_granted_at DATETIME(3) NULL,
  consent_revoked_at DATETIME(3) NULL,
  status_changed_by INT UNSIGNED NULL,
  status_changed_at DATETIME(3) NULL,
  status_note VARCHAR(500) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_schedules_request (request_id),
  KEY idx_schedules_status (status, start_date, end_date),
  CONSTRAINT fk_schedules_request FOREIGN KEY (request_id) REFERENCES outpass_requests(id) ON DELETE CASCADE,
  CONSTRAINT fk_schedules_changed_by FOREIGN KEY (status_changed_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 3) trips: per-day date + window, NO_SHOW status
SET @ddl = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'trips' AND column_name = 'trip_date') = 0,
  'ALTER TABLE trips ADD COLUMN trip_date DATE NULL AFTER request_id, ADD COLUMN window_start DATETIME(3) NULL AFTER trip_date, ADD COLUMN window_end DATETIME(3) NULL AFTER window_start',
  'SELECT 1'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

ALTER TABLE trips MODIFY COLUMN status ENUM('APPROVED','ACTIVE','OVERDUE','COMPLETED','CANCELLED','NO_SHOW') NOT NULL DEFAULT 'APPROVED';

-- Backfill existing trips from their request (campus local date, IST = UTC+05:30).
UPDATE trips t JOIN outpass_requests o ON o.id = t.request_id
SET t.trip_date = COALESCE(t.trip_date, DATE(DATE_ADD(o.depart_at, INTERVAL 330 MINUTE))),
    t.window_start = COALESCE(t.window_start, o.depart_at),
    t.window_end = COALESCE(t.window_end, o.expected_return_at);

ALTER TABLE trips MODIFY COLUMN trip_date DATE NOT NULL, MODIFY COLUMN window_start DATETIME(3) NOT NULL, MODIFY COLUMN window_end DATETIME(3) NOT NULL;

-- Replace UNIQUE(request_id) with UNIQUE(request_id, trip_date). Add the new key first so the FK always has an index.
SET @ddl = IF(
  (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'trips' AND index_name = 'uq_trips_request_date') = 0,
  'ALTER TABLE trips ADD UNIQUE KEY uq_trips_request_date (request_id, trip_date)',
  'SELECT 1'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl = IF(
  (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'trips' AND index_name = 'uq_trips_request') > 0,
  'ALTER TABLE trips DROP INDEX uq_trips_request',
  'SELECT 1'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl = IF(
  (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'trips' AND index_name = 'idx_trips_window') = 0,
  'CREATE INDEX idx_trips_window ON trips (status, window_end)',
  'SELECT 1'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
