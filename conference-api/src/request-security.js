export const PUBLIC_ACTIONS = Object.freeze({
  "/registrations": "register",
  "/panelists": "panelist",
  "/registrations/resend-payment-link": "resend_payment_link",
  "/registrations/payment-report": "payment_report",
  "/checkout/shipping-quote": "checkout_quote",
  "/checkout/session": "checkout",
});

export class InputError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

export async function readRequestBody(request) {
  const reader = request.body?.getReader();
  if (!reader) throw new InputError("Request body must be valid JSON");
  const parts = []; let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 65536) throw new InputError("Request body is too large", 413);
      parts.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  return bytes;
}

export async function readJsonObject(request) {
  const bytes = await readRequestBody(request);
  let body;
  try { body = JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new InputError("Request body must be valid JSON"); }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new InputError("Request body must be a JSON object");
  }
  // No object-to-primitive coercion of user-controlled values.
  const textFields = ["firstName", "lastName", "email", "phoneNumber", "sobrietyDate", "location", "homeGroup",
    "dietaryRestrictions", "accommodationDetails", "submissionKey", "preferredPaymentMethod", "topicPreferences",
    "paymentToken", "registrationCode", "status", "adminNotes", "paymentSenderHandle", "paymentReference",
    "paymentMethod", "accessibilityNotes", "turnstileToken", "requestKey", "action"];
  if (textFields.some(key => body[key] != null && typeof body[key] !== "string")) {
    throw new InputError("Request fields have invalid types");
  }
  if (body.stepPreferences !== undefined && (!Array.isArray(body.stepPreferences) ||
    body.stepPreferences.some(step => !(typeof step === "string" || typeof step === "number")))) {
    throw new InputError("Step preferences must contain step numbers");
  }
  if (body.panelistId != null && !["number", "string"].includes(typeof body.panelistId)) {
    throw new InputError("Panelist ID has an invalid type");
  }
  if (body.items !== undefined && (!Array.isArray(body.items) || body.items.some(item =>
    !item || typeof item !== "object" || Array.isArray(item) ||
    ["productId", "variantId", "quantity"].some(key => !["string", "number"].includes(typeof item[key]))))) {
    throw new InputError("Cart contains an invalid item");
  }
  return body;
}

function testBypass(env, setting) {
  return env.ENVIRONMENT === "test" && env[setting] === "disabled";
}

export async function hashValue(value) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function reserveRecipientQuota(env, email) {
  if (testBypass(env, "RECIPIENT_QUOTA_MODE")) return;
  if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return;
  const hash = await hashValue(email.trim().toLowerCase());
  // Atomically enforce a shared recipient quota across IPs and public routes.
  const results = await env.ORDERS_DB.batch([
    env.ORDERS_DB.prepare("DELETE FROM security_recipient_quotas WHERE window_start < unixepoch() - 86400"),
    env.ORDERS_DB.prepare(`INSERT INTO security_recipient_quotas (recipient_hash, window_start, request_count)
      VALUES (?, (unixepoch() / 3600) * 3600, 1)
      ON CONFLICT(recipient_hash, window_start) DO UPDATE SET request_count = request_count + 1
      WHERE request_count < 10`).bind(hash),
  ]);
  if (results[1]?.meta?.changes !== 1) throw new InputError("Too many requests for this email address. Please try again later.", 429);
}

async function publicRecipient(env, path, body) {
  if (path === "/registrations" || path === "/panelists") return body.email;
  if (!path.startsWith("/registrations/")) return null;
  if (/^[0-9a-f]{64}$/i.test(body.paymentToken || "")) {
    const row = await env.ORDERS_DB.prepare("SELECT email FROM registrations WHERE payment_access_token_hash = ?")
      .bind(await hashValue(body.paymentToken.toLowerCase())).first();
    return row?.email;
  }
  // A known original submission key is verified by the handler as well.
  if (typeof body.submissionKey === "string") {
    const row = await env.ORDERS_DB.prepare("SELECT email FROM registrations WHERE submission_key = ?")
      .bind(body.submissionKey.toLowerCase()).first();
    return row?.email;
  }
  return null;
}

export async function guardPublicRequest(request, env, allowedOrigins) {
  const url = new URL(request.url), origin = request.headers.get("Origin");
  const action = request.method === "POST" ? PUBLIC_ACTIONS[url.pathname] : null;
  const statusLookup = request.method === "GET" && url.pathname === "/checkout/session-status";
  if (!action && !statusLookup) return;
  if (action && (!origin || !allowedOrigins.has(origin))) throw new InputError("Origin not allowed", 403);
  if (action && !/^application\/json(?:\s*;|$)/i.test(request.headers.get("Content-Type") || "")) {
    throw new InputError("Content-Type must be application/json", 415);
  }
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  // One shared IP key prevents bypass by alternating public endpoints.
  const { success } = await env.PUBLIC_WRITE_LIMITER.limit({ key: "public:" + ip });
  if (!success) throw new InputError("Too many requests. Please wait a minute and try again.", 429);
  if (!action) return;
  const body = await readJsonObject(request.clone());
  if (!testBypass(env, "BOT_PROTECTION_MODE")) {
    const secret = env.TURNSTILE_SECRET_KEY?.trim(), siteKey = env.TURNSTILE_SITE_KEY?.trim();
    if (!secret || !siteKey) throw new InputError("Verification is temporarily unavailable. Please try again later.", 503);
    if (typeof body.turnstileToken !== "string" || !body.turnstileToken.trim() || body.turnstileToken.length > 2048) {
      throw new InputError("Please complete the verification and try again.", 403);
    }
    let result;
    try {
      const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret, response: body.turnstileToken, remoteip: ip }),
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error("Verification provider unavailable");
      result = await response.json();
    } catch { throw new InputError("Verification is temporarily unavailable. Please try again.", 503); }
    if (result.success !== true || result.action !== action || result.hostname !== new URL(origin).hostname) {
      throw new InputError("Verification failed or expired. Please try again.", 403);
    }
  }
  await reserveRecipientQuota(env, await publicRecipient(env, url.pathname, body));
}

export function publicBotConfig(env) {
  return { required: !testBypass(env, "BOT_PROTECTION_MODE"), siteKey: env.TURNSTILE_SITE_KEY || null };
}
