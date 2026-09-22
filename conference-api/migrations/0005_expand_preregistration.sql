-- Migration number: 0005 	 2026-09-17T17:39:18.336Z
ALTER TABLE registrations
ADD COLUMN phone_number TEXT NOT NULL DEFAULT '';

ALTER TABLE registrations
ADD COLUMN sobriety_date TEXT;

ALTER TABLE registrations
ADD COLUMN location TEXT;

ALTER TABLE registrations
ADD COLUMN fellowship_aa INTEGER NOT NULL DEFAULT 0
CHECK (fellowship_aa IN (0, 1));

ALTER TABLE registrations
ADD COLUMN fellowship_alanon INTEGER NOT NULL DEFAULT 0
CHECK (fellowship_alanon IN (0, 1));

ALTER TABLE registrations
ADD COLUMN accommodation_mobility INTEGER NOT NULL DEFAULT 0
CHECK (accommodation_mobility IN (0, 1));

ALTER TABLE registrations
ADD COLUMN accommodation_asl INTEGER NOT NULL DEFAULT 0
CHECK (accommodation_asl IN (0, 1));

ALTER TABLE registrations
ADD COLUMN accommodation_details TEXT;

ALTER TABLE registrations
ADD COLUMN volunteer_interest INTEGER NOT NULL DEFAULT 0
CHECK (volunteer_interest IN (0, 1));

ALTER TABLE registrations
ADD COLUMN scholarship_donation INTEGER NOT NULL DEFAULT 0
CHECK (scholarship_donation IN (0, 1));

ALTER TABLE registrations
ADD COLUMN preferred_payment_method TEXT NOT NULL DEFAULT ''
CHECK (preferred_payment_method IN ('', 'cash', 'cash_app', 'venmo'));
