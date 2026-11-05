-- Pseudonymous hourly recipient counters; purged on subsequent public traffic.
CREATE TABLE security_recipient_quotas (
  recipient_hash TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  request_count INTEGER NOT NULL CHECK (request_count > 0),
  PRIMARY KEY (recipient_hash, window_start)
);
CREATE INDEX idx_security_recipient_quota_expiry ON security_recipient_quotas(window_start);
