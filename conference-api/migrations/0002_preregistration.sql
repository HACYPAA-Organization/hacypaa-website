-- Migration number: 0002 2026-09-04

CREATE TABLE prereg_admins (
    id INTEGER PRIMARY KEY,

    google_subject TEXT UNIQUE,
    email TEXT NOT NULL COLLATE NOCASE UNIQUE,
    display_name TEXT NOT NULL,

    is_active INTEGER NOT NULL DEFAULT 1
        CHECK (is_active IN (0, 1)),

    last_login_at INTEGER,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE registrations (
    id INTEGER PRIMARY KEY,

    registration_code TEXT NOT NULL COLLATE NOCASE UNIQUE,
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
                'confirmed'<
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
            OR payment_method IN ('venmo', 'cash_app')
        ),

    payment_sender_handle TEXT,
    payment_reference TEXT,
    payment_reported_at INTEGER,

    amount_paid_cents INTEGER
        CHECK (
            amount_paid_cents IS NULL
            or amount_paid_cents >= 0
        ),

    confirmed_at INTEGER,
    confirmed_by INTEGER,

    attendee_notes TEXT,
    admin_notes TEXT,

    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch()),

    FOREIGN KEY (confirmed_by)
        REFERENCES prereg_admins(id)
        ON DELETE RESTRICT
);

CREATE TABLE registration_events (
    id INTEGER PRIMARY KEY,
    registration_id INTEGER NOT NULL,

    event_type TEXT NOT NULL,

    actor_type TEXT NOT NULL
        CHECK (
            actor_type IN ('registrant', 'admin', 'system')
        ),

    actor_admin_id INTEGER,

    previous_status TEXT,
    new_status TEXT,

    note TEXT,
    details_json TEXT
        CHECK (
            details_json IS NULL
            OR json_valid(details_json)
        ),

    created_at INTEGER NOT NULL DEFAULT (unixepoch()),

    FOREIGN KEY (registration_id)
        REFERENCES registrations(id)
        ON DELETE RESTRICT,

    FOREIGN KEY (actor_admin_id)
        REFERENCES prereg_admins(id)
        ON DELETE RESTRICT,

    CHECK (
        (
            actor_type = 'admin'
            AND actor_admin_id IS NOT NULL
        )
        OR
        (
            actor_type IN ('registrant', 'system')
            AND actor_admin_id IS NULL
        )
    )
);

CREATE INDEX idx_registrations_status_created
ON registrations (status, created_at);

CREATE INDEX idx_registrations_email
ON REGISTRATIONS (email);

CREATE INDEX idx_registrations_events_registration
ON registration_events (registration_id, created_at);

PRAGMA optimize;