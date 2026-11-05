import { env } from "cloudflare:workers";
import { beforeAll, afterEach, describe, expect, it, vi } from "vitest";
import worker, { sendPaymentConfirmationEmail } from "../src/index.js";
import { confirmationStatements, latestConfirmation, processConfirmationEmail, queueManualConfirmation, refreshConfirmationDelivery, retryDueConfirmations } from "../src/confirmation-mail.js";
import { changeRegistrationStatus, deleteRegistrationWithAudit } from "../src/registration-audit.js";
import { admin, migrate, request, testEnv } from "./security-helpers.js";

beforeAll(migrate);
afterEach(() => vi.unstubAllGlobals());
async function confirmed() {
  const db = env.ORDERS_DB, code = "HACXI-" + crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();
  await db.prepare(`INSERT INTO registrations (registration_code, submission_key, first_name, last_name, email, amount_due_cents)
    VALUES (?, ?, 'Local', 'Mail', 'mail@example.invalid', 2500)`).bind(code, crypto.randomUUID()).run();
  const runtime = testEnv(), jobId = crypto.randomUUID(), actor = crypto.randomUUID();
  const result = await changeRegistrationStatus(runtime, code, "confirmed", actor, change => confirmationStatements(runtime, change, jobId));
  return { code, runtime, jobId, actor, registrationId: result.registration.id };
}

