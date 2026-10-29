ALTER TABLE orders
ADD COLUMN printify_shipping_method INTEGER NOT NULL DEFAULT 1
CHECK (printify_shipping_method IN (1, 4));