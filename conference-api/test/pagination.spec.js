import { env } from "cloudflare:workers";
import { beforeAll, afterEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index.js";
import { admin, migrate, request, testEnv } from "./security-helpers.js";

beforeAll(migrate);
afterEach(() => vi.unstubAllGlobals());

describe("F03: complete administrative pagination", () => {
  it.each(["registrations", "panelists"])("returns accurate totals and every one of >500 %s records", async resource => {
    const db = env.ORDERS_DB, tag = crypto.randomUUID().replaceAll("-", "");
    const table = resource === "registrations" ? "registrations" : "panelist_volunteers";
    const before = (await db.prepare(`SELECT count(*) AS n FROM ${table}`).first()).n;
    const statements = [];
    for (let i = 0; i < 601; i++) {
      if (resource === "registrations") statements.push(db.prepare(`INSERT INTO registrations
        (registration_code, submission_key, first_name, last_name, email, amount_due_cents, status, created_at)
        VALUES (?, ?, 'Local', 'Pagination', 'local@example.invalid', 2500, ?, ?)`)
        .bind("HACXI-" + tag + "-" + i, crypto.randomUUID(), i === 0 ? "confirmed" : "awaiting_payment", 1700000000 + Math.floor(i / 3)));
      else statements.push(db.prepare(`INSERT INTO panelist_volunteers
        (submission_key, first_name, last_name, email, phone_number, step_preferences, sobriety_date,
         has_sponsor, worked_steps, location, has_home_group, created_at)
        VALUES (?, 'Local', 'Panelist', 'local@example.invalid', '8165550100', '["1"]', '2020-01-01', 1, 1, 'KC', 1, ?)`)
        .bind(crypto.randomUUID(), 1700000000 + Math.floor(i / 3)));
    }
    for (let i = 0; i < statements.length; i += 100) await db.batch(statements.slice(i, i + 100));
    const auth = await admin();
    vi.stubGlobal("fetch", vi.fn(async input => {
      const result = auth.handle(String(input?.url || input)); if (result) return result;
      throw new Error("Unexpected external request blocked");
    }));
    const runtime = testEnv(auth.env); let cursor = null, pages = 0; const records = [];
    do {
      const path = "/admin/" + resource + "?limit=100" + (cursor ? "&cursor=" + cursor : "");
      const response = await worker.fetch(request(path, undefined, "GET", { Authorization: "Bearer " + auth.token }), runtime);
      expect(response.status).toBe(200); const data = await response.json();
      expect(data.total).toBe(before + 601); expect(data.pagination.total).toBe(before + 601);
      expect(data[resource].length).toBeLessThanOrEqual(100);
      records.push(...data[resource]); cursor = data.pagination.nextCursor; pages++;
      expect(pages).toBeLessThan(20);
    } while (cursor);
    expect(records.length).toBe(before + 601);
    expect(new Set(records.map(row => row.id)).size).toBe(records.length);
    expect(pages).toBeGreaterThan(5);
    if (resource === "registrations") expect(records.some(row => row.registrationCode === "HACXI-" + tag + "-0" && row.status === "confirmed")).toBe(true);
  });

  it.each(["limit=0", "limit=201", "limit=abc", "cursor=broken"])("returns 400 for invalid pagination %s", async query => {
    const auth = await admin(); vi.stubGlobal("fetch", vi.fn(async input => auth.handle(String(input?.url || input))));
    const response = await worker.fetch(request("/admin/registrations?" + query, undefined, "GET", { Authorization: "Bearer " + auth.token }), testEnv(auth.env));
    expect(response.status).toBe(400);
  });
});
