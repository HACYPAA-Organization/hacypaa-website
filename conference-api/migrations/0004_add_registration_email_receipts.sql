ALTER TABLE registrations
    ADD COLUMN payment_access_token_hash TEXT;

ALTER TABLE registrations
    ADD COLUMN registration_email_sent_at INTEGER;

ALTER TABLE registrations
    ADD COLUMN payment_report_email_sent_at INTEGER;

CREATE UNIQUE INDEX
    idx_registrations_payment_access_token_has
ON registrations(payment_access_token_hash)
WHERE payment_access_token_hash IS NOT NULL;

CREATE TABLE registration_receipts (
    id INTEGER PRIMARY KEY,

    registration_id INTEGER NOT NULL,

    receipt_number TEXT NOT NULL UNIQUE,

    amount_paid_cents INTEGER NOT NULL
        CHECK (amount_paid_cents >= 0),

    currency TEXT NOT NULL
        CHECK (length(currency) = 3),

    payment_method TEXT,

    payment_reference TEXT,

    issued_at INTEGER NOT NULL
        DEFAULT (unixepoch()),

    voided_at INTEGER,

    email_sent_at INTEGER,

    FOREIGN KEY (registration_id)
        REFERENCES registrations(id)
        ON DELETE RESTRICT
);

CREATE UNIQUE INDEX
    idx_registrations_receipts_active
ON registration_receipts(registration_id)
WHERE voided_at IS NULL;
