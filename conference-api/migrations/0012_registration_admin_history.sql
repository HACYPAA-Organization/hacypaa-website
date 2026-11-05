ALTER TABLE registrations ADD COLUMN admin_revision INTEGER NOT NULL DEFAULT 0;
-- Supabase UUIDs cannot be stored in the legacy integer confirmed_by FK.
ALTER TABLE registrations ADD COLUMN confirmed_by_user_id TEXT;

CREATE TABLE registration_admin_audit (
  id TEXT PRIMARY KEY,
  subject_ref TEXT NOT NULL,
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('admin', 'registrant', 'system')),
  actor_ref TEXT,
  action TEXT NOT NULL,
  previous_status TEXT,
  new_status TEXT,
  amount_cents INTEGER,
  currency TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_registration_admin_audit_subject ON registration_admin_audit(subject_ref, created_at);
CREATE INDEX idx_registration_admin_audit_expiry ON registration_admin_audit(expires_at);
CREATE TRIGGER registration_admin_audit_immutable
BEFORE UPDATE ON registration_admin_audit BEGIN
  SELECT RAISE(ABORT, 'Administrative history is immutable');
END;
CREATE TRIGGER registration_admin_audit_retention
BEFORE DELETE ON registration_admin_audit WHEN OLD.expires_at > unixepoch() BEGIN
  SELECT RAISE(ABORT, 'Administrative history is within retention');
END;
