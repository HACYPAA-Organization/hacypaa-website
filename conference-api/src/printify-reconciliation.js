const PAGES_PER_ATTEMPT = 20;

function remoteMatch(records, sessionId) {
  const matches = records.filter(order => [order.external_id, order.metadata?.shop_order_id]
    .some(id => (typeof id === "string" || typeof id === "number") && String(id) === sessionId));
  const unique = new Map(matches.map(order => [order.id, order]));
  if (unique.size > 1) throw new Error("Multiple remote orders share this external ID; manual review is required");
  const found = unique.values().next().value;
  if (found && (typeof found.id !== "string" || !found.id)) throw new Error("Invalid Printify order identity");
  return found ? { id: found.id, status: found.status || "pending" } : null;
}

export async function findRemotePrintifyOrder(env, order) {
  let page = order.printify_reconciliation_page || 1;
  // Each attempt has a bounded request budget, while its persisted cursor can
  // traverse arbitrarily many pages. An incomplete scan never permits a POST.
  for (let scanned = 0; scanned < PAGES_PER_ATTEMPT; scanned++, page++) {
    const url = new URL(`https://api.printify.com/v1/shops/${encodeURIComponent(env.PRINTIFY_SHOP_ID.trim())}/orders.json`);
    url.searchParams.set("limit", "10"); url.searchParams.set("page", String(page));
    const response = await fetch(url.href, { headers: {
      Authorization: "Bearer " + env.PRINTIFY_API_TOKEN.trim(), Accept: "application/json", "User-Agent": "HACYPAA Checkout API",
    }, signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error("Printify reconciliation unavailable");
    const data = await response.json();
    if (!Array.isArray(data?.data) || !Number.isInteger(data.current_page) || data.current_page !== page ||
      !Number.isSafeInteger(data.last_page) || data.last_page < page) {
      throw new Error("Printify reconciliation is incomplete; manual review is required");
    }
    const found = remoteMatch(data.data, order.stripe_session_id);
    if (found || page === data.last_page) {
      await env.ORDERS_DB.prepare("UPDATE orders SET printify_reconciliation_page = 1, last_printify_reconciliation_at = unixepoch() WHERE id = ?").bind(order.id).run();
      return found;
    }
  }
  await env.ORDERS_DB.prepare("UPDATE orders SET printify_reconciliation_page = ?, last_printify_reconciliation_at = unixepoch() WHERE id = ?").bind(page, order.id).run();
  throw new Error("Printify reconciliation scan will continue from its saved page");
}

export async function markPrintifySubmissionIntent(db, orderId) {
  const result = await db.prepare(`UPDATE orders SET printify_submission_state = 'post_started',
    printify_post_started_at = unixepoch(), updated_at = unixepoch()
    WHERE id = ? AND livemode = 1 AND printify_order_id IS NULL AND fulfillment_status = 'submitting'
    AND printify_submission_state = 'new' AND printify_post_started_at IS NULL`).bind(orderId).run();
  if (result.meta.changes !== 1) throw new Error("Order cannot be safely submitted; reconcile the previous attempt");
}

export async function reconcileOutstandingFulfillment(env, recordSubmission) {
  if (env.FULFILLMENT_MODE !== "live" || !/^(?:sk|rk)_live_[A-Za-z0-9]+$/.test(env.STRIPE_SECRET_KEY || "") ||
    !env.PRINTIFY_SHOP_ID || !env.PRINTIFY_API_TOKEN) return;
  const pending = await env.ORDERS_DB.prepare(`SELECT id, stripe_session_id, printify_reconciliation_page FROM orders WHERE livemode = 1
    AND printify_order_id IS NULL AND printify_post_started_at IS NOT NULL
    AND fulfillment_status IN ('failed', 'submitting') AND updated_at < unixepoch() - 300
    AND coalesce(last_printify_reconciliation_at, 0) < unixepoch() - 3600
    ORDER BY coalesce(last_printify_reconciliation_at, 0) LIMIT 1`).all();
  for (const order of pending.results) {
    try {
      const remote = await findRemotePrintifyOrder(env, order);
      if (remote) await recordSubmission(env.ORDERS_DB, order.id, remote);
      else await env.ORDERS_DB.prepare("UPDATE orders SET printify_submission_state = 'needs_review' WHERE id = ? AND printify_order_id IS NULL").bind(order.id).run();
    } catch { console.error("Printify reconciliation remains pending", { orderId: order.id }); }
  }
}
