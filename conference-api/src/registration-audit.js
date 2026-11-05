import { hashValue, InputError } from "./request-security.js";

export function auditRetentionSeconds(env) {
  const days = Number(env.ADMIN_AUDIT_RETENTION_DAYS || 365);
  if (!Number.isInteger(days) || days < 1 || days > 3650) throw new Error("Invalid audit retention policy");
  return days * 86400;
}

export async function changeRegistrationStatus(env, code, nextStatus, actor, extraStatements = () => []) {
  const db = env.ORDERS_DB;
  const registration = await db.prepare(`SELECT id, registration_code AS registrationCode,
    first_name AS firstName, email, status, amount_due_cents AS amountDueCents,
    confirmed_at AS confirmedAt, admin_revision AS revision FROM registrations WHERE registration_code = ?`).bind(code).first();
  if (!registration) throw new InputError("Registration not found", 404);
  if (registration.status === nextStatus) return { registration, changed: false, now: Math.floor(Date.now() / 1000) };
  const now = Math.floor(Date.now() / 1000), subject = await hashValue("registration:" + code), changeId = crypto.randomUUID();
  const audit = db.prepare(`INSERT INTO registration_admin_audit
    (id, subject_ref, actor_kind, actor_ref, action, previous_status, new_status, expires_at)
    SELECT ?, ?, 'admin', ?, 'payment_status_changed', status, ?, unixepoch() + ?
    FROM registrations WHERE registration_code = ? AND admin_revision = ?`)
    .bind(changeId, subject, actor, nextStatus, auditRetentionSeconds(env), code, registration.revision);
  const update = db.prepare(`UPDATE registrations SET status = ?, confirmed_at = ?, confirmed_by_user_id = ?,
    updated_at = ?, admin_revision = admin_revision + 1 WHERE registration_code = ? AND admin_revision = ?`)
    .bind(nextStatus, nextStatus === "confirmed" ? now : null, nextStatus === "confirmed" ? actor : null,
      now, code, registration.revision);
  const results = await db.batch([audit, update, ...extraStatements({ registration, now, nextStatus, changeId, nextRevision: registration.revision + 1 })]);
  if (results[1]?.meta?.changes !== 1) throw new InputError("Registration changed while you were editing. Refresh and try again.", 409);
  return { changed: true, now, registration: { ...registration, status: nextStatus,
    confirmedAt: nextStatus === "confirmed" ? now : null, confirmedByUserId: nextStatus === "confirmed" ? actor : null,
    revision: registration.revision + 1 } };
}

export async function deleteRegistrationWithAudit(env, code, actor) {
  const db = env.ORDERS_DB, subject = await hashValue("registration:" + code), retention = auditRetentionSeconds(env);
  const results = await db.batch([
    db.prepare(`INSERT INTO registration_admin_audit
      (id, subject_ref, actor_kind, actor_ref, action, previous_status, new_status, expires_at)
      SELECT ?, ?, 'admin', ?, 'registration_deleted', status, NULL, unixepoch() + ?
      FROM registrations WHERE registration_code = ?`).bind(crypto.randomUUID(), subject, actor, retention, code),
    db.prepare(`INSERT INTO registration_admin_audit
      (id, subject_ref, actor_kind, actor_ref, action, previous_status, new_status, created_at, expires_at)
      SELECT 'event/' || ? || '/' || e.id, ?, e.actor_type,
        CASE WHEN e.actor_admin_id IS NULL THEN NULL ELSE 'legacy:' || e.actor_admin_id END,
        e.event_type, e.previous_status, e.new_status, e.created_at, e.created_at + ?
      FROM registration_events e JOIN registrations r ON r.id = e.registration_id
      WHERE r.registration_code = ? AND e.created_at + ? > unixepoch()
      ON CONFLICT(id) DO NOTHING`).bind(subject, subject, retention, code, retention),
    db.prepare(`INSERT INTO registration_admin_audit
      (id, subject_ref, actor_kind, action, amount_cents, currency, created_at, expires_at)
      SELECT 'receipt/' || ? || '/' || e.id, ?, 'system', 'receipt_recorded',
        e.amount_paid_cents, e.currency, e.issued_at, e.issued_at + ?
      FROM registration_receipts e JOIN registrations r ON r.id = e.registration_id
      WHERE r.registration_code = ? AND e.issued_at + ? > unixepoch()
      ON CONFLICT(id) DO NOTHING`).bind(subject, subject, retention, code, retention),
    db.prepare("DELETE FROM registration_events WHERE registration_id IN (SELECT id FROM registrations WHERE registration_code = ?)").bind(code),
    db.prepare("DELETE FROM registration_receipts WHERE registration_id IN (SELECT id FROM registrations WHERE registration_code = ?)").bind(code),
    db.prepare("DELETE FROM registrations WHERE registration_code = ?").bind(code),
  ]);
  if (!results.at(-1)?.meta?.changes) throw new InputError("Registration not found", 404);
}

export async function pruneSecurityHistory(db) {
  await db.batch([
    db.prepare("DELETE FROM registration_admin_audit WHERE expires_at <= unixepoch()"),
    db.prepare("DELETE FROM security_recipient_quotas WHERE window_start < unixepoch() - 86400"),
  ]);
}
