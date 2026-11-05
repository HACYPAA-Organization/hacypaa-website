(function (root) {
  "use strict";

  const statusLabels = {
    awaiting_payment: "Awaiting payment",
    payment_reported: "Payment reported",
    confirmed: "Confirmed",
    payment_not_found: "Payment not found",
    cancelled: "Cancelled",
  };

  function text(value) {
    return String(value ?? "").replace(/\r\n?/g, "\n").replace(/[\u2010-\u2015\u2212]/g, "-").trim();
  }

  function amount(value) {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
  }

  function money(value, currency) {
    if (value === null) return "Not recorded";
    const code = /^[a-z]{3}$/i.test(String(currency || "")) ? String(currency).toUpperCase() : "currency unknown";
    return (value / 100).toFixed(2) + " " + code;
  }

  function create(registrations) {
    const PdfClass = root.jspdf?.jsPDF;
    if (typeof PdfClass !== "function" || typeof PdfClass.API?.autoTable !== "function") {
      throw new Error("PDF tools did not load. Reload the page and try again.");
    }
    if (!Array.isArray(registrations) || registrations.length === 0) throw new Error("There are no registration records to export.");

    const doc = new PdfClass({ orientation: "landscape", unit: "pt", format: "letter", compress: true });
    doc.setProperties({ title: "HACYPAA XI - Registration roster", author: "HACYPAA XI" });
    const generated = new Date().toLocaleString("en-US");
    const width = doc.internal.pageSize.getWidth(), height = doc.internal.pageSize.getHeight();
    const body = registrations.map(record => {
      const due = amount(record.amountDueCents), paid = amount(record.amountPaidCents);
      return [
        text(record.registrationCode) || "Not recorded",
        [text(record.firstName), text(record.lastName)].filter(Boolean).join(" ") || "Not recorded",
        statusLabels[record.status] || text(record.status) || "Not recorded",
        money(due, record.currency), money(paid, record.currency),
        money(due === null || paid === null ? null : due - paid, record.currency),
      ];
    });
    doc.autoTable({
      startY: 80, margin: { top: 80, right: 30, bottom: 36, left: 30 },
      theme: "striped", showHead: "everyPage", rowPageBreak: "avoid",
      head: [["Registration", "Attendee", "Status", "Amount due", "Amount paid", "Balance"]],
      body,
      styles: { font: "helvetica", fontSize: 8, cellPadding: 5, overflow: "linebreak", textColor: [25, 23, 20] },
      headStyles: { fillColor: [24, 23, 20], textColor: [245, 239, 227], fontStyle: "bold" },
      alternateRowStyles: { fillColor: [250, 247, 240] },
      columnStyles: { 0: { cellWidth: 104 }, 1: { cellWidth: 210 }, 2: { cellWidth: 145 },
        3: { cellWidth: 91, halign: "right" }, 4: { cellWidth: 91, halign: "right" }, 5: { cellWidth: 91, halign: "right" } },
      willDrawPage() {
        doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(211, 19, 48);
        doc.text("HACYPAA XI | DIVINE PARADOX", 30, 26);
        doc.setFontSize(18); doc.setTextColor(25, 23, 20); doc.text("Registration roster", 30, 47);
        doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(90);
        doc.text(registrations.length + " registrations | Generated " + generated, 30, 63);
        doc.setDrawColor(211, 19, 48); doc.setLineWidth(0.8); doc.line(30, 71, width - 30, 71);
      },
    });
    const pages = doc.getNumberOfPages();
    for (let page = 1; page <= pages; page++) {
      doc.setPage(page); doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(90);
      doc.text("HACYPAA XI | Registration roster", 30, height - 16);
      doc.text("Page " + page + " of " + pages, width - 30, height - 16, { align: "right" });
    }
    return doc;
  }

  root.HACYPAA_REGISTRATION_ROSTER_PDF = Object.freeze({ create });
})(typeof window === "undefined" ? globalThis : window);
