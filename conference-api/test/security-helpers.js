import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { vi } from "vitest";
import { exportJWK, generateKeyPair, SignJWT } from "jose";

export const origin = "https://hacypaa.us";
export const webhookSecret = "whsec_localfixture";

export async function migrate() {
  await applyD1Migrations(env.ORDERS_DB, env.TEST_MIGRATIONS);
}

export function testEnv(overrides = {}) {
  return {
    ENVIRONMENT: "test", BOT_PROTECTION_MODE: "disabled", RECIPIENT_QUOTA_MODE: "disabled",
    ORDERS_DB: env.ORDERS_DB,
    PUBLIC_WRITE_LIMITER: { limit: vi.fn().mockResolvedValue({ success: true }) },
    FULFILLMENT_MODE: "live",
    STRIPE_SECRET_KEY: "sk_live_localfixture",
    STRIPE_WEBHOOK_SECRET: webhookSecret,
    PRINTIFY_API_TOKEN: "local-printify-fixture",
    PRINTIFY_SHOP_ID: "localshop",
    RESEND_API_KEY: "re_localfixture",
    PREREG_FROM_EMAIL: "HACYPAA Tests <test@example.invalid>",
    PUBLIC_SITE_URL: origin,
    PREREG_PRICE_CENTS: "2500",
    FULFILLMENT_QUEUE: { send: vi.fn().mockResolvedValue(undefined) },
    ...overrides,
  };
}

export function request(path, body, method = "POST", headers = {}) {
  return new Request(`https://worker.example.invalid${path}`, {
    method,
    headers: { Origin: origin, "Content-Type": "application/json", "CF-Connecting-IP": "192.0.2.1", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

export function registration(overrides = {}) {
  return {
    submissionKey: crypto.randomUUID(), firstName: "Local", lastName: "Attendee",
    email: "attendee@example.invalid", phoneNumber: "8165550100", location: "Kansas City",
    fellowshipAa: true, fellowshipAlanon: false, accommodationMobility: false,
    accommodationAsl: false, volunteerInterest: false, scholarshipDonation: false,
    preferredPaymentMethod: "cash", dietaryRestrictions: "", accommodationDetails: "",
    ...overrides,
  };
}

export function paymentEvent(live = true) {
  const id = `cs_${live ? "live" : "test"}_${crypto.randomUUID().replaceAll("-", "")}`;
  const session = {
    id, object: "checkout.session", livemode: live, mode: "payment", status: "complete",
    payment_status: "paid", currency: "usd", amount_subtotal: 3000, amount_total: 3650,
    total_details: { amount_shipping: 500, amount_tax: 150, amount_discount: 0 },
    metadata: { source: "hacypaa_merch" },
    customer_details: { email: "buyer@example.invalid", name: "Local Buyer" },
    collected_information: { shipping_details: { name: "Local Buyer", address: {
      line1: "123 Test Street", line2: "", city: "Kansas City", state: "MO", postal_code: "64111", country: "US",
    } } },
  };
  return { id: "evt_" + crypto.randomUUID().replaceAll("-", ""), type: "checkout.session.completed",
    created: Math.floor(Date.now() / 1000), livemode: live, data: { object: session } };
}

export function lineItems() {
  return { data: [{ id: "li_" + crypto.randomUUID().replaceAll("-", ""), quantity: 1,
    amount_total: 3000, price: { unit_amount: 3000, product: { name: "Local Shirt", metadata: {
      printify_product_id: "6ae4f7aa56ca05b4b30c6beb", printify_variant_id: "67441",
    } } } }], has_more: false };
}

export async function webhook(event) {
  const body = JSON.stringify(event), timestamp = Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(webhookSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${body}`));
  const hex = Array.from(new Uint8Array(signature), b => b.toString(16).padStart(2, "0")).join("");
  return new Request("https://worker.example.invalid/stripe/webhook", { method: "POST", body,
    headers: { "Stripe-Signature": `t=${timestamp},v1=${hex}`, "Content-Type": "application/json" } });
}

export function message(orderID) {
  return { id: crypto.randomUUID(), body: { orderID }, attempts: 1, ack: vi.fn(), retry: vi.fn() };
}

export async function admin(role = "super_admin") {
  const supabaseUrl = "https://auth-" + crypto.randomUUID() + ".example.invalid";
  const userId = crypto.randomUUID();
  const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
  const jwk = await exportJWK(publicKey); Object.assign(jwk, { kid: "local", alg: "ES256", use: "sig" });
  const token = await new SignJWT({ role: "authenticated", aal: "aal2" })
    .setProtectedHeader({ alg: "ES256", kid: "local" }).setIssuer(supabaseUrl + "/auth/v1")
    .setAudience("authenticated").setSubject(userId).setIssuedAt().setExpirationTime("5m").sign(privateKey);
  return { supabaseUrl, userId, token,
    env: { SUPABASE_URL: supabaseUrl, SUPABASE_SECRET_KEY: "local-allowlist-fixture" },
    handle(url) {
      if (url.startsWith(supabaseUrl + "/auth/v1/.well-known/jwks.json")) return Response.json({ keys: [jwk] });
      if (url.startsWith(supabaseUrl + "/rest/v1/admin_users")) return Response.json([{ user_id: userId, role }]);
      return null;
    },
  };
}
