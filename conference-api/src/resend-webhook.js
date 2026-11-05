import { InputError, readRequestBody } from "./request-security.js";
import { registrationDeliveryStatement } from "./confirmation-mail.js";

export const CONFIRMATION_TAG = "hacypaa_confirmation_job";
const EVENT_STATES = new Map([
  ["email.sent", ["sent", 0]], ["email.delivery_delayed", ["delivery_delayed", 1]],
  ["email.delivered", ["delivered", 2]], ["email.failed", ["failed", 3]],
  ["email.bounced", ["bounced", 4]], ["email.suppressed", ["suppressed", 4]],
  ["email.complained", ["complained", 5]],
]);
const ID = /^[A-Za-z0-9_.-]{1,128}$/;
const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function decodeBase64(value) {
  try { return Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), c => c.charCodeAt(0)); }
  catch { return null; }
}

export async function verifyResendRequest(request, env, now = Math.floor(Date.now() / 1000)) {
  const secret = typeof env.RESEND_WEBHOOK_SECRET === "string" ? env.RESEND_WEBHOOK_SECRET.trim() : "";
  const keyBytes = secret.startsWith("whsec_") ? decodeBase64(secret.slice(6)) : null;
  if (!keyBytes || keyBytes.length < 16 || keyBytes.length > 128) throw new InputError("Email delivery webhook is not configured", 503);
  const id = request.headers.get("svix-id") || "", timestamp = request.headers.get("svix-timestamp") || "";
  const signatures = request.headers.get("svix-signature") || "";
  if (!ID.test(id) || !/^\d{1,12}$/.test(timestamp) || Math.abs(now - Number(timestamp)) > 300 || signatures.length > 2048) {
    throw new InputError("Invalid email webhook signature", 401);
  }
  if ((request.headers.get("Content-Type") || "").split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    throw new InputError("Email webhook must use JSON", 415);
  }
  let limited;
  try { limited = await env.PUBLIC_WRITE_LIMITER.limit({ key: "resend-webhook:" + (request.headers.get("CF-Connecting-IP") || "unknown") }); }
  catch { throw new InputError("Email webhook temporarily unavailable", 503); }
  if (!limited?.success) throw new InputError("Too many email webhook requests", 429);
  const raw = await readRequestBody(request), prefix = new TextEncoder().encode(id + "." + timestamp + ".");
  const signed = new Uint8Array(prefix.length + raw.length); signed.set(prefix); signed.set(raw, prefix.length);
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  let verified = false;
  for (const value of signatures.trim().split(/\s+/).slice(0, 8)) {
    if (!value.startsWith("v1,")) continue;
    const signature = decodeBase64(value.slice(3));
    // Web Crypto verifies HMAC in constant time; do not compare strings.
    if (signature?.length === 32 && await crypto.subtle.verify("HMAC", key, signature, signed)) { verified = true; break; }
  }
  if (!verified) throw new InputError("Invalid email webhook signature", 401);
  let event;
  try { event = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)); }
  catch { throw new InputError("Email webhook must contain valid JSON"); }
  if (!event || typeof event !== "object" || Array.isArray(event)) throw new InputError("Email webhook must contain an object");
  return { event, messageId: id };
}

export async function handleResendWebhook(request, env) {
  const { event, messageId } = await verifyResendRequest(request, env);
  if (typeof event.type !== "string") throw new InputError("Email webhook event type is required");
  const state = EVENT_STATES.get(event.type);
  if (!state) return { received: true, ignored: true };
  const data = event.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new InputError("Invalid email delivery event");
  const tags = data.tags;
  const jobId = Array.isArray(tags) ? tags.find(tag => tag?.name === CONFIRMATION_TAG)?.value : tags?.[CONFIRMATION_TAG];
  // Supabase auth and other applications' messages have no confirmation tag.
  // Do not retain their subjects, addresses, bodies or even delivery metadata.
  if (typeof jobId !== "string" || !JOB_ID.test(jobId)) return { received: true, ignored: true };
  const eventAt = typeof event.created_at === "string" ? Date.parse(event.created_at) : NaN;
  if (typeof data.email_id !== "string" || !ID.test(data.email_id) || !Number.isSafeInteger(eventAt) ||
    eventAt < 0 || eventAt > Date.now() + 300000) throw new InputError("Invalid email delivery event");
  const [deliveryStatus, rank] = state, db = env.ORDERS_DB;
  const results = await db.batch([
    db.prepare(`UPDATE registration_confirmation_mail SET status = 'sent', provider_id = coalesce(provider_id, ?),
      delivery_status = ?, delivery_event_id = ?, delivery_event_at = ?,
      sent_at = coalesce(sent_at, first_attempt_at), lease_token = NULL, lease_until = NULL, last_error_code = NULL
      WHERE id = ? AND status <> 'canceled' AND attempts > 0 AND (provider_id IS NULL OR provider_id = ?)
      AND coalesce(delivery_event_id, '') <> ?
      AND (delivery_event_at IS NULL OR delivery_event_at < ? OR (delivery_event_at = ? AND
        CASE delivery_status WHEN 'sent' THEN 0 WHEN 'delivery_delayed' THEN 1 WHEN 'delivered' THEN 2
        WHEN 'failed' THEN 3 WHEN 'bounced' THEN 4 WHEN 'suppressed' THEN 4 WHEN 'complained' THEN 5 ELSE -1 END < ?))
      AND (? NOT IN ('sent', 'delivery_delayed') OR delivery_status IS NULL OR delivery_status IN ('sent', 'delivery_delayed'))
      AND EXISTS (SELECT 1 FROM registrations r WHERE r.id = registration_id AND r.status = 'confirmed')`)
      .bind(data.email_id, deliveryStatus, messageId, eventAt, jobId, data.email_id, messageId, eventAt, eventAt, rank, deliveryStatus),
    registrationDeliveryStatement(db, jobId),
  ]);
  return { received: true, ignored: results[0].meta.changes !== 1 };
}
