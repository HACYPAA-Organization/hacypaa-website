ALTER TABLE orders ADD COLUMN printify_submission_state TEXT NOT NULL DEFAULT 'new'
  CHECK (printify_submission_state IN ('new', 'post_started', 'accepted', 'ambiguous', 'needs_review'));
ALTER TABLE orders ADD COLUMN printify_post_started_at INTEGER;
ALTER TABLE orders ADD COLUMN last_printify_reconciliation_at INTEGER;
ALTER TABLE orders ADD COLUMN printify_reconciliation_page INTEGER NOT NULL DEFAULT 1
  CHECK (printify_reconciliation_page > 0);

-- Older attempted orders without a saved remote ID may already exist remotely.
-- Never treat these as safe new submissions after this migration.
UPDATE orders SET printify_submission_state = 'ambiguous',
  printify_post_started_at = updated_at
WHERE fulfillment_attempts > 0 AND printify_order_id IS NULL;
UPDATE orders SET printify_submission_state = 'accepted'
WHERE printify_order_id IS NOT NULL;
