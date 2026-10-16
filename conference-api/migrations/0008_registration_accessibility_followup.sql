ALTER TABLE registrations
ADD COLUMN dietary_restrictions TEXT NOT NULL DEFAULT '';

ALTER TABLE registrations
ADD COLUMN accessibility_contacted_at INTEGER;

ALTER TABLE registrations
ADD COLUMN accessibility_contacted_by TEXT;

ALTER TABLE registrations
ADD COLUMN accessibility_notes TEXT NOT NULL DEFAULT '';

ALTER TABLE registrations
ADD COLUMN accessibility_notification_sent_at INTEGER; 