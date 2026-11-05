import { env } from "cloudflare:workers";
import { createHmac } from "node:crypto";
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import worker, { sendPaymentConfirmationEmail } from "../src/index.js";
import { confirmationStatements, processConfirmationEmail, queueManualConfirmation, refreshConfirmationDelivery } from "../src/confirmation-mail.js";
import { changeRegistrationStatus, deleteRegistrationWithAudit } from "../src/registration-audit.js";
import { CONFIRMATION_TAG, verifyResendRequest } from "../src/resend-webhook.js";
import { migrate, testEnv } from "./security-helpers.js";

const secret = "whsec_" + Buffer.from("local-only-resend-webhook-key-32b").toString("base64");
beforeAll(migrate);
beforeEach(() => vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected outgoing request in local webhook test"); })));
afterEach(() => vi.unstubAllGlobals());

function signed(event, options = {}) {
  const raw = options.raw ?? JSON.stringify(event), id = options.id ?? "msg_" + crypto.randomUUID();
  const timestamp = String(options.timestamp ?? Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", Buffer.from(secret.slice(6), "base64")).update(id + "." + timestamp + "." + raw).digest("base64");
  return new Request("https://worker.example.invalid/resend/webhook", { method: "POST", body: options.body ?? raw,
    headers: { "Content-Type": "application/json", "svix-id": id, "svix-timestamp": timestamp,
      "svix-signature": "v1," + signature, "CF-Connecting-IP": "192.0.2.1", ...options.headers } });
}

async function confirmed(attempt = true) {
  const db = env.ORDERS_DB, code = "HACXI-" + crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();
  await db.prepare(`INSERT INTO registrations (registration_code, submission_key, first_name, last_name, email, amount_due_cents)
    VALUES (?, ?, 'Local', 'Webhook', 'webhook@example.invalid', 2500)`).bind(code, crypto.randomUUID()).run();
  const runtime = testEnv({ RESEND_WEBHOOK_SECRET: secret }), jobId = crypto.randomUUID(), actor = crypto.randomUUID();
  const result = await changeRegistrationStatus(runtime, code, "confirmed", actor, change => confirmationStatements(runtime, change, jobId));
  if (attempt) await db.prepare(`UPDATE registration_confirmation_mail SET status = 'sending', attempts = 1,
    first_attempt_at = unixepoch(), lease_token = 'local-lease', lease_until = unixepoch() + 120 WHERE id = ?`).bind(jobId).run();
  return { runtime, code, jobId, actor, registrationId: result.registration.id };
}

function delivery(fixture, type = "email.delivered", overrides = {}) {
  return { type, created_at: new Date(Date.now() - 10000).toISOString(),
    data: { email_id: "mail-local", tags: { [CONFIRMATION_TAG]: fixture.jobId },
      to: ["webhook@example.invalid"], subject: "Not persisted by delivery tracking" }, ...overrides };
}

async function job(id) { return env.ORDERS_DB.prepare("SELECT * FROM registration_confirmation_mail WHERE id = ?").bind(id).first(); }
async function summary(code) { return env.ORDERS_DB.prepare("SELECT confirmation_email_delivery_status FROM registrations WHERE registration_code = ?").bind(code).first(); }
async function receive(fixture, event, options) { return worker.fetch(signed(event, options), fixture.runtime); }

describe("F06: authenticated Resend delivery events with sending-only credentials", () => {
  it("verifies the independently published Svix signature vector", async () => {
    const body = '{"event_type":"ping","data":{"success":true}}';
    const request = new Request("https://worker.example.invalid/resend/webhook", { method: "POST", body, headers: {
      "Content-Type": "application/json", "svix-id": "msg_loFOjxBNrRLzqYUf", "svix-timestamp": "1731705121",
      "svix-signature": "v1,rAvfW3dJ/X/qxhsaXPOyyCGmRKsaKWcsNccKXlIktD0=",
    } });
    const result = await verifyResendRequest(request, testEnv({ RESEND_WEBHOOK_SECRET: "whsec_plJ3nmyCDGBKInavdOK15jsl" }), 1731705121);
    expect(result.event).toEqual({ event_type: "ping", data: { success: true } });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["email.sent", "email.delivery_delayed", "email.delivered", "email.failed", "email.bounced", "email.suppressed", "email.complained"])("tracks %s separately from provider acceptance", async type => {
    const f = await confirmed(), response = await receive(f, delivery(f, type));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, ignored: false });
    expect(await job(f.jobId)).toMatchObject({ status: "sent", delivery_status: type.slice(6), provider_id: "mail-local", lease_token: null });
    expect((await summary(f.code)).confirmation_email_delivery_status).toBe(type.slice(6));
    expect((await refreshConfirmationDelivery(f.runtime, f.code)).deliveryStatus).toBe(type.slice(6));
    expect(fetch).not.toHaveBeenCalled();
  });

  it("ignores duplicates, older events and later non-terminal events without downgrading delivery", async () => {
    const f = await confirmed(), event = delivery(f), eventAt = Date.parse(event.created_at), id = "msg_duplicate";
    expect((await receive(f, event, { id })).status).toBe(200);
    expect((await (await receive(f, event, { id })).json()).ignored).toBe(true);
    for (const [type, offset] of [["email.failed", -1000], ["email.sent", 0], ["email.sent", 1000], ["email.delivery_delayed", 2000]]) {
      const response = await receive(f, delivery(f, type, { created_at: new Date(eventAt + offset).toISOString() }));
      expect((await response.json()).ignored).toBe(true);
    }
    expect((await job(f.jobId)).delivery_status).toBe("delivered");
    expect((await summary(f.code)).confirmation_email_delivery_status).toBe("delivered");
  });

  it.each([false, true])("preserves an event arriving during send, including ambiguous HTTP acceptance: %s", async ambiguous => {
    const f = await confirmed(false);
    vi.stubGlobal("fetch", vi.fn(async (input, init) => {
      expect(String(input)).toBe("https://api.resend.com/emails");
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body).tags).toContainEqual({ name: CONFIRMATION_TAG, value: f.jobId });
      expect((await receive(f, delivery(f))).status).toBe(200);
      return ambiguous ? Response.json({ error: "local response lost after acceptance" }, { status: 503 }) : Response.json({ id: "mail-local" });
    }));
    expect(await processConfirmationEmail(f.runtime, f.jobId, sendPaymentConfirmationEmail)).toMatchObject({ status: "sent", deliveryStatus: "delivered" });
    await processConfirmationEmail(f.runtime, f.jobId, sendPaymentConfirmationEmail);
    expect(fetch).toHaveBeenCalledOnce();
    expect((await summary(f.code)).confirmation_email_delivery_status).toBe("delivered");
  });

  it("returns a retryable error on an atomic tracking failure and accepts the provider retry", async () => {
    const f = await confirmed(), event = delivery(f), id = "msg_retry";
    await env.ORDERS_DB.exec("CREATE TRIGGER local_fail_delivery_summary BEFORE UPDATE ON registrations BEGIN SELECT RAISE(ABORT, 'Local delivery tracking failure'); END;");
    try {
      expect((await receive(f, event, { id })).status).toBe(503);
      expect((await job(f.jobId)).delivery_status).toBeNull();
    } finally { await env.ORDERS_DB.exec("DROP TRIGGER local_fail_delivery_summary;"); }
    expect((await (await receive(f, event, { id })).json()).ignored).toBe(false);
    expect((await job(f.jobId)).delivery_status).toBe("delivered");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("closes an uncertain expired job from signed acceptance evidence without resending", async () => {
    const f = await confirmed();
    await env.ORDERS_DB.prepare("UPDATE registration_confirmation_mail SET status = 'needs_review', first_attempt_at = unixepoch() - 90000 WHERE id = ?").bind(f.jobId).run();
    expect((await receive(f, delivery(f))).status).toBe(200);
    expect(await processConfirmationEmail(f.runtime, f.jobId, sendPaymentConfirmationEmail)).toMatchObject({ status: "sent", deliveryStatus: "delivered" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps an older email's event from replacing the latest resend or its refresh result", async () => {
    const f = await confirmed();
    await receive(f, delivery(f, "email.sent"));
    await env.ORDERS_DB.prepare("UPDATE registration_confirmation_mail SET created_at = unixepoch() - 120 WHERE id = ?").bind(f.jobId).run();
    const next = await queueManualConfirmation(f.runtime, f.code, f.actor, { resend: true, requestKey: crypto.randomUUID() });
    expect((await refreshConfirmationDelivery(f.runtime, f.code)).status).toBe("pending");
    await env.ORDERS_DB.prepare("UPDATE registration_confirmation_mail SET status = 'sending', attempts = 1, first_attempt_at = unixepoch() WHERE id = ?").bind(next.id).run();
    const latest = { ...f, jobId: next.id };
    await receive(latest, delivery(latest, "email.failed"));
    await receive(f, delivery(f, "email.delivered", { created_at: new Date().toISOString() }));
    expect((await job(f.jobId)).delivery_status).toBe("delivered");
    expect((await summary(f.code)).confirmation_email_delivery_status).toBe("failed");
    expect((await refreshConfirmationDelivery(f.runtime, f.code)).deliveryStatus).toBe("failed");
  });

  it("ignores a mismatched provider id, an unattempted job, a canceled job and deleted registrations", async () => {
    const f = await confirmed();
    await env.ORDERS_DB.prepare("UPDATE registration_confirmation_mail SET provider_id = 'mail-original' WHERE id = ?").bind(f.jobId).run();
    expect((await (await receive(f, delivery(f))).json()).ignored).toBe(true);
    const unsent = await confirmed(false);
    expect((await (await receive(unsent, delivery(unsent))).json()).ignored).toBe(true);
    const canceled = await confirmed();
    await changeRegistrationStatus(canceled.runtime, canceled.code, "cancelled", canceled.actor, change => confirmationStatements(canceled.runtime, change, crypto.randomUUID()));
    expect((await (await receive(canceled, delivery(canceled))).json()).ignored).toBe(true);
    await deleteRegistrationWithAudit(canceled.runtime, canceled.code, canceled.actor);
    expect((await (await receive(canceled, delivery(canceled))).json()).ignored).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not access the database for unrelated Supabase auth messages or unsupported events", async () => {
    const db = { batch: vi.fn(() => { throw new Error("Unrelated mail must not be recorded"); }) };
    const runtime = testEnv({ RESEND_WEBHOOK_SECRET: secret, ORDERS_DB: db });
    for (const event of [ { type: "email.delivered", data: { email_id: "mail-auth", to: ["auth@example.invalid"] } },
      { type: "email.opened", data: {} }, delivery({ jobId: "not-a-confirmation-job" }) ]) {
      expect((await (await worker.fetch(signed(event), runtime)).json()).ignored).toBe(true);
    }
    expect(db.batch).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["body", "id", "signature", "old", "future", "missing"])("rejects unauthenticated or replayed requests: %s", async kind => {
    const f = await confirmed(), options = {};
    if (kind === "body") options.body = JSON.stringify(delivery(f)) + " ";
    if (kind === "id") options.headers = { "svix-id": "msg_changed" };
    if (kind === "signature") options.headers = { "svix-signature": "v1," + Buffer.alloc(32).toString("base64") };
    if (kind === "old" || kind === "future") options.timestamp = Math.floor(Date.now() / 1000) + (kind === "old" ? -301 : 301);
    if (kind === "missing") options.headers = { "svix-signature": "" };
    expect((await receive(f, delivery(f), options)).status).toBe(401);
    expect((await job(f.jobId)).delivery_status).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("accepts a valid signature among multiple provider signatures using exact raw bytes", async () => {
    const f = await confirmed(), request = signed(delivery(f)), headers = new Headers(request.headers);
    headers.set("svix-signature", "v2,ignored v1," + Buffer.alloc(32).toString("base64") + " " + headers.get("svix-signature"));
    expect((await worker.fetch(new Request(request, { headers }), f.runtime)).status).toBe(200);
    expect((await job(f.jobId)).delivery_status).toBe("delivered");
  });

  it.each(["{", "null", "[]", '{"data":{}}'])("returns 400 for signed malformed JSON or invalid event structure: %s", async raw => {
    expect((await worker.fetch(signed(null, { raw }), testEnv({ RESEND_WEBHOOK_SECRET: secret }))).status).toBe(400);
  });

  it("bounds the signed body size and rejects a non-JSON MIME type", async () => {
    const runtime = testEnv({ RESEND_WEBHOOK_SECRET: secret });
    expect((await worker.fetch(signed(null, { raw: " ".repeat(65537) }), runtime)).status).toBe(413);
    expect((await worker.fetch(signed({}, { headers: { "Content-Type": "text/plain" } }), runtime)).status).toBe(415);
  });

  it("fails closed for a missing signing secret or unavailable limiter and signals rate-limit retries", async () => {
    expect((await worker.fetch(signed({}), testEnv())).status).toBe(503);
    const unavailable = testEnv({ RESEND_WEBHOOK_SECRET: secret, PUBLIC_WRITE_LIMITER: { limit: vi.fn().mockRejectedValue(new Error("local unavailable")) } });
    expect((await worker.fetch(signed({}), unavailable)).status).toBe(503);
    const limited = testEnv({ RESEND_WEBHOOK_SECRET: secret, PUBLIC_WRITE_LIMITER: { limit: vi.fn().mockResolvedValue({ success: false }) } });
    const response = await worker.fetch(signed({}), limited);
    expect(response.status).toBe(429); expect(response.headers.get("Retry-After")).toBe("60");
  });
});
