import { auditRetentionSeconds } from "./registration-audit.js";
import { hashValue, InputError } from "./request-security.js";

const RETRY_WINDOW = 23 * 3600; // Resend keeps idempotency keys for 24 hours.
const MAX_ATTEMPTS = 8;

export function confirmationStatements(env, change, jobId) {
  const db = env.ORDERS_DB;
  if (change.nextStatus === "confirmed") return [db.prepare(`INSERT INTO registration_confirmation_mail (id, registration_id)
    SELECT ?, id FROM registrations WHERE id = ? AND admin_revision = ? AND status = 'confirmed'
    AND EXISTS (SELECT 1 FROM registration_admin_audit WHERE id = ?)`)
    .bind(jobId, change.registration.id, change.nextRevision, change.changeId)];
  return [db.prepare(`UPDATE registration_confirmation_mail SET status = 'canceled', lease_token = NULL, lease_until = NULL
    WHERE registration_id = ? AND status IN ('pending', 'sending', 'failed', 'needs_review')
    AND EXISTS (SELECT 1 FROM registration_admin_audit WHERE id = ?)`)
    .bind(change.registration.id, change.changeId)];
}

export async function latestConfirmation(db, registrationId) {
  return db.prepare("SELECT * FROM registration_confirmation_mail WHERE registration_id = ? ORDER BY rowid DESC LIMIT 1").bind(registrationId).first();
}

export function confirmationState(job) {
  return job ? { status: job.status, deliveryStatus: job.delivery_status || null, sentAt: job.sent_at,
    deliveryUpdatedAt: job.delivery_event_at ? Math.floor(job.delivery_event_at / 1000) : null,
    attempts: job.attempts, nextAttemptAt: job.next_attempt_at, errorCode: job.last_error_code || null } : { status: "untracked" };
}

export function registrationDeliveryStatement(db, jobId) {
  // An older email's late event must not replace the latest resend's summary.
  return db.prepare(`UPDATE registrations SET
    confirmation_email_sent_at = (SELECT sent_at FROM registration_confirmation_mail WHERE id = ?),
    confirmation_email_delivery_status = (SELECT delivery_status FROM registration_confirmation_mail WHERE id = ?)
    WHERE id = (SELECT registration_id FROM registration_confirmation_mail WHERE id = ? AND status = 'sent')
    AND (SELECT id FROM registration_confirmation_mail WHERE registration_id = registrations.id ORDER BY rowid DESC LIMIT 1) = ?`)
    .bind(jobId, jobId, jobId, jobId);
}

export async function processConfirmationEmail(env, jobId, send) {
  const db = env.ORDERS_DB, now = Math.floor(Date.now() / 1000);
  let job = await db.prepare("SELECT * FROM registration_confirmation_mail WHERE id = ?").bind(jobId).first();
  if (!job || ["sent", "canceled", "needs_review"].includes(job.status)) return confirmationState(job);
  if (job.first_attempt_at != null && (job.first_attempt_at <= now - RETRY_WINDOW || job.attempts >= MAX_ATTEMPTS)) {
    await db.prepare(`UPDATE registration_confirmation_mail SET status = 'needs_review', last_error_code = 'retry_window_or_attempt_limit',
      lease_token = NULL, lease_until = NULL WHERE id = ? AND status <> 'sent' AND coalesce(lease_until, 0) <= ?`).bind(jobId, now).run();
    return confirmationState(await db.prepare("SELECT * FROM registration_confirmation_mail WHERE id = ?").bind(jobId).first());
  }
  const leaseToken = crypto.randomUUID();
  const claim = await db.prepare(`UPDATE registration_confirmation_mail SET status = 'sending',
    lease_token = ?, lease_until = ? + 120, attempts = attempts + 1,
    first_attempt_at = coalesce(first_attempt_at, ?), last_attempt_at = ?
    WHERE id = ? AND next_attempt_at <= ? AND coalesce(lease_until, 0) <= ?
    AND status IN ('pending', 'failed', 'sending') AND attempts < ?
    AND EXISTS (SELECT 1 FROM registrations r WHERE r.id = registration_id AND r.status = 'confirmed')`)
    .bind(leaseToken, now, now, now, jobId, now, now, MAX_ATTEMPTS).run();
  if (claim.meta.changes !== 1) return confirmationState(job);
  const registration = await db.prepare(`SELECT r.registration_code AS registrationCode, r.first_name AS firstName,
    r.email, r.amount_due_cents AS amountDueCents FROM registrations r JOIN registration_confirmation_mail j
    ON j.registration_id = r.id WHERE j.id = ? AND j.lease_token = ? AND r.status = 'confirmed'`).bind(jobId, leaseToken).first();
  if (!registration) {
    await db.prepare("UPDATE registration_confirmation_mail SET status = 'canceled', lease_token = NULL, lease_until = NULL WHERE id = ? AND lease_token = ?").bind(jobId, leaseToken).run();
    return { status: "canceled" };
  }
  try {
    const providerId = await send(env, { ...registration, confirmationJobId: jobId, confirmationIdempotencyKey: "prereg-confirmation/" + jobId });
    const results = await db.batch([
      db.prepare(`UPDATE registration_confirmation_mail SET status = 'sent', provider_id = ?,
        delivery_status = coalesce(delivery_status, 'sent'), sent_at = coalesce(sent_at, ?),
        lease_token = NULL, lease_until = NULL, last_error_code = NULL WHERE id = ? AND lease_token = ?`)
        .bind(providerId, now, jobId, leaseToken),
      registrationDeliveryStatement(db, jobId),
    ]);
    if (results[0].meta.changes !== 1) throw new Error("Confirmation delivery tracking was not recorded");
  } catch {
    const delay = Math.min(3600, 60 * 2 ** job.attempts);
    // If tracking fails after acceptance, retry the same provider idempotency key.
    try {
      await db.prepare(`UPDATE registration_confirmation_mail SET status = 'failed', next_attempt_at = ?,
        last_error_code = 'delivery_or_tracking_failed', lease_token = NULL, lease_until = NULL WHERE id = ? AND lease_token = ?`)
        .bind(now + delay, jobId, leaseToken).run();
    } catch { console.error("Confirmation mail tracking unavailable", { jobId }); }
  }
  job = await db.prepare("SELECT * FROM registration_confirmation_mail WHERE id = ?").bind(jobId).first();
  return confirmationState(job);
}

