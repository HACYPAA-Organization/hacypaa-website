ALTER TABLE registrations
ADD COLUMN payment_access_token_expires_at INTEGER;

UPDATE registrations
SET payment_access_token_expires_at = unixepoch() + 2592000
WHERE payment_access_token_hash IS NOT NULL;