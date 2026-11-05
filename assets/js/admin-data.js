(function (root) {
  "use strict";
  async function fetchPage(apiBase, resource, token, cursor) {
    const url = new URL(apiBase + "/admin/" + resource);
    url.searchParams.set("limit", "100");
    if (cursor) url.searchParams.set("cursor", cursor);
    return root.fetch(url.href, { headers: { Authorization: "Bearer " + token }, cache: "no-store" });
  }

  async function fetchAll(apiBase, resource, token, canRead) {
    const records = [], seen = new Set(); let cursor = null, total, snapshot;
    do {
      if (!canRead()) throw new Error("Access changed. Sign in again before exporting.");
      const response = await fetchPage(apiBase, resource, token, cursor);
      if (!response.ok) return response;
      const data = await response.json();
      if (data.ok !== true || !Array.isArray(data[resource]) || !data.pagination || !Number.isSafeInteger(data.total)) {
        throw new Error("Incomplete export response. No file was downloaded.");
      }
      if (total === undefined) { total = data.total; snapshot = data.pagination.snapshot; }
      if (data.total !== total || data.pagination.snapshot !== snapshot) {
        throw new Error("Records changed during export. Refresh and try again.");
      }
      records.push(...data[resource]);
      cursor = data.pagination.nextCursor;
      if (cursor && seen.has(cursor)) throw new Error("Pagination did not advance. No file was downloaded.");
      if (cursor) seen.add(cursor);
    } while (cursor);
    if (records.length !== total) throw new Error("Export was incomplete. Refresh and try again.");
    return new Response(JSON.stringify({ ok: true, [resource]: records, total }), { headers: { "Content-Type": "application/json" } });
  }

  root.HACYPAA_ADMIN_DATA = { fetchPage, fetchAll };
})(typeof window === "undefined" ? globalThis : window);
