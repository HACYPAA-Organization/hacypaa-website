import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const botSource = await readFile(new URL("../assets/js/bot-protection.js", import.meta.url), "utf8");
const adminSource = await readFile(new URL("../assets/js/admin-data.js", import.meta.url), "utf8");

function botClient({ verify = "success", required = true, configurationStatus = 200 } = {}) {
  const calls = []; let serial = 0, removed = 0;
  const window = { location: { hostname: "hacypaa.us", href: "https://hacypaa.us/registration/" },
    setTimeout, clearTimeout, turnstile: {
      render(host, options) { queueMicrotask(() => verify === "success" ? options.callback("fresh-token-" + ++serial) : options["error-callback"]()); return "widget"; },
      remove() { removed++; },
    },
    async fetch(input, options = {}) {
      calls.push({ input, options });
      return String(input).endsWith("/public/config") ? Response.json({ required, siteKey: "local-sitekey" }, { status: configurationStatus }) : Response.json({ ok: true });
    },
  };
  const document = { querySelector: () => ({ insertAdjacentElement() {} }),
    createElement: () => ({ setAttribute() {}, remove() { removed++; } }), head: { appendChild() {} }, body: { appendChild() {} } };
  vm.runInNewContext(botSource, { window, document, URL, AbortSignal, DOMException, console });
  return { fetch: window.HACYPAAProtectedFetch, calls, get removed() { return removed; } };
}

test("public submissions receive fresh challenge tokens while preserving their fields", async () => {
  const client = botClient();
  const original = { dietaryRestrictions: "Peanut allergy", accommodationDetails: "Wheelchair access", shipping: { method: 4 } };
  await client.fetch("https://checkout-api.tgp-services.workers.dev/registrations", { method: "POST", body: JSON.stringify(original) });
  await client.fetch("https://checkout-api.tgp-services.workers.dev/registrations", { method: "POST", body: JSON.stringify(original) });
  const posts = client.calls.filter(call => call.options.method === "POST").map(call => JSON.parse(call.options.body));
  assert.equal(posts.length, 2);
  assert.deepEqual(posts[0], { ...original, turnstileToken: "fresh-token-1" });
  assert.deepEqual(posts[1], { ...original, turnstileToken: "fresh-token-2" });
  assert.equal(client.calls.filter(call => String(call.input).endsWith("/public/config")).length, 1);
  assert.ok(client.removed >= 2);
});

test("challenge failure prevents registration submission and cleans up its widget", async () => {
  const client = botClient({ verify: "failure" });
  await assert.rejects(client.fetch("https://checkout-api.tgp-services.workers.dev/registrations", { method: "POST", body: "{}" }), /Verification failed/);
  assert.equal(client.calls.filter(call => call.options.method === "POST").length, 0);
  assert.ok(client.removed > 0);
});

test("aborting verification prevents a public POST", async () => {
  const client = botClient(), controller = new AbortController(); controller.abort();
  await assert.rejects(client.fetch("https://checkout-api.tgp-services.workers.dev/panelists", { method: "POST", body: "{}", signal: controller.signal }), { name: "AbortError" });
  assert.equal(client.calls.filter(call => call.options.method === "POST").length, 0);
});

test("a verification configuration outage fails closed", async () => {
  const client = botClient({ configurationStatus: 503 });
  await assert.rejects(client.fetch("https://checkout-api.tgp-services.workers.dev/registrations", { method: "POST", body: "{}" }), /temporarily unavailable/);
  assert.equal(client.calls.filter(call => call.options.method === "POST").length, 0);
});

test("GETs and unrelated origins do not receive challenge tokens", async () => {
  const client = botClient();
  await client.fetch("https://checkout-api.tgp-services.workers.dev/registration/config");
  await client.fetch("https://unrelated.example/registrations", { method: "POST", body: "{}" });
  assert.equal(client.calls.length, 2);
  assert.equal(client.calls[1].options.body, "{}");
});

function adminClient({ mutate = false, repeat = false } = {}) {
  let count = 0;
  const rows = Array.from({ length: 601 }, (_, id) => ({ id }));
  const root = { fetch: async input => {
    const url = new URL(input), offset = Number(url.searchParams.get("cursor") || 0); count++;
    return Response.json({ ok: true, registrations: rows.slice(offset, offset + 100), total: mutate && count > 1 ? 602 : 601,
      pagination: { snapshot: 601, nextCursor: repeat ? "100" : offset + 100 < 601 ? String(offset + 100) : null } });
  } };
  vm.runInNewContext(adminSource, { window: root, URL, Response, JSON, Number, Set, Error });
  return { api: root.HACYPAA_ADMIN_DATA, get calls() { return count; } };
}

test("complete export walks every page and includes more than 500 records", async () => {
  const client = adminClient();
  const response = await client.api.fetchAll("https://worker.example.invalid", "registrations", "local-token", () => true);
  const data = await response.json();
  assert.equal(data.registrations.length, 601); assert.equal(data.registrations.at(-1).id, 600); assert.equal(client.calls, 7);
});

test("export rejects a changed dataset instead of returning a partial file", async () => {
  const client = adminClient({ mutate: true });
  await assert.rejects(client.api.fetchAll("https://worker.example.invalid", "registrations", "local-token", () => true), /Records changed/);
});

test("export rejects a repeated cursor and a lost permission", async () => {
  const client = adminClient({ repeat: true });
  await assert.rejects(client.api.fetchAll("https://worker.example.invalid", "registrations", "local-token", () => true), /did not advance/);
  const revoked = adminClient();
  await assert.rejects(revoked.api.fetchAll("https://worker.example.invalid", "registrations", "local-token", () => revoked.calls === 0), /Access changed/);
});
