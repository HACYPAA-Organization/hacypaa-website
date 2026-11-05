import { env } from "cloudflare:workers";
import { beforeAll, afterEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index.js";
import { lineItems, message, migrate, paymentEvent, testEnv, webhook } from "./security-helpers.js";

beforeAll(migrate);
afterEach(() => vi.unstubAllGlobals());

async function seedOrder() {
  const event = paymentEvent(), runtime = testEnv(), items = lineItems();
  vi.stubGlobal("fetch", vi.fn(async input => String(input?.url || input).includes("/line_items") ? Response.json(items) : Response.json(event.data.object)));
  expect((await worker.fetch(await webhook(event), runtime)).status).toBe(200);
  return { runtime, event, orderId: runtime.FULFILLMENT_QUEUE.send.mock.calls[0][0].orderID };
}

function remoteOrder(event, id = "remote-" + event.data.object.id) {
  return { id, status: "pending", metadata: { shop_order_id: event.data.object.id } };
}
function list(data = [], page = 1, last = 1) { return Response.json({ data, current_page: page, last_page: last }); }
async function consume(runtime, orderId) {
  const job = message(orderId); await worker.queue({ messages: [job] }, runtime); return job;
}

describe("F07: recover accepted fulfillment without duplicate submission", () => {
  it("recovers the remote ID after Printify accepts but the local tracking write fails", async () => {
    const { runtime, event, orderId } = await seedOrder(); let posts = 0;
    vi.stubGlobal("fetch", vi.fn(async (input, init = {}) => {
      if (init.method === "POST") { posts++; return Response.json(remoteOrder(event)); }
      return list([remoteOrder(event)]);
    }));
    await env.ORDERS_DB.exec("CREATE TRIGGER local_fail_printify_tracking BEFORE UPDATE ON orders WHEN NEW.printify_order_id IS NOT NULL BEGIN SELECT RAISE(ABORT, 'Local tracking failure'); END;");
    try { expect((await consume(runtime, orderId)).retry).toHaveBeenCalledOnce(); }
    finally { await env.ORDERS_DB.exec("DROP TRIGGER local_fail_printify_tracking;"); }
    const failed = await env.ORDERS_DB.prepare("SELECT printify_submission_state, printify_order_id FROM orders WHERE id = ?").bind(orderId).first();
    expect(failed).toEqual({ printify_submission_state: "ambiguous", printify_order_id: null });
    expect((await consume(runtime, orderId)).ack).toHaveBeenCalledOnce();
    expect(posts).toBe(1);
    expect((await env.ORDERS_DB.prepare("SELECT printify_order_id FROM orders WHERE id = ?").bind(orderId).first()).printify_order_id).toBe("remote-" + event.data.object.id);
  });

  it("never repeats an ambiguous POST while the remote order is temporarily absent from listings", async () => {
    const { runtime, event, orderId } = await seedOrder(); let posts = 0, visible = false;
    vi.stubGlobal("fetch", vi.fn(async (input, init = {}) => {
      if (init.method === "POST") { posts++; throw new Error("Local simulated timeout after acceptance"); }
      return list(visible ? [remoteOrder(event)] : []);
    }));
    await consume(runtime, orderId);
    expect((await consume(runtime, orderId)).retry).toHaveBeenCalledOnce();
    expect(posts).toBe(1);
    visible = true; expect((await consume(runtime, orderId)).ack).toHaveBeenCalledOnce();
    expect(posts).toBe(1);
  });

  it("reconciles legacy failed attempts before submitting anything", async () => {
    const { runtime, event, orderId } = await seedOrder();
    await env.ORDERS_DB.prepare("UPDATE orders SET fulfillment_attempts = 1, fulfillment_status = 'failed', printify_submission_state = 'ambiguous', printify_post_started_at = unixepoch() WHERE id = ?").bind(orderId).run();
    vi.stubGlobal("fetch", vi.fn(async (input, init = {}) => {
      expect(init.method).not.toBe("POST"); return list([remoteOrder(event)]);
    }));
    expect((await consume(runtime, orderId)).ack).toHaveBeenCalledOnce(); expect(fetch).toHaveBeenCalledOnce();
  });

  it.each([409, 400])("recovers provider duplicate rejection HTTP %s without another POST", async status => {
    const { runtime, event, orderId } = await seedOrder(); let posts = 0;
    vi.stubGlobal("fetch", vi.fn(async (input, init = {}) => {
      if (init.method === "POST") { posts++; return Response.json({ message: "Local duplicate rejection" }, { status }); }
      return list([remoteOrder(event)]);
    }));
    await consume(runtime, orderId); expect((await consume(runtime, orderId)).ack).toHaveBeenCalledOnce();
    expect(posts).toBe(1);
  });

  it("handles provider idempotent success and signed-job replay without resubmission", async () => {
    const { runtime, event, orderId } = await seedOrder();
    vi.stubGlobal("fetch", vi.fn(async (input, init) => {
      expect(init.method).toBe("POST"); return Response.json(remoteOrder(event, "existing-provider-id"));
    }));
    expect((await consume(runtime, orderId)).ack).toHaveBeenCalledOnce();
    expect((await consume(runtime, orderId)).ack).toHaveBeenCalledOnce(); expect(fetch).toHaveBeenCalledOnce();
  });

  it("continues a bounded reconciliation scan beyond 200 remote orders using its saved cursor", async () => {
    const { runtime, event, orderId } = await seedOrder();
    await env.ORDERS_DB.prepare("UPDATE orders SET fulfillment_attempts = 1, fulfillment_status = 'failed', printify_submission_state = 'ambiguous', printify_post_started_at = unixepoch() WHERE id = ?").bind(orderId).run();
    const pages = [];
    vi.stubGlobal("fetch", vi.fn(async (input, init = {}) => {
      expect(init.method).not.toBe("POST"); const page = Number(new URL(String(input)).searchParams.get("page")); pages.push(page);
      return list(page === 21 ? [remoteOrder(event)] : [], page, 21);
    }));
    expect((await consume(runtime, orderId)).retry).toHaveBeenCalledOnce();
    expect((await env.ORDERS_DB.prepare("SELECT printify_reconciliation_page AS page FROM orders WHERE id = ?").bind(orderId).first()).page).toBe(21);
    expect((await consume(runtime, orderId)).ack).toHaveBeenCalledOnce();
    expect(pages).toEqual(Array.from({ length: 21 }, (_, i) => i + 1));
  });

  it("prevents two concurrent consumers from submitting the same initial order", async () => {
    const { runtime, event, orderId } = await seedOrder();
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(remoteOrder(event))));
    await Promise.all([consume(runtime, orderId), consume(runtime, orderId)]);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("refuses even a legacy database test order when given a live Printify token", async () => {
    const { runtime, orderId } = await seedOrder();
    await env.ORDERS_DB.prepare("UPDATE orders SET livemode = 0 WHERE id = ?").bind(orderId).run();
    vi.stubGlobal("fetch", vi.fn());
    expect((await consume(runtime, orderId)).ack).toHaveBeenCalledOnce(); expect(fetch).not.toHaveBeenCalled();
  });
});
