CREATE TABLE IF NOT EXISTS panelist_volunteers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    submission_key TEXT NOT NULL UNIQUE,

    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone_number TEXT NOT NULL,

    step_preferences TEXT NOT NULL DEFAULT '[]',
    sobriety_date TEXT NOT NULL,
    has_sponsor INTEGER NOT NULL
        CHECK (has_sponsor IN (0, 1)),
    worked_steps INTEGER NOT NULL
        CHECK (worked_steps IN (0, 1)),

    location TEXT NOT NULL,
    has_home_group INTEGER NOT NULL
        CHECK (has_home_group IN (0, 1)),
    home_group TEXT,
    topic_preferences TEXT,

    status TEXT NOT NULL DEFAULT 'new'
        CHECK (
            status IN (
                'new',
                'contacted',
                'selected',
                'declined'
            )
        ),
    admin_notes TEXT,

    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS
    idx_panelist_volunteers_created_at
ON panelist_volunteers (created_at DESC);

CREATE INDEX IF NOT EXISTS
    idx_panelist_volunteers_status
ON panelist_volunteers (status);