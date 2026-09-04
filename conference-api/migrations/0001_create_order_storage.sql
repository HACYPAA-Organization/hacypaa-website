-- Migration number: 0001 	 2026-08-26T19:12:28.329Z
CREATE TABLE processed_stripe_events (
    event_id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    stripe_object_id TEXT NOT NULL,
    livemode INTEGER NOT NULL CHECK (livemode IN (0, 1)),
    stripe_created_at INTEGER NOT NULL,
    processed_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_processed_stripe_events_object
ON processed_stripe_events (event_type, stripe_object_id);

CREATE TABLE orders (
    id INTEGER PRIMARY KEY,
    stripe_event_id TEXT NOT NULL UNIQUE,
    stripe_session_id TEXT NOT NULL UNIQUE,
    stripe_payment_intent_id TEXT UNIQUE,
    stripe_customer_id TEXT,
    livemode INTEGER NOT NULL CHECK (livemode IN (0, 1)),
    payment_status TEXT NOT NULL CHECK (payment_status = 'paid'),
    currency TEXT NOT NULL CHECK (length(currency) = 3),

    amount_subtotal INTEGER NOT NULL CHECK (amount_subtotal >= 0),
    amount_shipping INTEGER NOT NULL DEFAULT 0
        CHECK (amount_shipping >= 0),
    amount_tax INTEGER NOT NULL DEFAULT 0
        CHECK (amount_tax >= 0),
    amount_discount INTEGER NOT NULL DEFAULT 0
        CHECK (amount_discount >= 0),
    amount_total INTEGER NOT NULL CHECK (amount_total >= 0),

    customer_email TEXT NOT NULL,
    customer_name TEXT,
    customer_phone TEXT,

    shipping_name TEXT NOT NULL,
    shipping_line1 TEXT NOT NULL,
    shipping_line2 TEXT,
    shipping_city TEXT NOT NULL,
    shipping_state TEXT NOT NULL,
    shipping_postal_code TEXT NOT NULL,
    shipping_country TEXT NOT NULL
        CHECK (length(shipping_country) = 2),

    fulfillment_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (
            fulfillment_status IN (
                'pending',
                'submitting',
                'submitted',
                'failed',
                'canceled',
                'fulfilled'
            )
        ),
    fulfillment_attempts INTEGER NOT NULL DEFAULT 0
        CHECK (fulfillment_attempts >= 0),
    last_fulfillment_error TEXT,
    
    printify_order_id TEXT UNIQUE,
    printify_status TEXT,
    printify_submitted_at INTEGER,

    paid_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch()),

    FOREIGN KEY (stripe_event_id)
        REFERENCES processed_stripe_events(event_id)
        ON DELETE RESTRICT
);

CREATE INDEX idx_orders_fulfillment
ON orders (fulfillment_status, created_at);

CREATE TABLE order_items (
    id INTEGER PRIMARY KEY,
    order_id INTEGER NOT NULL,
    stripe_line_item_id TEXT NOT NULL UNIQUE,

    printify_product_id TEXT NOT NULL,
    printify_variant_id INTEGER NOT NULL
        CHECK (printify_variant_id > 0),

    product_title TEXT NOT NULL,
    variant_title TEXT,

    quantity INTEGER NOT NULL
        CHECK (quantity BETWEEN 1 AND 10),
    unit_amount INTEGER NOT NULL
        CHECK (unit_amount > 0),
    amount_total INTEGER NOT NULL
        CHECK (amount_total >= 0),

    created_at INTEGER NOT NULL DEFAULT (unixepoch()),

    FOREIGN KEY (order_id)
        REFERENCES orders(id)
        ON DELETE RESTRICT,
    
    UNIQUE (
        order_id,
        printify_product_id,
        printify_variant_id
    )
);