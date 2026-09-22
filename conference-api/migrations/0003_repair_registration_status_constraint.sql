-- Migration number: 0003 	 2026-09-12T19:54:48.412Z
PRAGMA defer_foreign_keys = ON;

CREATE TABLE registrations_repaired (
    id INTEGER PRIMARY KEY,

    registration_code TEXT NOT NULL
        COLLATE NOCASE UNIQUE,

    submission_key TEXT NOT NULL UNIQUE,

    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    badge_name TEXT,

    email TEXT NOT NULL COLLATE NOCASE,
    phone TEXT,
    city TEXT,
    state TEXT,
    home_group TEXT,

    status TEXT NOT NULL DEFAULT 'awaiting_payment'
        CHECK (
            status IN (
                'awaiting_payment',
                'payment_reported',
                'confirmed',
                'payment_not_found',
                'cancelled'
            )
        ),

        amount_due_cents INTEGER NOT NULL
            CHECK (amount_due_cents >= 0),

        currency TEXT NOT NULL DEFAULT 'usd'
            CHECK (length(currency) = 3),

        payment_method TEXT
            CHECK (
                payment_method IS NULL
                OR payment_method IN (
                    'venmo',
                    'cash_app'
                )
            ),

        payment_sender_handle TEXT,
        payment_reference TEXT,
        payment_reported_at INTEGER,

        amount_paid_cents INTEGER
            CHECK (
                amount_paid_cents IS NULL
                OR amount_paid_cents >= 0
            ),

        confirmed_at INTEGER,
        confirmed_by INTEGER,

        attendee_notes TEXT,
        admin_notes TEXT,

        created_at INTEGER NOT NULL
            DEFAULT (unixepoch()),

        updated_at INTEGER NOT NULL
            DEFAULT (unixepoch()),

        FOREIGN KEY (confirmed_by)
            REFERENCES prereg_admins(id)
            ON DELETE RESTRICT
);

INSERT INTO registrations_repaired (
    id,
    registration_code,
    submission_key,
    first_name,
    last_name,
    badge_name,
    email,
    phone,
    city,
    state,
    home_group,
    status,
    amount_due_cents,
    currency,
    payment_method,
    payment_sender_handle,
    payment_reference,
    payment_reported_at,
    amount_paid_cents,
    confirmed_at,
    confirmed_by,
    attendee_notes,
    created_at,
    updated_at
)
SELECT
    id,
    registration_code,
    submission_key,
    first_name,
    last_name,
    badge_name,
    email,
    phone,
    city,
    state,
    home_group,
    status,
    amount_due_cents,
    currency,
    payment_method,
    payment_sender_handle,
    payment_reference,
    payment_reported_at,
    amount_paid_cents,
    confirmed_at,
    confirmed_by,
    attendee_notes,
    created_at,
    updated_at
FROM registrations;

DROP TABLE registrations;

ALTER TABLE registrations_repaired
    RENAME TO registrations;

CREATE INDEX idx_registrations_status_created_at
    ON registrations(status, created_at DESC);

CREATE INDEX idx_registrations_email
    ON registrations(email);

PRAGMA defer_foreign_keys = OFF;
