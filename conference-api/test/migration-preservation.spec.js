import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { expect, it } from "vitest";

it("preserves existing attendees and identifies historical ambiguous orders without bulk email jobs", async () => {
  const db = env.MIGRATION_TEST_DB;
  await applyD1Migrations(db, env.TEST_MIGRATIONS.filter(migration => parseInt(migration.name, 10) <= 10));
  await db.batch([
    db.prepare(`INSERT INTO registrations (registration_code, submission_key, first_name, last_name, email,
      amount_due_cents, status, dietary_restrictions, accommodation_details, admin_notes)
      VALUES ('HACXI-LEGACY', 'local-migration-key', 'Existing', 'Attendee', 'existing@example.invalid', 2500, 'confirmed',
        'Wheelchair access', 'Wheelchair access', 'Existing private committee note')`),
    db.prepare(`INSERT INTO processed_stripe_events (event_id, event_type, stripe_object_id, livemode, stripe_created_at)
      VALUES ('evt_localmigration', 'checkout.session.completed', 'cs_live_localmigration', 1, unixepoch())`),
    db.prepare(`INSERT INTO orders (stripe_event_id, stripe_session_id, livemode, payment_status, currency,
      amount_subtotal, amount_total, customer_email, shipping_name, shipping_line1, shipping_city,
      shipping_state, shipping_postal_code, shipping_country, paid_at, fulfillment_status, fulfillment_attempts)
      VALUES ('evt_localmigration', 'cs_live_localmigration', 1, 'paid', 'usd', 3000, 3000,
        'existing@example.invalid', 'Existing Buyer', '123 Local Street', 'KC', 'MO', '64111', 'US', unixepoch(), 'failed', 1)`),
    db.prepare(`INSERT INTO registration_events (registration_id, event_type, actor_type, new_status)
      SELECT id, 'registration_created', 'registrant', 'awaiting_payment' FROM registrations WHERE registration_code = 'HACXI-LEGACY'`),
  ]);
  const before = await db.prepare(`SELECT registration_code, first_name, last_name, email, status,
    dietary_restrictions, accommodation_details, admin_notes FROM registrations`).all();
  await applyD1Migrations(db, env.TEST_MIGRATIONS);
  const after = await db.prepare(`SELECT registration_code, first_name, last_name, email, status,
    dietary_restrictions, accommodation_details, admin_notes FROM registrations`).all();
  expect(after.results).toEqual(before.results);
  expect((await db.prepare("SELECT count(*) AS n FROM registration_events").first()).n).toBe(1);
  expect((await db.prepare("SELECT count(*) AS n FROM registration_confirmation_mail").first()).n).toBe(0);
  const order = await db.prepare("SELECT fulfillment_status, fulfillment_attempts, printify_submission_state, printify_post_started_at FROM orders").first();
  expect(order.fulfillment_status).toBe("failed"); expect(order.fulfillment_attempts).toBe(1);
  expect(order.printify_submission_state).toBe("ambiguous"); expect(order.printify_post_started_at).toBeGreaterThan(0);
});