describe("F06: durable confirmation email delivery", () => {
  it("commits the mail job with confirmation and retries an outage using the same provider key", async () => {
    const { runtime, code, jobId } = await confirmed();
    const calls = []; let outage = true;
    vi.stubGlobal("fetch", vi.fn(async (input, init) => {
      expect(String(input)).toBe("https://api.resend.com/emails"); calls.push(init.headers["Idempotency-Key"]);
      return outage ? Response.json({ message: "local outage" }, { status: 503 }) : Response.json({ id: "mail-recovered" });
    }));
    expect((await processConfirmationEmail(runtime, jobId, sendPaymentConfirmationEmail)).status).toBe("failed");
    expect((await env.ORDERS_DB.prepare("SELECT status FROM registrations WHERE registration_code = ?").bind(code).first()).status).toBe("confirmed");
    outage = false;
    const job = await queueManualConfirmation(runtime, code, crypto.randomUUID());
    expect((await processConfirmationEmail(runtime, job.id, sendPaymentConfirmationEmail)).status).toBe("sent");
    await processConfirmationEmail(runtime, job.id, sendPaymentConfirmationEmail);
    expect(calls).toEqual(["prereg-confirmation/" + jobId, "prereg-confirmation/" + jobId]);
  });

  it("leases a job so concurrent retries make only one send", async () => {
    const { runtime, jobId } = await confirmed();
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ id: "mail-once" })));
    await Promise.all([processConfirmationEmail(runtime, jobId, sendPaymentConfirmationEmail), processConfirmationEmail(runtime, jobId, sendPaymentConfirmationEmail)]);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("does not automatically resend after the provider idempotency window", async () => {
    const { runtime, jobId } = await confirmed();
    await env.ORDERS_DB.prepare("UPDATE registration_confirmation_mail SET first_attempt_at = unixepoch() - 90000, attempts = 1, status = 'failed' WHERE id = ?").bind(jobId).run();
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No provider call is permitted"); }));
    expect((await processConfirmationEmail(runtime, jobId, sendPaymentConfirmationEmail)).status).toBe("needs_review");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("retries accepted-but-unrecorded mail with a stable idempotency key", async () => {
    const { runtime, jobId } = await confirmed(), accepted = new Set();
    vi.stubGlobal("fetch", vi.fn(async (input, init) => { accepted.add(init.headers["Idempotency-Key"]); return Response.json({ id: "mail-accepted" }); }));
    await env.ORDERS_DB.exec("CREATE TRIGGER local_fail_mail_tracking BEFORE UPDATE ON registration_confirmation_mail WHEN NEW.status = 'sent' BEGIN SELECT RAISE(ABORT, 'Local tracking failure'); END;");
    try { expect((await processConfirmationEmail(runtime, jobId, sendPaymentConfirmationEmail)).status).toBe("failed"); }
    finally { await env.ORDERS_DB.exec("DROP TRIGGER local_fail_mail_tracking;"); }
    await env.ORDERS_DB.prepare("UPDATE registration_confirmation_mail SET next_attempt_at = unixepoch() WHERE id = ?").bind(jobId).run();
    expect((await processConfirmationEmail(runtime, jobId, sendPaymentConfirmationEmail)).status).toBe("sent");
    expect(fetch).toHaveBeenCalledTimes(2); expect(accepted.size).toBe(1);
  });

  it("cancels pending mail when a registration is unconfirmed and removes its job on deletion", async () => {
    const { runtime, code, jobId, actor } = await confirmed();
    await changeRegistrationStatus(runtime, code, "cancelled", actor, details => confirmationStatements(runtime, details, crypto.randomUUID()));
    vi.stubGlobal("fetch", vi.fn());
    expect((await processConfirmationEmail(runtime, jobId, sendPaymentConfirmationEmail)).status).toBe("canceled");
    expect(fetch).not.toHaveBeenCalled();
    await deleteRegistrationWithAudit(runtime, code, actor);
    expect(await env.ORDERS_DB.prepare("SELECT id FROM registration_confirmation_mail WHERE id = ?").bind(jobId).first()).toBeNull();
  });

  it("provides scheduled retries and reads tracked delivery without provider read permission", async () => {
    const { runtime, code, jobId } = await confirmed();
    vi.stubGlobal("fetch", vi.fn(async (input, init) => {
      expect(String(input)).toBe("https://api.resend.com/emails");
      expect(init.method).toBe("POST");
      return Response.json({ id: "mail-delivery" });
    }));
    await retryDueConfirmations(runtime, sendPaymentConfirmationEmail);
    expect((await env.ORDERS_DB.prepare("SELECT status FROM registration_confirmation_mail WHERE id = ?").bind(jobId).first()).status).toBe("sent");
    expect((await refreshConfirmationDelivery(runtime, code)).deliveryStatus).toBe("sent");
    await env.ORDERS_DB.prepare("UPDATE registration_confirmation_mail SET delivery_status = 'delivered' WHERE id = ?").bind(jobId).run();
    expect((await refreshConfirmationDelivery(runtime, code)).deliveryStatus).toBe("delivered");
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("requires an explicit new resend for already-sent or historically untracked mail", async () => {
    const { runtime, code, jobId, actor } = await confirmed();
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ id: "mail-manual" })));
    await processConfirmationEmail(runtime, jobId, sendPaymentConfirmationEmail);
    expect((await queueManualConfirmation(runtime, code, actor)).id).toBe(jobId);
    await env.ORDERS_DB.prepare("UPDATE registration_confirmation_mail SET created_at = unixepoch() - 120 WHERE id = ?").bind(jobId).run();
    const key = crypto.randomUUID(), next = await queueManualConfirmation(runtime, code, actor, { resend: true, requestKey: key });
    expect(next.id).toBe(key);
    expect((await queueManualConfirmation(runtime, code, actor, { resend: true, requestKey: key })).id).toBe(key);
    await processConfirmationEmail(runtime, key, sendPaymentConfirmationEmail);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([null, "volunteer_admin"])("denies unauthorized mail resend for role %s", async role => {
    let runtime = testEnv(), headers = {};
    if (role) { const auth = await admin(role); runtime = testEnv(auth.env); headers.Authorization = "Bearer " + auth.token;
      vi.stubGlobal("fetch", vi.fn(async input => auth.handle(String(input)))); }
    else vi.stubGlobal("fetch", vi.fn());
    expect((await worker.fetch(request("/admin/registrations/confirmation-email", { registrationCode: "HACXI-LOCAL", action: "resend", requestKey: crypto.randomUUID() }, "POST", headers), runtime)).status).toBe(role ? 403 : 401);
  });
});
