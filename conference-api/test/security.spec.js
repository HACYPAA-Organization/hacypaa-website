import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import worker, { buildPrintifyOrderPayload } from "../src/index.js";
import { admin, lineItems, message, migrate, paymentEvent, registration, request, testEnv, webhook } from "./security-helpers.js";

beforeAll(migrate);
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unmocked external request blocked"); }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("F01: live fulfillment boundary", () => {
  it.each([false, null, undefined, 0, "true"])("never stores or queues event livemode=%s", async mode => {
    const event = paymentEvent(false); event.livemode = mode;
    const runtime = testEnv(); const before = await env.ORDERS_DB.prepare("SELECT count(*) AS n FROM orders").first();
    const response = await worker.fetch(await webhook(event), runtime);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, ignored: true });
    expect(runtime.FULFILLMENT_QUEUE.send).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(await env.ORDERS_DB.prepare("SELECT count(*) AS n FROM orders").first()).toEqual(before);
  });

  it("ignores a test event even when the deployed key is a test key", async () => {
    const runtime = testEnv({ STRIPE_SECRET_KEY: "sk_test_localfixture" });
    const response = await worker.fetch(await webhook(paymentEvent(false)), runtime);
    expect(response.status).toBe(200);
    expect(runtime.FULFILLMENT_QUEUE.send).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects a live event carrying a non-live embedded session", async () => {
    const event = paymentEvent(true); event.data.object.livemode = false;
    const runtime = testEnv();
    expect((await worker.fetch(await webhook(event), runtime)).status).toBe(200);
    expect(runtime.FULFILLMENT_QUEUE.send).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([{ FULFILLMENT_MODE: "disabled" }, { STRIPE_SECRET_KEY: "sk_test_localfixture" }])("fails closed on mismatched live configuration %j", async override => {
    const runtime = testEnv(override);
    expect((await worker.fetch(await webhook(paymentEvent()), runtime)).status).toBe(503);
    expect(runtime.FULFILLMENT_QUEUE.send).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("retrieves, validates, stores, and queues a signed live payment using only mocks", async () => {
    const event = paymentEvent(); const items = lineItems();
    vi.stubGlobal("fetch", vi.fn(async input => {
      const url = String(input?.url || input);
      if (url.includes("/line_items")) return Response.json(items);
      if (url.includes("api.stripe.com/v1/checkout/sessions/")) return Response.json(event.data.object);
      throw new Error("Unexpected external request blocked: " + url);
    }));
    const runtime = testEnv();
    const response = await worker.fetch(await webhook(event), runtime);
    expect(response.status).toBe(200);
    expect(runtime.FULFILLMENT_QUEUE.send).toHaveBeenCalledOnce();
    const saved = await env.ORDERS_DB.prepare("SELECT livemode, stripe_session_id FROM orders WHERE stripe_session_id = ?").bind(event.data.object.id).first();
    expect(saved).toEqual({ livemode: 1, stripe_session_id: event.data.object.id });
  });

  it("refuses to build a real fulfillment payload from a test order", () => {
    expect(() => buildPrintifyOrderPayload({ order: { livemode: 0 }, items: [] })).toThrow("Only live paid orders");
  });

  it.each([0, null, "1"])("consumer rejects forged/legacy mode=%s without a provider call", async livemode => {
    const runtime = testEnv({ ORDERS_DB: { prepare(sql) { return { bind() { return sql.includes("FROM orders") ?
      { first: async () => ({ id: 1, livemode, fulfillment_status: "pending" }) } :
      { all: async () => ({ results: [{ quantity: 1 }] }) }; } }; } } });
    const job = message(1); await worker.queue({ messages: [job] }, runtime);
    expect(job.ack).toHaveBeenCalledOnce(); expect(fetch).not.toHaveBeenCalled();
  });
});

describe("F04: independent dietary and accommodation fields", () => {
  it.each([
    ["Peanut allergy", "Wheelchair access"], ["Gluten free", ""], ["", "ASL interpreter"], ["", ""],
  ])("stores and retrieves dietary=%j separately from accommodation=%j", async (dietaryRestrictions, accommodationDetails) => {
    const auth = await admin();
    vi.stubGlobal("fetch", vi.fn(async input => {
      const url = String(input?.url || input); const handled = auth.handle(url); if (handled) return handled;
      if (url === "https://api.resend.com/emails") return Response.json({ id: "mail-local" });
      throw new Error("Unexpected external request blocked: " + url);
    }));
    const runtime = testEnv(auth.env); const body = registration({ dietaryRestrictions, accommodationDetails });
    const response = await worker.fetch(request("/registrations", body), runtime);
    expect(response.status).toBe(201); const data = await response.json();
    const stored = await env.ORDERS_DB.prepare("SELECT dietary_restrictions, accommodation_details FROM registrations WHERE submission_key = ?").bind(body.submissionKey).first();
    expect(stored).toEqual({ dietary_restrictions: dietaryRestrictions, accommodation_details: accommodationDetails || null });
    const list = await worker.fetch(request("/admin/registrations", undefined, "GET", { Authorization: "Bearer " + auth.token }), runtime);
    expect(list.status).toBe(200);
    const record = (await list.json()).registrations.find(r => r.registrationCode === data.registration.registrationCode);
    expect(record.dietaryRestrictions).toBe(dietaryRestrictions); expect(record.accommodationDetails).toBe(accommodationDetails || null);
  });

  it.each([{ dietaryRestrictions: {} }, { accommodationDetails: [] }, { dietaryRestrictions: "x".repeat(501) }, { accommodationDetails: "x".repeat(501) }])("rejects invalid independent fields %j", async fields => {
    expect((await worker.fetch(request("/registrations", registration(fields)), testEnv())).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("F02: public abuse controls", () => {
  it.each(["https://evil.example", "null", "https://hacypaa.us.evil.example"])("blocks blind cross-origin intake from %s before any side effect", async Origin => {
    const runtime = testEnv();
    const response = await worker.fetch(request("/registrations", registration(), "POST", { Origin, "Content-Type": "text/plain" }), runtime);
    expect(response.status).toBe(403); expect(fetch).not.toHaveBeenCalled();
    expect(runtime.PUBLIC_WRITE_LIMITER.limit).not.toHaveBeenCalled();
  });

  it("rejects text/plain submission even from an allowed origin", async () => {
    expect((await worker.fetch(request("/registrations", registration(), "POST", { "Content-Type": "text/plain" }), testEnv())).status).toBe(415);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["/registrations", "/panelists", "/registrations/resend-payment-link", "/registrations/payment-report", "/checkout/shipping-quote", "/checkout/session", "/checkout/session-status?session_id=cs_live_localfixture"])("throttles %s before any provider call", async path => {
    const runtime = testEnv({ PUBLIC_WRITE_LIMITER: { limit: vi.fn().mockResolvedValue({ success: false }) } });
    const isGet = path.includes("session-status");
    const response = await worker.fetch(request(path, isGet ? undefined : {}, isGet ? "GET" : "POST"), runtime);
    expect(response.status).toBe(429); expect(response.headers.get("Retry-After")).toBe("60");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("shares the IP limit across endpoints so path switching cannot bypass it", async () => {
    const limiter = { limit: vi.fn().mockResolvedValue({ success: false }) };
    const runtime = testEnv({ PUBLIC_WRITE_LIMITER: limiter });
    await worker.fetch(request("/registrations", {}), runtime);
    await worker.fetch(request("/checkout/session", {}), runtime);
    expect(limiter.limit.mock.calls.map(call => call[0].key)).toEqual(["public:192.0.2.1", "public:192.0.2.1"]);
  });

  it("fails closed when the rate limiter is unavailable", async () => {
    const response = await worker.fetch(request("/registrations", {}), testEnv({ PUBLIC_WRITE_LIMITER: undefined }));
    expect(response.status).toBe(503); expect(fetch).not.toHaveBeenCalled();
  });

  const botEnv = () => testEnv({ ENVIRONMENT: "production", BOT_PROTECTION_MODE: "required", RECIPIENT_QUOTA_MODE: "enabled",
    TURNSTILE_SITE_KEY: "local-sitekey", TURNSTILE_SECRET_KEY: "local-secret" });

  it("rejects missing bot tokens before intake writes or email", async () => {
    const response = await worker.fetch(request("/registrations", registration()), botEnv());
    expect(response.status).toBe(403); expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    { success: false },
    { success: true, action: "checkout", hostname: "hacypaa.us" },
    { success: true, action: "register", hostname: "evil.example" },
  ])("rejects failed, replayed or mismatched verification %j", async result => {
    vi.stubGlobal("fetch", vi.fn(async input => {
      expect(String(input)).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
      return Response.json(result);
    }));
    const response = await worker.fetch(request("/registrations", registration({ turnstileToken: "local-token" })), botEnv());
    expect(response.status).toBe(403); expect(fetch).toHaveBeenCalledOnce();
  });

  it("permits a verified legitimate registration using only mocked providers", async () => {
    const email = crypto.randomUUID() + "@example.invalid";
    vi.stubGlobal("fetch", vi.fn(async input => {
      if (String(input).includes("/siteverify")) return Response.json({ success: true, hostname: "hacypaa.us", action: "register" });
      if (String(input) === "https://api.resend.com/emails") return Response.json({ id: "mail-local" });
      throw new Error("Unexpected outbound request blocked");
    }));
    const response = await worker.fetch(request("/registrations", registration({ email, turnstileToken: "local-token" })), botEnv());
    expect(response.status).toBe(201); expect((await response.json()).emailSent).toBe(true);
    const quota = await env.ORDERS_DB.prepare("SELECT recipient_hash FROM security_recipient_quotas").all();
    expect(quota.results.every(row => /^[0-9a-f]{64}$/.test(row.recipient_hash))).toBe(true);
  });

  it("enforces one recipient quota across different IPs before registration writes", async () => {
    const runtime = testEnv({ RECIPIENT_QUOTA_MODE: "enabled" });
    const email = crypto.randomUUID() + "@example.invalid";
    vi.stubGlobal("fetch", vi.fn(async input => {
      if (String(input) === "https://api.resend.com/emails") return Response.json({ id: "mail-local" });
      throw new Error("Unexpected outbound request blocked");
    }));
    for (let i = 0; i < 10; i++) {
      const response = await worker.fetch(request("/registrations", registration({ email }), "POST", { "CF-Connecting-IP": `192.0.2.${i + 1}` }), runtime);
      expect(response.status).toBe(201);
    }
    const beforeCalls = fetch.mock.calls.length;
    const rejected = await worker.fetch(request("/registrations", registration({ email })), runtime);
    expect(rejected.status).toBe(429); expect(fetch).toHaveBeenCalledTimes(beforeCalls);
    expect((await env.ORDERS_DB.prepare("SELECT count(*) AS n FROM registrations WHERE email = ?").bind(email).first()).n).toBe(10);
  });

  it.each(["/stripe/status", "/printify/status", "/printify/products"])("keeps diagnostic %s authenticated", async path => {
    expect((await worker.fetch(request(path, undefined, "GET"), testEnv())).status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not disclose unrelated merchant sessions through the public receipt endpoint", async () => {
    const event = paymentEvent(); event.data.object.metadata = { source: "another_project" };
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(event.data.object)));
    const response = await worker.fetch(request("/checkout/session-status?session_id=" + event.data.object.id, undefined, "GET"), testEnv());
    expect(response.status).toBe(404);
    expect(JSON.stringify(await response.json())).not.toContain("buyer@example.invalid");
  });

  it("rejects a replayed challenge before a second registration or email", async () => {
    let used = false, emails = 0;
    vi.stubGlobal("fetch", vi.fn(async input => {
      if (String(input).includes("/siteverify")) {
        const success = !used; used = true;
        return Response.json({ success, hostname: "hacypaa.us", action: "register" });
      }
      emails++; return Response.json({ id: "mail-local-replay" });
    }));
    const runtime = botEnv(), email = crypto.randomUUID() + "@example.invalid";
    expect((await worker.fetch(request("/registrations", registration({ email, turnstileToken: "same-local-token" })), runtime)).status).toBe(201);
    expect((await worker.fetch(request("/registrations", registration({ email, turnstileToken: "same-local-token" })), runtime)).status).toBe(403);
    expect(emails).toBe(1);
    expect((await env.ORDERS_DB.prepare("SELECT count(*) AS n FROM registrations WHERE email = ?").bind(email).first()).n).toBe(1);
  });
});

describe("F09: malformed JSON and hostile values", () => {
  it.each([null, [], "text", 42, false])("returns 400 for a non-object JSON root %j", async body => {
    for (const path of ["/checkout/session", "/panelists", "/registrations", "/registrations/payment-report", "/checkout/shipping-quote"]) {
      expect((await worker.fetch(request(path, body), testEnv())).status).toBe(400);
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([
    { stepPreferences: [{ toString: null, valueOf: null }] },
    { firstName: { toString: null, valueOf: null } },
    { items: [{ productId: { toString: null, valueOf: null }, variantId: 1, quantity: 1 }] },
  ])("rejects hostile field values without coercion %j", async body => {
    expect((await worker.fetch(request(body.items ? "/checkout/session" : "/panelists", body), testEnv())).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
});
