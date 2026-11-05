import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const files = [
  "../assets/vendor/jspdf-4.2.1.umd.min.js",
  "../assets/vendor/jspdf-autotable-5.0.9.min.js",
  "../assets/js/registration-roster-pdf.js",
];
const sources = await Promise.all(files.map(file => readFile(new URL(file, import.meta.url), "utf8")));

function pdfRuntime() {
  const context = vm.createContext({ console, Blob, TextEncoder, TextDecoder, atob, btoa, setTimeout, clearTimeout, URL });
  context.window = context;
  context.self = context;
  context.navigator = { userAgent: "Local PDF regression test" };
  context.HTMLAnchorElement = function () {};
  context.HTMLAnchorElement.prototype.download = "";
  context.document = { createElementNS: () => ({ dispatchEvent() {}, style: {} }), createElement: () => ({ style: {} }) };
  for (let index = 0; index < sources.length; index++) vm.runInContext(sources[index], context, { filename: files[index] });
  return context;
}

function record(id) {
  return { id, registrationCode: "LOCAL-TEST-" + String(id).padStart(4, "0"), firstName: "Synthetic", lastName: "Attendee " + id,
    status: id === 1 ? "confirmed" : "awaiting_payment", amountDueCents: 2500, amountPaidCents: id === 1 ? 2500 : 0, currency: "usd" };
}

test("compact PDF contains all 601 registrations on shared pages using the real PDF libraries", () => {
  const runtime = pdfRuntime();
  const records = Array.from({ length: 601 }, (_, index) => record(601 - index));
  const doc = runtime.HACYPAA_REGISTRATION_ROSTER_PDF.create(records);
  const pages = doc.getNumberOfPages();
  assert.ok(pages > 1 && pages < 60, "601 short rows should share pages, not produce one page per attendee");
  const content = doc.internal.pages.slice(1).map(page => page.join("\n")).join("\n");
  for (const row of records) assert.ok(content.includes(row.registrationCode), "Missing " + row.registrationCode);
  assert.ok(content.includes("Page 1 of " + pages));
  assert.ok(Buffer.from(doc.output("arraybuffer")).subarray(0, 5).equals(Buffer.from("%PDF-")));
  console.log("Compact 601-registration PDF: " + pages + " pages");
});

test("compact PDF preserves unknown payments, zero payments and overpayments", () => {
  const runtime = pdfRuntime();
  const rows = [
    { ...record(1), amountPaidCents: null },
    { ...record(2), amountPaidCents: 0 },
    { ...record(3), amountPaidCents: 3000 },
  ];
  const before = structuredClone(rows);
  const doc = runtime.HACYPAA_REGISTRATION_ROSTER_PDF.create(rows);
  const cells = doc.lastAutoTable.body.map(row => row.cells);
  assert.equal(cells[0][4].text.join(" "), "Not recorded");
  assert.equal(cells[0][5].text.join(" "), "Not recorded");
  assert.equal(cells[1][4].text.join(" "), "0.00 USD");
  assert.equal(cells[1][5].text.join(" "), "25.00 USD");
  assert.equal(cells[2][5].text.join(" "), "-5.00 USD");
  assert.deepEqual(rows, before, "PDF generation must not alter stored values");
});

test("compact PDF wraps long names and refuses an empty export", () => {
  const runtime = pdfRuntime();
  const rows = Array.from({ length: 40 }, (_, index) => ({ ...record(index + 1), lastName: "A long attendee name with several words ".repeat(4) }));
  const doc = runtime.HACYPAA_REGISTRATION_ROSTER_PDF.create(rows);
  assert.ok(doc.getNumberOfPages() > 1 && doc.getNumberOfPages() < rows.length / 2);
  assert.equal(doc.lastAutoTable.body.length, 40);
  assert.throws(() => runtime.HACYPAA_REGISTRATION_ROSTER_PDF.create([]), /no registration records/);
});
