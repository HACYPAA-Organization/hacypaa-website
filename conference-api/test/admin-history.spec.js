import { env } from "cloudflare:workers";
import { beforeAll, afterEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index.js";
import { changeRegistrationStatus, deleteRegistrationWithAudit, pruneSecurityHistory } from "../src/registration-audit.js";
import { admin, migrate, request, testEnv } from "./security-helpers.js";

beforeAll(migrate);
afterEach(() => vi.unstubAllGlobals());

async function seed() {
  const code = "HACXI-" + crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();
  await env.ORDERS_DB.prepare(`INSERT INTO registrations
    (registration_code, submission_key, first_name, last_name, email, amount_due_cents)
    VALUES (?, ?, 'PrivateName', 'PrivateSurname', 'private@example.invalid', 2500)`).bind(code, crypto.randomUUID()).run();
  return code;
}

describe("F05: attributable, durable administrative history", () => {
  it("records the allowlisted Supabase actor and each previous/new status", async () => {
    const code = await seed(), auth = await admin();
    vi.stubGlobal("fetch", vi.fn(async input => {
      const handled = auth.handle(String(input?.url || input)); if (handled) return handled;
      if (String(input) === "https://api.resend.com/emails") return Response.json({ id: "mail-history-local" });
      throw new Error("Unexpected external request blocked");
    }));
    const runtime = testEnv(auth.env);
    for (const status of ["confirmed", "cancelled", "payment_not_found"]) {
      expect((await worker.fetch(request("/admin/registrations/status", { registrationCode: code, status }, "PATCH", { Authorization: "Bearer " + auth.token }), runtime)).status).toBe(200);
    }
    const rows = (await env.ORDERS_DB.prepare("SELECT * FROM registration_admin_audit WHERE actor_ref = ? ORDER BY rowid").bind(auth.userId).all()).results;
    expect(rows.map(row => [row.previous_status, row.new_status])).toEqual([["awaiting_payment", "confirmed"], ["confirmed", "cancelled"], ["cancelled", "payment_not_found"]]);
    expect(rows.every(row => row.actor_ref === auth.userId && row.actor_kind === "admin")).toBe(true);
    expect(JSON.stringify(rows)).not.toContain("private@example.invalid");
  });

  it("retains minimal history and receipt totals after deleting attendee details", async () => {
    const code = await seed(), actor = crypto.randomUUID();
    await changeRegistrationStatus(testEnv(), code, "confirmed", actor);
    const row = await env.ORDERS_DB.prepare("SELECT id, confirmed_by_user_id FROM registrations WHERE registration_code = ?").bind(code).first();
    expect(row.confirmed_by_user_id).toBe(actor);
    await env.ORDERS_DB.batch([
      env.ORDERS_DB.prepare("INSERT INTO registration_events (registration_id, event_type, actor_type, new_status, note) VALUES (?, 'payment_reported', 'registrant', 'payment_reported', 'Secret attendee note')").bind(row.id),
      env.ORDERS_DB.prepare("INSERT INTO registration_receipts (registration_id, receipt_number, amount_paid_cents, currency, payment_reference) VALUES (?, ?, 2500, 'usd', 'Private payment reference')").bind(row.id, crypto.randomUUID()),
    ]);
    await deleteRegistrationWithAudit(testEnv(), code, actor);
    expect(await env.ORDERS_DB.prepare("SELECT id FROM registrations WHERE registration_code = ?").bind(code).first()).toBeNull();
    const audit = (await env.ORDERS_DB.prepare("SELECT * FROM registration_admin_audit ORDER BY rowid").all()).results;
    expect(audit.some(item => item.action === "registration_deleted" && item.actor_ref === actor)).toBe(true);
    expect(audit.some(item => item.action === "receipt_recorded" && item.amount_cents === 2500)).toBe(true);
    expect(audit.some(item => item.action === "payment_reported")).toBe(true);
    for (const privateValue of ["PrivateName", "private@example.invalid", "Secret attendee note", "Private payment reference", code]) {
      expect(JSON.stringify(audit)).not.toContain(privateValue);
    }
  });

  it("rolls back the status change if writing its audit event fails", async () => {
    const code = await seed();
    await env.ORDERS_DB.exec("CREATE TRIGGER local_fail_audit BEFORE INSERT ON registration_admin_audit BEGIN SELECT RAISE(ABORT, 'Local audit failure'); END;");
    try { await expect(changeRegistrationStatus(testEnv(), code, "confirmed", crypto.randomUUID())).rejects.toThrow(); }
    finally { await env.ORDERS_DB.exec("DROP TRIGGER local_fail_audit;"); }
    expect((await env.ORDERS_DB.prepare("SELECT status FROM registrations WHERE registration_code = ?").bind(code).first()).status).toBe("awaiting_payment");
  });

  it("does not produce a second audit event for an unchanged status", async () => {
    const code = await seed(), actor = crypto.randomUUID();
    await changeRegistrationStatus(testEnv(), code, "confirmed", actor);
    await changeRegistrationStatus(testEnv(), code, "confirmed", actor);
    expect((await env.ORDERS_DB.prepare("SELECT count(*) AS n FROM registration_admin_audit WHERE actor_ref = ?").bind(actor).first()).n).toBe(1);
  });

  it("prevents modification or premature deletion and purges expired history", async () => {
    const code = await seed(), actor = crypto.randomUUID();
    await changeRegistrationStatus(testEnv(), code, "confirmed", actor);
    await expect(env.ORDERS_DB.prepare("UPDATE registration_admin_audit SET action = 'tampered' WHERE actor_ref = ?").bind(actor).run()).rejects.toThrow();
    await expect(env.ORDERS_DB.prepare("DELETE FROM registration_admin_audit WHERE actor_ref = ?").bind(actor).run()).rejects.toThrow();
    const expiredId = crypto.randomUUID();
    await env.ORDERS_DB.prepare("INSERT INTO registration_admin_audit (id, subject_ref, actor_kind, action, expires_at) VALUES (?, 'expired', 'system', 'expired-fixture', unixepoch() - 1)").bind(expiredId).run();
    await pruneSecurityHistory(env.ORDERS_DB);
    expect(await env.ORDERS_DB.prepare("SELECT id FROM registration_admin_audit WHERE id = ?").bind(expiredId).first()).toBeNull();
    expect((await env.ORDERS_DB.prepare("SELECT count(*) AS n FROM registration_admin_audit WHERE actor_ref = ?").bind(actor).first()).n).toBe(1);
  });
});
