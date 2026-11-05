import { InputError } from "./request-security.js";

const TABLES = new Set(["registrations", "panelist_volunteers"]);

function decodeCursor(raw, table) {
  if (!raw) return null;
  try {
    if (raw.length > 512 || !/^[A-Za-z0-9_-]+$/.test(raw)) throw new Error();
    const c = JSON.parse(atob(raw.replaceAll("-", "+").replaceAll("_", "/")));
    if (c.v !== 1 || c.table !== table || !Number.isSafeInteger(c.id) || c.id < 1 ||
      !Number.isSafeInteger(c.createdAt) || c.createdAt < 0 || !Number.isSafeInteger(c.snapshot) || c.snapshot < c.id) throw new Error();
    return c;
  } catch { throw new InputError("Invalid pagination cursor"); }
}

export async function loadAdminPage(db, request, table, selectSql) {
  if (!TABLES.has(table)) throw new Error("Unsupported admin list");
  const params = new URL(request.url).searchParams;
  const limitText = params.get("limit") || "100";
  if (!/^\d+$/.test(limitText) || Number(limitText) < 1 || Number(limitText) > 200) throw new InputError("Page size must be between 1 and 200");
  const limit = Number(limitText), cursor = decodeCursor(params.get("cursor"), table);
  const snapshot = cursor?.snapshot ?? (await db.prepare(`SELECT coalesce(max(id), 0) AS snapshot FROM ${table}`).first()).snapshot;
  const statuses = table === "registrations" ? ["awaiting_payment", "payment_reported", "confirmed", "payment_not_found", "cancelled"] : ["new", "selected", "not_selected"];
  const summary = await db.prepare(`SELECT count(*) AS total, ${statuses.map(status =>
    `coalesce(sum(CASE WHEN status = '${status}' THEN 1 ELSE 0 END), 0) AS ${status}`).join(", ")}
    FROM ${table} WHERE id <= ?`).bind(snapshot).first();
  const args = [snapshot];
  const cursorWhere = cursor ? " AND (created_at < ? OR (created_at = ? AND id < ?))" : "";
  if (cursor) args.push(cursor.createdAt, cursor.createdAt, cursor.id);
  args.push(limit + 1);
  const result = await db.prepare(`${selectSql} WHERE id <= ?${cursorWhere} ORDER BY created_at DESC, id DESC LIMIT ?`).bind(...args).all();
  const hasMore = result.results.length > limit, rows = result.results.slice(0, limit), last = rows.at(-1);
  const nextCursor = hasMore ? btoa(JSON.stringify({ v: 1, table, snapshot, id: last.id, createdAt: last.createdAt }))
    .replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "") : null;
  return { results: rows, total: summary.total, counts: Object.fromEntries(statuses.map(status => [status, summary[status]])),
    pagination: { total: summary.total, limit, nextCursor, hasMore, snapshot } };
}
