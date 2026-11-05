ALTER TABLE registrations ADD COLUMN confirmation_mail_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE registrations ADD COLUMN confirmation_email_sent_at INTEGER;
ALTER TABLE registrations ADD COLUMN confirmation_email_delivery_status TEXT;

CREATE TABLE registration_confirmation_mail (
  id TEXT PRIMARY KEY,
  registration_id INTEGER NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'needs_review', 'canceled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  first_attempt_at INTEGER,
  last_attempt_at INTEGER,
  next_attempt_at INTEGER NOT NULL DEFAULT (unixepoch()),
  lease_token TEXT,
  lease_until INTEGER,
  provider_id TEXT,
  delivery_status TEXT,
  delivery_event_id TEXT,
  delivery_event_at INTEGER,
  sent_at INTEGER,
  last_error_code TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE UNIQUE INDEX idx_registration_confirmation_active
ON registration_confirmation_mail(registration_id)
WHERE status IN ('pending', 'sending', 'failed', 'needs_review');
CREATE INDEX idx_registration_confirmation_due
ON registration_confirmation_mail(status, next_attempt_at);