export async function queueManualConfirmation(env, code, actor, { resend = false, requestKey } = {}) {
  const db = env.ORDERS_DB, now = Math.floor(Date.now() / 1000);
  const registration = await db.prepare(`SELECT id, status, confirmation_mail_revision AS revision,
    confirmation_email_sent_at AS sentAt FROM registrations WHERE registration_code = ?`).bind(code).first();
  if (!registration) throw new InputError("Registration not found", 404);
  if (registration.status !== "confirmed") throw new InputError("Only confirmed registrations can receive a confirmation email", 409);
  if (requestKey) {
    const repeat = await db.prepare("SELECT * FROM registration_confirmation_mail WHERE id = ? AND registration_id = ?").bind(requestKey, registration.id).first();
    if (repeat) return repeat;
  }
  const previous = await latestConfirmation(db, registration.id);
  if (previous && ["pending", "sending", "failed"].includes(previous.status) &&
    (!previous.first_attempt_at || (previous.first_attempt_at > now - RETRY_WINDOW && previous.attempts < MAX_ATTEMPTS))) {
    if (previous.status === "failed") await db.prepare("UPDATE registration_confirmation_mail SET next_attempt_at = ? WHERE id = ? AND status = 'failed'").bind(now, previous.id).run();
    return previous;
  }
  if (previous?.status === "sent" && !resend) return previous;
  if (!resend) throw new InputError("Delivery history is unavailable or the safe retry window has ended. An explicit resend may send another email.", 409);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestKey || "")) {
    throw new InputError("A unique resend request key is required");
  }
  if (previous?.created_at > now - 60) throw new InputError("Please wait a minute before sending another confirmation", 429);
  const subject = await hashValue("registration:" + code), changeId = crypto.randomUUID();
  const result = await db.batch([
    db.prepare(`INSERT INTO registration_admin_audit (id, subject_ref, actor_kind, actor_ref, action, previous_status, new_status, expires_at)
      SELECT ?, ?, 'admin', ?, 'confirmation_email_resent', status, status, unixepoch() + ?
      FROM registrations WHERE id = ? AND status = 'confirmed' AND confirmation_mail_revision = ?`)
      .bind(changeId, subject, actor, auditRetentionSeconds(env), registration.id, registration.revision),
    db.prepare(`UPDATE registrations SET confirmation_mail_revision = confirmation_mail_revision + 1
      WHERE id = ? AND confirmation_mail_revision = ? AND EXISTS (SELECT 1 FROM registration_admin_audit WHERE id = ?)`)
      .bind(registration.id, registration.revision, changeId),
    db.prepare(`UPDATE registration_confirmation_mail SET status = 'canceled', lease_token = NULL, lease_until = NULL
      WHERE registration_id = ? AND status IN ('failed', 'needs_review') AND EXISTS (SELECT 1 FROM registration_admin_audit WHERE id = ?)`)
      .bind(registration.id, changeId),
    db.prepare(`INSERT INTO registration_confirmation_mail (id, registration_id) SELECT ?, id FROM registrations
      WHERE id = ? AND confirmation_mail_revision = ? AND EXISTS (SELECT 1 FROM registration_admin_audit WHERE id = ?)`)
      .bind(requestKey, registration.id, registration.revision + 1, changeId),
  ]);
  if (result[1].meta.changes !== 1) throw new InputError("Another email action is in progress. Refresh and try again.", 409);
  return db.prepare("SELECT * FROM registration_confirmation_mail WHERE id = ?").bind(requestKey).first();
}

export async function refreshConfirmationDelivery(env, code) {
  const job = await env.ORDERS_DB.prepare(`SELECT j.* FROM registration_confirmation_mail j JOIN registrations r
    ON r.id = j.registration_id WHERE r.registration_code = ? ORDER BY j.rowid DESC LIMIT 1`).bind(code).first();
  if (!job) throw new InputError("No tracked email is available for a delivery check", 404);
  // Signed delivery events maintain this state; sending-only API keys need no read permission.
  return confirmationState(job);
}

export async function retryDueConfirmations(env, send) {
  const due = await env.ORDERS_DB.prepare(`SELECT id FROM registration_confirmation_mail WHERE
    status IN ('pending', 'failed', 'sending') AND next_attempt_at <= unixepoch()
    AND coalesce(lease_until, 0) <= unixepoch() ORDER BY next_attempt_at LIMIT 20`).all();
  for (const job of due.results) {
    try { await processConfirmationEmail(env, job.id, send); }
    catch { console.error("Confirmation retry unavailable", { jobId: job.id }); }
  }
}
