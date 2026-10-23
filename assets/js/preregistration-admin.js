(function () {
    "use strict";

    const apiBase = [
        "localhost",
        "127.0.0.1",
    ].includes(window.location.hostname)
        ? "http://127.0.0.1:8787"
        : "https://checkout-api.tgp-services.workers.dev";

    const adminAuth = window.HACYPAA_ADMIN_AUTH;
    const loginFeedback =
        document.querySelector("#admin-login-feedback");

    const dashboard =
        document.querySelector("#admin-dashboard");
    const refreshButton =
        document.querySelector("#admin-refresh");
    const logoutButton =
        document.querySelector("#admin-logout");
    const summary =
        document.querySelector("#admin-summary");
    const feedback =
        document.querySelector("#admin-feedback");
    const tableBody =
        document.querySelector("#registration-rows");
    const emptyMessage =
        document.querySelector("#admin-empty");
    const registrationViewButton =
        document.querySelector("#admin-view-registrations");
    const volunteerViewButton =
        document.querySelector("#admin-view-volunteers");
    const registrationView =
        document.querySelector("#admin-registration-view");
    const volunteerView =
        document.querySelector("#admin-volunteer-view");
    const panelistSummary =
        document.querySelector("#admin-panelist-summary");
    const panelistFeedback =
        document.querySelector("#admin-panelist-feedback");
    const panelistTableBody =
        document.querySelector("#panelist-rows");
    const panelistEmptyMessage =
        document.querySelector("#admin-panelist-empty");
    const exportRegistrationsButton =
        document.querySelector("#admin-export-registrations");
    const exportPanelistsButton =
        document.querySelector("#admin-export-panelists");
    const exportRegistrationsPdfButton =
        document.querySelector("#admin-export-registrations-pdf");
    const exportPanelistsPdfButton =
        document.querySelector("#admin-export-panelists-pdf");

    if (
        !adminAuth ||
        !loginFeedback ||
        !dashboard ||
        !refreshButton ||
        !logoutButton ||
        !summary ||
        !feedback ||
        !tableBody ||
        !emptyMessage ||
        !registrationViewButton ||
        !volunteerViewButton ||
        !registrationView ||
        !volunteerView ||
        !panelistSummary ||
        !panelistFeedback ||
        !panelistTableBody ||
        !panelistEmptyMessage ||
        !exportRegistrationsButton ||
        !exportPanelistsButton ||
        !exportRegistrationsPdfButton ||
        !exportPanelistsPdfButton
    ) {
        return;
    }

    function showLogin(message = "") {
        adminAuth.showLogin(message);
    }

    function showDashboard() {
        dashboard.hidden = false;
        loginFeedback.textContent = "";
    }

    function setFeedback(message, state = "") {
        feedback.textContent = message;

        if (state) {
            feedback.dataset.state = state;
        } else {
            delete feedback.dataset.state;
        }
    }

    let activeView = "registrations";

    let permissions = {
        registrations: false,
        volunteers: false,
    };

    let currentPanelists = [];

    function setPanelistFeedback(message, state = "") {
        panelistFeedback.textContent = message;

        if (state) {
            panelistFeedback.dataset.state = state;
        } else {
            delete panelistFeedback.dataset.state;
        }
    }

    function showAdminView(viewName) {
        if (!permissions[viewName]) {
            return;
        }
        const showVolunteers =
            viewName === "volunteers";

        activeView = showVolunteers
            ? "volunteers"
            : "registrations";

        registrationView.hidden = showVolunteers;
        volunteerView.hidden = !showVolunteers;

        registrationViewButton.setAttribute(
            "aria-pressed",
            String(!showVolunteers),
        );

        volunteerViewButton.setAttribute(
            "aria-pressed",
            String(showVolunteers),
        );
    }

    const statusLabels = {
        awaiting_payment: "Awaiting payment",
        payment_reported: "Payment reported",
        confirmed: "Confirmed",
        payment_not_found: "Payment not found",
        cancelled: "Cancelled",
    };

    const paymentLabels = {
        cash: "Cash",
        cash_app: "Cash App",
        venmo: "Venmo",
    };

    function formatDate(unixSeconds) {
        const value = Number(unixSeconds);

        if (!Number.isFinite(value) || value <= 0) {
            return "—";
        }

        return new Intl.DateTimeFormat("en-US", {
            dateStyle: "medium",
            timeStyle: "short",
        }).format(new Date(value * 1000));
    }

    function addCell(row, text) {
        const cell = document.createElement("td");
        cell.textContent = text;
        row.append(cell);

        return cell;
    }

    function createActionButton(
        label,
        nextStatus,
        tone = "",
    ) {
        const button = document.createElement("button");

        button.type = "button";
        button.className = "admin-row-button";
        button.textContent = label;
        button.dataset.nextStatus = nextStatus;

        if (tone) {
            button.dataset.tone = tone;
        }

        return button;
    }

    function renderRegistrations(registrations) {
        tableBody.replaceChildren();

        const reportedCount = registrations.filter(
            (registration) =>
                registration.status === "payment_reported",
        ).length;

        const confirmedCount = registrations.filter(
            (registration) =>
                registration.status === "confirmed",
        ).length;

        summary.textContent =
            `${registrations.length} total · ` +
            `${reportedCount} awaiting verification · ` +
            `${confirmedCount} confirmed`;

        emptyMessage.hidden = registrations.length !== 0;

        for (const registration of registrations) {
            const row = document.createElement("tr");

            row.dataset.registrationCode =
                String(registration.registrationCode || "");

            const attendeeCell = addCell(
                row,
                `${registration.firstName || ""} ` +
                `${registration.lastName || ""}`.trim(),
            );

            const email = document.createElement("small");
            const lineBreak = document.createElement("br");

            email.textContent =
                registration.email || "Unknown";
            attendeeCell.append(lineBreak, email);

            addCell(
                row,
                registration.homeGroup || "Not provided",
            );

            const fellowships = [
                registration.fellowshipAa
                    ? "Alcoholics Anonymous"
                    : null,
                registration.fellowshipAlanon
                    ? "Al-Anon, Alateen, or AFG"
                    : null,
            ]
                .filter(Boolean)
                .join(", ") || "None selected";

            const accommodations = [
                registration.accommodationMobility
                    ? "Mobility assistance"
                    : null,
                registration.accommodationAsl
                    ? "ASL interpreter"
                    : null,
                registration.accommodationDetails || null,
            ]

                .filter(Boolean)
                .join("; ") || "None reported";

            const detailsCell = addCell(
                row,
                [
                    `Phone: ${registration.phoneNumber || "Not provided"}`,
                    `Sobriety date: ${registration.sobrietyDate || "Not provided"}`,
                    `Location: ${registration.location || "Not provided"}`,
                    `Fellowship: ${fellowships}`,
                    `Dietary restrictions: ${registration.dietaryRestrictions || "None reported"}`,
                    `Accommodations: ${accommodations}`,
                    `Volunteer: ${
                        registration.volunteerInterest ? "Yes" : "No"
                    }`,
                    `Scholarship donation: ${
                        registration.scholarshipDonation ? "Yes" : "No"
                    }`,
                    `Preferred payment: ${
                        paymentLabels[
                            registration.preferredPaymentMethod
                        ] || "Not provided"
                    }`,
                ].join("\n"),
            );

            detailsCell.style.whiteSpace = "pre-line";

            addCell(
                row,
                registration.registrationCode || "—",
            );

            addCell(
                row,
                statusLabels[registration.status] ||
                registration.status ||
                "Unknown",
            );

            let paymentText =
                paymentLabels[registration.paymentMethod] ||
                "Not reported";

            if (registration.paymentSenderHandle) {
                paymentText +=
                    ` · ${registration.paymentSenderHandle}`;
            }

            addCell(row, paymentText);

            const notesCell = addCell(row, "");
            notesCell.classList.add("admin-followup-cell");

            const contactedLabel = document.createElement("label");
            contactedLabel.className = "admin-followup-toggle";

            const contactedInput = document.createElement("input");
            contactedInput.type = "checkbox";
            contactedInput.dataset.accessibilityContacted = "";
            contactedInput.checked = Boolean(
                registration.accessibilityContactedAt,
            );

            contactedLabel.append(
                contactedInput,
                document.createTextNode("Accessibility needs discussed"),
            );

            const notesInput = document.createElement("textarea");
            notesInput.className = "admin-row-notes";
            notesInput.dataset.accessibilityNotes = "";
            notesInput.rows = 3;
            notesInput.maxLength = 5000;
            notesInput.value = registration.accessibilityNotes || "";
            notesInput.placeholder = "Accessibility follow-up notes";
            notesInput.setAttribute(
                "aria-label",
                `Accessibility notes for ${registration.registrationCode}`,
            );

            const contactSummary = document.createElement("small");
            contactSummary.className = "admin-followup-status";
            contactSummary.dataset.accessibilitySummary = "";
            contactSummary.textContent = registration.accessibilityContactedAt
                ? `Discussed ${formatDate(registration.accessibilityContactedAt)}`
                : "No discussion recorded";

            notesCell.append(
                contactedLabel,
                notesInput,
                contactSummary,
            );

            addCell(row, formatDate(registration.createdAt));

            const actionsCell = addCell(row, "");
            actionsCell.classList.add("admin-row-actions");

            const saveFollowupButton = document.createElement("button");
            saveFollowupButton.type = "button";
            saveFollowupButton.className = "admin-row-button";
            saveFollowupButton.dataset.accessibilitySave = "";
            saveFollowupButton.textContent = "Save";
            saveFollowupButton.setAttribute(
                "aria-label",
                `Save accessibility follow-up for ${registration.registrationCode}`,
            );

            actionsCell.append(saveFollowupButton);

            if (registration.status === "payment_reported") {
                actionsCell.append(
                    createActionButton(
                        "Confirm",
                        "confirmed",
                        "success",
                    ),
                    createActionButton(
                        "Payment not found",
                        "payment_not_found",
                        "danger",
                    ),
                );
            } else if (
                registration.status === "payment_not_found"
            ) {
                actionsCell.append(
                    createActionButton(
                        "Confirm",
                        "confirmed",
                        "success",
                    ),
                    createActionButton(
                        "Cancel",
                        "cancelled",
                        "danger",
                    ),
                );
            } else if (
                registration.status === "awaiting_payment"
            ) {
                actionsCell.append(
                    createActionButton(
                        "Cancel",
                        "cancelled",
                        "danger",
                    ),
                );
            } else if (
                registration.status === "confirmed"
            ) {
                actionsCell.append(
                    createActionButton(
                        "Unconfirm",
                        "payment_reported",
                        "danger",
                    ),
                );
            } else if (
                registration.status === "cancelled"
            ) {
                const restoredStatus =
                registration.paymentReportedAt
                    ? "payment_reported"
                    : "awaiting_payment";

                actionsCell.append(
                    createActionButton(
                        "Uncancel",
                        restoredStatus,
                        "success",
                    ),
                );
            } else {
                actionsCell.textContent = "—";
            }

            const deleteButton = document.createElement("button");
            deleteButton.type = "button";
            deleteButton.className = "admin-row-button";
            deleteButton.dataset.tone = "danger";
            deleteButton.dataset.registrationDelete = "";
            deleteButton.textContent = "Delete";
            deleteButton.disabled = !permissions.registrations;
            deleteButton.setAttribute(
                "aria-label",
                `Dete registration ${registration.registrationCode}`,
            );

            deleteButton.addEventListener("click", function () {
                void deleteRegistration(row, deleteButton);
            });

            actionsCell.append(deleteButton);
            tableBody.append(row);
        }
    }

    const panelistStatusLabels = {
        new: "New",
        contacted: "Contacted",
        selected: "Selected",
        declined: "Declined",
    };

    function renderPanelists(panelists) {
        panelistTableBody.replaceChildren();
        currentPanelists = [...panelists];

        const newCount = panelists.filter(
            (panelist) => panelist.status === "new",
        ).length;

        const selectedCount = panelists.filter(
            (panelist) => panelist.status === "selected",
        ).length;

        panelistSummary.textContent =
            `${panelists.length} total · ` +
            `${newCount} new · ` +
            `${selectedCount} selected`;

        panelistEmptyMessage.hidden =
            panelists.length !== 0;

        for (const panelist of panelists) {
            const row = document.createElement("tr");

            const applicantCell = addCell(
                row,
                `${panelist.firstName || ""} ` +
                    `${panelist.lastName || ""}`.trim(),
            );

            const email = document.createElement("small");
            const phone = document.createElement("small");

            email.textContent =
                panelist.email || "Email not provided";
            phone.textContent =
                panelist.phoneNumber ||
                "Phone not provided";

            applicantCell.append(
                document.createElement("br"),
                email,
                document.createElement("br"),
                phone,
            );

            addCell(
                row,
                Array.isArray(panelist.stepPreferences)
                    ? panelist.stepPreferences.join(", ")
                    : "None selected",
            );

            const recoveryCell = addCell(
                row,
                [
                    `Sobriety date: ${
                        panelist.sobrietyDate || "Not provided"
                    }`,
                    `Sponsor: ${
                        panelist.hasSponsor ? "Yes" : "No"
                    }`,
                    `Worked Steps: ${
                        panelist.workedSteps ? "Yes" : "No"
                    }`,
                ].join("\n"),
            );

            recoveryCell.style.whiteSpace = "pre-line";

            const locationCell = addCell(
                row,
                [
                    panelist.location || "Not provided",
                    panelist.hasHomeGroup
                        ? `Home group: ${
                            panelist.homeGroup ||
                            "Not Provided"
                        }`
                        : "No home group",
                ].join("\n"),
            );

            locationCell.style.whiteSpace = "pre-line";

            addCell(
                row,
                panelist.topicPreferences ||
                    "No topic preferences provided",
            );

            row.dataset.panelistId = String(panelist.id);

            const statusCell = addCell(row, "");
            const statusSelect = document.createElement("select");

            statusSelect.className = "admin-row-select";
            statusSelect.dataset.panelistStatus = "";
            statusSelect.setAttribute(
                "aria-label",
                `Status for panelist application ${panelist.id}`,
            );

            for (const [value, label] of Object.entries(panelistStatusLabels))
            {
                const option = document.createElement("option");
                option.value = value;
                option.textContent = label;
                statusSelect.append(option);
            }

            statusSelect.value = panelist.status || "new";
            statusCell.append(statusSelect);

            const notesCell = addCell(row, "");
            const notesInput = document.createElement("textarea");

            notesInput.className = "admin-row-notes";
            notesInput.dataset.panelistNotes = "";
            notesInput.rows = 3;
            notesInput.maxLength = 5000;
            notesInput.value = panelist.adminNotes || "";
            notesInput.setAttribute(
                "aria-label",
                `Admin notes for panelist application ${panelist.id}`,
            );

            notesCell.append(notesInput);

            addCell(
                row,
                formatDate(panelist.createdAt),
            );

            const actionsCell = addCell(row, "");
            const saveButton = document.createElement("button");

            saveButton.type = "button";
            saveButton.className = "admin-row-button";
            saveButton.dataset.panelistSave = "";
            saveButton.textContent = "Save";
            saveButton.setAttribute(
                "aria-label",
                `Save panelist application ${panelist.id}`,
            );

            actionsCell.classList.add("admin-row-actions");

            const deleteButton = document.createElement("button");
            deleteButton.type = "button";
            deleteButton.className = "admin-row-button";
            deleteButton.dataset.tone = "danger";
            deleteButton.dataset.panelistDelete = "";
            deleteButton.textContent = "Delete";
            deleteButton.disabled = !permissions.volunteers;
            deleteButton.setAttribute(
                "aria-label",
                `Delete panelist application ${panelist.id}`,
            );

            deleteButton.addEventListener("click", function () {
                void deletePanelist(row, deleteButton);
            });

            actionsCell.append(saveButton, deleteButton);
            panelistTableBody.append(row);
        }
    }

    async function savedPanelistChanges(row, button) {
        const panelistId = Number(row.dataset.panelistId);
        const statusSelect = row.querySelector("[data-panelist-status]");
        const notesInput = row.querySelector("[data-panelist-notes]");

        if (
            button.disabled ||
            !Number.isSafeInteger(panelistId) ||
            panelistId <= 0 ||
            !statusSelect ||
            !notesInput
        ) {
            return;
        }

        button.disabled = true;
        statusSelect.disabled = true;
        notesInput.disabled = true;
        button.textContent = "Saving...";

        setPanelistFeedback(
            `Saving panelist application ${panelistId}...`,
            "panding",
        );

        try {
            const adminToken = await adminAuth.getAccessToken();

            if (!adminToken) {
                showLogin("Your admin session has expired.");
                return;
            }

            const response = await fetch(
                apiBase + "/admin/panelists",
                {
                    method: "PATCH",
                    headers: {
                        Authorization: `Bearer ${adminToken}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        panelistId,
                        status: statusSelect.value,
                        adminNotes: notesInput.value,
                    }),
                },
            );

            const data = await response.json().catch(() => null);

            if (
                response.status === 401 ||
                response.status === 403
            ) {
                await adminAuth.signOut();
                showLogin(
                    data?.error || "Your admin session has expired."
                );
                return;
            }

            if (
                !response.ok ||
                data?.ok !== true ||
                data?.panelist?.id !== panelistId
            ) {
                throw new Error(
                    data?.error || "Could not save panelist changes.",
                );
            }

            const savedPanelist = data.panelist;

            currentPanelists = currentPanelists.map((panelist) =>
                panelist.id === panelistId
                    ? { ...panelist, ...savedPanelist }
                    : panelist,
            );

            statusSelect.value = savedPanelist.status;
            notesInput.value = savedPanelist.adminNotes || "";

            const newCount = currentPanelists.filter(
                (panelist) => panelist.status === "new",
            ).length;

            const selectedCount = currentPanelists.filter(
                (panelist) => panelist.status === "selected",
            ).length;

            panelistSummary.textContent =
                `${currentPanelists.length} total · ` +
                `${newCount} new · ` +
                `${selectedCount} selected`;

            setPanelistFeedback(
                `Panelist application ${panelistId} saved.`,
                "success",
            );

        } catch (error) {
            setPanelistFeedback(
                error.message || "Could not save panelist changes.",
            );
        } finally {
            button.disabled = false;
            statusSelect.disabled = false;
            notesInput.disabled = false;
            button.textContent = "Save";
        }
    }

    function escapeCsvValue(value) {
        let text = String(value ?? "");

        if (/^[=+\-@]/.test(text.trimStart())) {
            text = `'${text}`;
        }

        return `"${text.replace(/"/g, '""')}"`;
    }

    function downloadAdminPdf(title, filename, records) {
        const PdfClass = window.jspdf?.jsPDF;

        if (
            typeof PdfClass !== "function" ||
            typeof PdfClass.API?.autoTable !== "function"
        ) {
            throw new Error("PDF tools did not load. Reload the page and try again.");
        }

        if (!Array.isArray(records) || records.length === 0) {
            throw new Error("There are no records to export.");
        }

        const pdfText = (value) => {
            const text = String(value ?? "")
                .replace(/\r\n?/g, "\n")
                .replace(/[\u2010-\u2015\u2212]/g, "-")
                .trim();

            return text || "Not provided";
        };

        const doc = new PdfClass({
            orientation: "portrait",
            unit: "pt",
            format: "letter",
            compress: true,
        });
        const generated = new Date().toLocaleString("en-US");

        doc.setProperties({
            title: "HACYPAA XI - " + title,
            author: "HACYPAA XI",
        });

        records.forEach((record, index) => {
            if (index > 0) {
                doc.addPage();
            }

            doc.autoTable({
                startY: 90,
                margin: { top: 90, right: 36, bottom: 48, left: 36 },
                theme: "grid",
                showHead: "everyPage",
                rowPageBreak: "avoid",
                head: [[{
                    content: pdfText(record.heading) + "\n" +
                    pdfText(record.reference),
                    colSpan: 2,
                }]],
                body: record.rows.map(([label, value]) => [
                    pdfText(label),
                    pdfText(value),
                ]),
                styles: {
                    font: "helvetica",
                    fontSize: 9,
                    cellPadding: 6,
                    overflow: "linebreak",
                    textColor: [25, 23, 20],
                    lineColor: [225, 218, 205],
                    lineWidth: 0.4,
                },
                headStyles: {
                    fillColor: [24, 23, 20],
                    textColor: [245, 239, 227],
                    fontSize: 11,
                    cellPadding: 8,
                },
                columnStyles: {
                    0: {
                        cellWidth: 140,
                        fontStyle: "bold",
                        fillColor: [250, 247, 240],
                    },
                },
                willDrawPage: () => {
                    doc.setFont("helvetica", "bold");
                    doc.setFontSize(10);
                    doc.setTextColor(211, 19, 48);
                    doc.text("HACYPAA XI | DIVINE PARADOX", 36, 30);

                    doc.setFontSize(18);
                    doc.setTextColor(25, 23, 20);
                    doc.text(title, 36, 52);

                    doc.setFont("helvetica", "normal");
                    doc.setFontSize(8);
                    doc.setTextColor(90);
                    doc.text(
                        "Generated" + generated + " | " + records.length + " records",
                        36,
                        69,
                    );

                    doc.setDrawColor(211, 19, 48);
                    doc.setLineWidth(0.8);
                    doc.line(36, 79, 576, 79);
                },
            });
        });

        const pageCount = doc.getNumberOfPages();

        for (let page = 1; page <= pageCount; page += 1) {
            doc.setPage(page);
            doc.setFont("helvetica", "normal");
            doc.setFontSize(8);
            doc.setTextColor(90);
            doc.setDrawColor(225, 218, 205);
            doc.setLineWidth(0.4);
            doc.line(36, 758, 576, 758);
            doc.text("HACYPAA XI | Admin export", 36, 771);
            doc.text(
                "Page " + page + " of " + pageCount,
                576,
                771,
                { align: "right" },
            );
        }

        doc.save(filename);
    }

    async function exportRegistrationsPdf() {
        if (
            !permissions.registrations ||
            exportRegistrationsPdfButton.disabled
        ) {
            return;
        }

        exportRegistrationsPdfButton.disabled = true;
        exportRegistrationsPdfButton.textContent = "Exporting...";
        setFeedback("Preparing registration PDF...", "pending");

        try {
            const adminToken = await adminAuth.getAccessToken();

            if (!adminToken) {
                showLogin("Your admin session has expired.");
                return;
            }

            const response = await fetch(apiBase + "/admin/registrations", {
                headers: {
                    Authorization: "Bearer " + adminToken,
                },
                cache: "no-store",
            });
            const data = await response.json().catch(() => null);

            if (response.status === 401 || response.status === 403) {
                await adminAuth.signOut();
                showLogin(data?.error || "Your admin session has expired.");
                return;
            }

            if (
                !response.ok ||
                data?.ok !== true ||
                !Array.isArray(data.registrations)
            ) {
                throw new Error(data?.error || "Could not export registration PDF.");
            }

            if (!permissions.registrations || dashboard.hidden) {
                return;
            }

            if (data.registrations.length === 0) {
                setFeedback("There are no registration records to export.", "error");
                return;
            }

            const yesNo = (value) => value ? "Yes" : "No";
            const text = (value) => String(value ?? "").trim() || "Not Provided";

            const records = data.registrations.map((r) => ({
                heading: [r.firstName, r.lastName].filter(Boolean).join(" "),
                reference: r.registrationCode,
                rows: [
                    ["Contact", [
                        "Email: " + text(r.email),
                        "Phone: " + text(r.phoneNumber),
                        "Home group: " + text(r.homeGroup),
                    ].join("\n")],
                    ["Recovery", [
                        "Sobriety date: " + text(r.sobrietyDate),
                        "AA: " + yesNo(r.fellowshipAa),
                        "Al-Anon / Alateen / AFG: " + yesNo(r.fellowshipAlanon),
                    ].join("\n")],
                    ["Location", r.location],
                    ["Registration", [
                        "Status: " + (statusLabels[r.status] ||
                            test(r.status)),
                        "Submitted: " + formatDate(r.createAt),
                        "Updated: " + formatDate(r.updatedAt),
                    ].join("\n")],
                    ["Payment", [
                        "Amount due: " + (
                            r.amountDueCents == null
                                ? "Not provided"
                                : (Number(r.amountDueCents) / 100).toFixed(2)
                                    +
                                    " " + String(r.currency || "").toUpperCase()
                        ),
                        "Preferred method: " + (
                            paymentLabels[r.preferredPaymentMethod] ||
                            text(r.preferredPaymentMethod)
                        ),
                        "Reproted method: " + (
                            paymentLabels[r.paymentMethod] ||
                            r.paymentMethod || "Not reported"
                        ),
                        "Sender: " + text(r.paymentSenderHandle),
                        "Reference: " + text(r.paymentReference),
                        "Reported at: " + formatDate(r.paymentReportedAt),
                        "Confirmed at: " + formatDate(r.confirmedAt),
                    ].join("\n")],
                    ["Dietary restrictions", r.dietaryRestrictions || "None reported"],
                    ["Accommodations", [
                        "Mobility assistance: " + yesNo(r.accommodationMobility),
                        "ASL interpreter: " + yesNo(r.accommodationAsl),
                        "Other: " + (r.accommodationDetails || "None reported"),
                    ].join("\n")],
                    ["Accessibility follow-up", [
                        "Discussed: " + yesNo(r.accessibilityContactedAt),
                        "Discussed at: " + formatDate(r.accessibilityContactedAt),
                        "Discussed by: " + text(r.accessibilityContactedBy),
                    ].join("\n")],
                    ["Accessibility notes", r.accessibilityNotes || "No notes recorded"],
                    ["Volunteer interest", yesNo(r.volunteerInterest)],
                    ["Scholarship donation", yesNo(r.scholarshipDonation)],
                ],
            }));

            const date = new Date().toISOString().slice(0, 10);

            downloadAdminPdf(
                "Attendee registrations",
                "hacypaa-registrations-" + date + ".pdf",
                records,
            );

            setFeedback(
                records.length + " registration records exported to PDF.",
                "success",
            );
        } catch (error) {
            setFeedback(
                error?.message || "Could not export registrations PDF.",
                "error",
            );
        } finally {
            exportRegistrationsPdfButton.textContent = "Export PDF";
            exportRegistrationsPdfButton.disabled =
                !permissions.registrations || dashboard.hidden;
        }
    }

    async function exportRegistrations() {
        if (
            !permissions.registrations ||
            exportRegistrationsButton.disabled
        ) {
            return;
        }

        exportRegistrationsButton.disabled = true;
        exportRegistrationsButton.textContent = "Exporting...";
        setFeedback("Preparing registrations CSV...", "pending");

        try {
            const adminToken = await adminAuth.getAccessToken();

            if (!adminToken) {
                showLogin("Your admin session has expired.");
                return;
            }

            const response = await fetch(apiBase + "/admin/registrations", {
                headers: {
                    Authorization: "Bearer " + adminToken,
                },
                cache: "no-store",
            });
            const data = await response.json().catch(() => null);

            if (response.status ===401 || response.status === 403) {
                await adminAuth.signOut();
                showLogin(data?.error || "Your admin session has expired.");
                return;
            }

            if (
                !response.ok ||
                data?.ok !== true ||
                !Array.isArray(data.registrations)
            ) {
                throw new Error(data?.error || "Could not export registrations.");
            }

            if (!permissions.registrations || dashboard.hidden) {
                return;
            }

            if (data.registrations.length === 0) {
                setFeedback("There are no registration records to export.", "error");
                return;
            }

            const columns = [
                ["Registration code", (r) => r.registrationCode],
                ["First name", (r) => r.firstName],
                ["Last name", (r) => r.lastName],
                ["Email", (r) => r.email],
                ["Phone", (r) => r.phoneNumber],
                ["Sobriety date", (r) => r.sobrietyDate],
                ["Location", (r) => r.location],
                ["Home group", (r) => r.homeGroup],
                ["AA", (r) => r.fellowshipAa ? "Yes" : "No"],
                ["Al-Anon / Alateen / AFG", (r) => r.fellowshipAlanon ? "Yes" : "No"],
                ["Dietary restrictions", (r) => r.dietaryRestrictions],
                ["Mobility assistance", (r) => r.accommodationMobility ? "Yes" : "No"],
                ["ASL interpreter", (r) => r.accommodationAsl ? "Yes" : "No"],
                ["Other accommodation details", (r) => r.accommodationDetails],
                ["Accessibility needs discussed", (r) => r.accessibilityContactedAt ? "Yes" : "No"],
                ["Accessibility discussed at", (r) => formatDate(r.accessibilityContactedAt)],
                ["Accessibility discussed by", (r) => r.accessibilityContactedBy],
                ["Accessibility notes", (r) => r.accessibilityNotes],
                ["Volunteer interest", (r) => r.volunteerInterest ? "Yes" : "No"],
                ["Scholarship donation", (r) => r.scholarshipDonation ? "Yes" : "No"],
                ["Preferred payment", (r) => paymentLabels[r.preferredPaymentMethod] || r.preferredPaymentMethod],
                ["Status", (r) => statusLabels[r.status] || r.status],
                ["Amount due", (r) => r.amountDueCents == null ? "" : (Number(r.amountDueCents) / 100).toFixed(2)],
                ["Currency", (r) => String(r.currency || "").toUpperCase()],
                ["Reported payment method", (r) => paymentLabels[r.paymentMethod] || r.paymentMethod],
                ["Payment sender", (r) => r.paymentSenderHandle],
                ["Payment reference", (r) => r.paymentReference],
                ["Payment reported at", (r) => formatDate(r.paymentReportedAt)],
                ["Confirm at", (r) => formatDate(r.confirmedAt)],
                ["Submitted", (r) => formatDate(r.createdAt)],
                ["Updated", (r) => formatDate(r.updatedAt)],
            ];

            const headings = columns.map(([heading]) => heading);
            const rows = data.registrations.map((registration) =>
                columns.map(([, getValue]) => getValue(registration)),
        );
        const csv = [headings, ...rows]
            .map((row) => row.map(escapeCsvValue).join(","))
            .join("\r\n");

        const blob = new Blob(["\uFEFF", csv], {
            type: "text/csv;charset=utf-8",
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        const date = new Date().toISOString().slice(0, 10);

        link.href = url;
        link.download = "hacypaa-registrations-" + date + ".csv";
        document.body.append(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);

        setFeedback(
            data.registrations.length + " registratin records exported.",
            "success",
        );
    } catch (error) {
        setFeedback(
            error?.message || "Could not export registrations.",
            "error",
        );
    } finally {
        exportRegistrationsButton.textContent = "Export CSV";
        exportRegistrationsButton.disabled =
            !permissions.registrations || dashboard.hidden;
        }
    }

    async function exportPanelistsPdf() {
        if (
            !permissions.volunteers ||
            exportPanelistsPdfButton.disabled
        ) {
            return;
        }

        exportPanelistsPdfButton.disabled = true;
        exportPanelistsPdfButton.textContent = "Exporting...";
        setPanelistFeedback("Preparing panelist PDF...", "pending");

        try {
            const adminToken = await adminAuth.getAccessToken();

            if (!adminToken) {
                showLogin("Your admin session has expired.");
                return;
            }

            const response = await fetch(apiBase + "/admin/panelists", {
                headers: {
                    Authorization: "Bearer " + adminToken,
                },
                cache: "no-store",
            });
            const data = await response.json().catch(() => null);

            if (response.status === 401 || response.status === 403) {
                await adminAuth.signOut();
                showLogin(data?.error || "Your admin session has expired.");
                return;
            }

            if (
                !response.ok ||
                data?.ok !== true ||
                !Array.isArray(data.panelists)
            ) {
                throw new Error(data?.error || "Could not export panelist PDF.");
            }

            if (!permissions.volunteers || dashboard.hidden) {
                return;
            }

            if (data.panelists.length === 0) {
                setPanelistFeedback("There are no panelist records to export.", "error");
                return;
            }

            const records = data.panelists.map((p) => ({
                heading: [p.firstName, p.lastName].filter(Boolean).join(" "),
                reference: "Panelist application " + p.id,
                rows: [
                    ["Contact", [
                        "Email: " + (p.email || "Not provided"),
                        "Phone: " + (p.phoneNumber || "Not provided"),
                    ].join("\n")],
                    ["Step preferences",
                        Array.isArray(p.stepPreferences)
                            ? p.stepPreferences.join(", ") || "None selected"
                            : "None selected",
                    ],
                    ["Recovery", [
                        "Sobriety date: " + (p.sobrietyDate || "Not provided"),
                        "Has sponsor: " + (p.hasSponsor ? "Yes" : "No"),
                        "Worked Steps: " + (p.workedSteps ? "Yes" : "No"),
                    ].join("\n")],
                    ["Location", p.location],
                    ["Home group",
                        p.hasHomeGroup
                            ? p.homeGroup || "Not provided"
                            : "No home group",
                    ],
                    ["Topic preferences", p.topicPreferences || "None provided"],
                    ["Status", panelistStatusLabels[p.status] || p.status || "Unknown"],
                    ["Admin notes", p.adminNotes || "No notes recorded"],
                    ["Submitted", formatDate(p.createdAt)],
                    ["Updated", formatDate(p.updatedAt)],
                ],
            }));

            const date = new Date().toISOString().slice(0, 10);

            downloadAdminPdf(
                "Panelist volunteers",
                "hacypaa-panelists-" + date + ".pdf",
                records,
            );

            setPanelistFeedback(
                records.length +" panelist applications exported to PDF.",
                "success",
            );
        } catch (error) {
            setPanelistFeedback(
                error?.message || "Could not export panelist PDF.",
                "error",
            );
        } finally {
            exportPanelistsPdfButton.textContent = "Export PDF";
            exportPanelistsPdfButton.disabled =
                !permissions.volunteers || dashboard.hidden;
        }
    }

    function exportPanelists() {
        if (currentPanelists.length === 0) {
            setPanelistFeedback(
                "There are no panelist records to export.",
                "error",
            );
            return;
        }

        const headings = [
            "First name",
            "Last name",
            "Email",
            "Phone",
            "Steps",
            "Sobriety date",
            "Has sponsor",
            "Worked Steps",
            "Location",
            "Has home group",
            "Home group",
            "Topic preferences",
            "Status",
            "Admin notes",
            "Submitted",
            "Updated",
        ];

        const rows = currentPanelists.map((panelist) => [
            panelist.firstName,
            panelist.lastName,
            panelist.email,
            panelist.phoneNumber,
            Array.isArray(panelist.stepPreferences)
                ? panelist.stepPreferences.join(", ")
                : "",
            panelist.sobrietyDate,
            panelist.hasSponsor ? "Yes" : "No",
            panelist.workedSteps ? "Yes" : "No",
            panelist.location,
            panelist.hasHomeGroup ? "Yes" : "No",
            panelist.homeGroup,
            panelist.topicPreferences,
            panelistStatusLabels[panelist.status] ||
                panelist.status,
            panelist.adminNotes,
            formatDate(panelist.createdAt),
            formatDate(panelist.updatedAt),
        ]);

        const csv = [headings, ...rows]
            .map((row) =>
                row.map(escapeCsvValue).join(","),
            )
            .join("\r\n");

        const blob = new Blob(
            ["\uFEFF", csv],
            {
                type: "text/csv;charset=utf-8",
            },
        );

        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        const date = new Date()
            .toISOString()
            .slice(0, 10);

        link.href = url;
        link.download =
            `hacypaa-panelists-${date}.csv`;

        document.body.append(link);
        link.click();
        link.remove();

        URL.revokeObjectURL(url);

        setPanelistFeedback(
            "Panelist CSV downloaded.",
            "success",
        );
    }

    async function loadAdminAccess() {
        const token = await adminAuth.getAccessToken();

        if (!token) {
            showLogin("Your admin session has expired.");
            return;
        }

        try {
            const response = await fetch(
                apiBase + "/admin/session",
                {
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                },
            );

            const data = await response.json();

            if (response.status === 401 || response.status === 403) {
                await adminAuth.signOut();
                showLogin(
                    data?.error || "This account is not authorized.",
                );
                return;
            }

            if (!response.ok || data.ok !== true) {
                throw new Error(
                    data.error || "Could not verify admin access.",
                );
            }

            permissions = {
                registrations:
                    data.permissions?.registrations === true,
                volunteers:
                    data.permissions?.volunteers === true,
            };

            registrationViewButton.hidden =
                !permissions.registrations;
            volunteerViewButton.hidden =
                !permissions.volunteers;
            exportRegistrationsButton.disabled =
                !permissions.registrations;
            exportRegistrationsPdfButton.disabled =
                !permissions.registrations;
            exportPanelistsPdfButton.disabled =
                !permissions.volunteers;

        if (!permissions.registrations && !permissions.volunteers) {
            throw new Error(
                "This account has no assigned dashboard access.",
            );
        }

        const initialView = permissions.registrations
            ? "registrations"
            : "volunteers";

        showAdminView(initialView);
        showDashboard();

        if (initialView === "registrations") {
            await loadRegistrations();
        } else {
            await loadPanelists();
        }

        } catch (error) {
            showLogin(
                error.message || "Could not verify admin access.",
            );
        }
    }

    async function loadRegistrations() {
        refreshButton.disabled = true;
        loginFeedback.textContent = "Checking access...";
        setFeedback("Loading registrations...", "pending");

        try {
            const adminToken =
                await adminAuth.getAccessToken();

            if (!adminToken) {
                showLogin(
                    "Your admin session has expired.",
                );
                return;
            }

            const response = await fetch(
                apiBase + "/admin/registrations",
                {
                    headers: {
                        Authorization:
                        `Bearer ${adminToken}`,
                    },
                },
            );

            const data = await response
                .json()
                .catch(() => null);

            if (
                response.status === 401 ||
                response.status === 403
            ) {
                const message =
                    response.status === 403
                        ? data?.error ||
                          "This account is not authorized."
                        : "Your admin session has expired.";

                await adminAuth.signOut();
                showLogin(message);
                return;
            }

            if (
                !response.ok ||
                data?.ok !== true ||
                !Array.isArray(data.registrations)
            ) {
                throw new Error(
                    data?.error ||
                        "Could not load registrations.",
                );
            }

            renderRegistrations(data.registrations);
            showDashboard();

            setFeedback(
                "Registration list is current.",
                "success",
            );
        } catch (error) {
            const message =
                error.message ||
                "Could not load registrations.";

            if (dashboard.hidden) {
                loginFeedback.textContent = message;
            } else {
                setFeedback(message, "error");
            }
        } finally {
            refreshButton.disabled = false;
        }
    }

    async function loadPanelists() {
        refreshButton.disabled = true;

        setPanelistFeedback(
            "Loading panelist applications...",
            "pending",
        );

        try {
            const adminToken =
                await adminAuth.getAccessToken();

            if (!adminToken) {
                showLogin(
                    "Your admin session has expired.",
                );
                return;
            }

            const response = await fetch(
                apiBase + "/admin/panelists",
                {
                    headers: {
                        Authorization:
                            `Bearer ${adminToken}`,
                    },
                },
            );

            const data = await response
                .json()
                .catch(() => null);

            if (
                response.status === 401 ||
                response.status === 403
            ) {
                const message =
                    response.status === 403
                        ? data?.error ||
                          "This account is not authorized."
                        : "Your admin session has expired.";

                await adminAuth.signOut();
                showLogin(message);
                return;
            }

            if (
                !response.ok ||
                data?.ok !== true ||
                !Array.isArray(data.panelists)
            ) {
                throw new Error(
                    data?.error ||
                        "Could not load panelist applications.",
                );
            }

            renderPanelists(data.panelists);
            showDashboard();

            setPanelistFeedback(
                "Panelist list is current.",
                "success",
            );
        } catch (error) {
            const message =
                error.message ||
                "Could not load panelist applications.";

            if (dashboard.hidden) {
                loginFeedback.textContent = message;
            } else {
                setPanelistFeedback(message, "error");
            }
        } finally {
            refreshButton.disabled = false;
        }
    }

    async function deletePanelist(row, button) {
        const panelistId = Number(row?.dataset.panelistId);

        if (
            !permissions.volunteers ||
            dashboard.hidden ||
            !Number.isSafeInteger(panelistId) ||
            panelistId <= 0 ||
            !panelistTableBody.contains(row) ||
            button.disabled
        ) {
            return;
        }

        const panelist = currentPanelists.find(
            (record) => Number(record.id) === panelistId,
        );
        const applicantName = [
            panelist?.firstName,
            panelist?.lastName,
        ].filter(Boolean).join(" ") || "Name not provided";

        const approved = window.confirm(
            "Permanently delete panelist application " + panelistId +
            " for " + applicantName + "?\n\n" +
            "This removes the application and its saved admin notes. " +
            "This cannot not be undone.",
        );

        if (!approved) {
            return;
        }

        const controls = Array.from(
            row.querySelectorAll("button, input, textarea, select"),
            (control) => ({ control, disabled: control.disabled }),
        );
        const originalText = button.textContent;

        controls.forEach(({ control }) => {
            control.disabled = true;
        });
        button.textContent = "Deleting...";
        setPanelistFeedback("Deleting panelist application...", "pending");

        try {
            const adminToken = await adminAuth.getAccessToken();

            if (!adminToken) {
                showLogin("Your admin session has expired.");
                return;
            }

            if (!permissions.volunteers || dashboard.hidden) {
                return;
            }

            const response = await fetch(apiBase + "/admin/panelists", {
                method: "DELETE",
                headers: {
                    Authorization: "Bearer " + adminToken,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ panelistId }),
            });
            const data = await response.json().catch(() => null);

            if (response.status === 401) {
                await adminAuth.signOut();
                showLogin(data?.error || "Your admin session has expired.");
                return;
            }

            if (!response.ok || data?.ok !== true) {
                throw new Error(
                    data?.error || "Could not delete panelist application.",
                );
            }

            if (!permissions.volunteers || dashboard.hidden) {
                return;
            }

            renderPanelists(
                currentPanelists.filter(
                    (record) => Number(record.id) !== panelistId,
                ),
            );
            setPanelistFeedback(
                "Panelist application " + panelistId + " deleted.",
                "success",
            );
        } catch (error) {
            setPanelistFeedback(
                error?.message || "Could not delete panelist application.",
                "error",
            );
        } finally {
            controls.forEach(({ control, disabled }) => {
                control.disabled = disabled;
            });
            button.textContent = originalText;
        }
    }

    async function deleteRegistration(row, button) {
        const registrationCode = row?.dataset.registrationCode || "";

        if (
            !permissions.registrations ||
            dashboard.hidden ||
            !registrationCode ||
            !tableBody.contains(row) ||
            button.disabled
        ) {
            return;
        }

        const approved = window.confirm(
            "Permanently delete registration " + registrationCode + "?\n\n" +
            "This removes its notes, event history, and receipts. " +
            "This cannot be undone and does not refund a payment.",
        );

        if (!approved) {
            return;
        }

        const controls = Array.from(
            row.querySelector("button, input, textarea, select"),
            (control) => ({ control, disabled: control.disabled }),
        );
        const originalText = button.textContent;

        controls.forEach(({ control }) => {
            control.disabled = true;
        });
        button.textContent = "Deleting...";
        setFeedback("Deleting " + registrationCode + "...", "pending");

        try {
            const adminToken = await adminAuth.getAccessToken();

            if (!adminToken) {
                showLogin("Your admin session has expired.");
                return;
            }

            if (!permissions.registrations || dashboard.hidden) {
                return;
            }

            const response = await fetch(apiBase + "/admin/registrations", {
                method: "DELETE",
                headers: {
                    Authorization: "Bearer " + adminToken,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ registrationCode }),
            });
            const data = await response.json().catch(() => null);

            if (response.status === 401) {
                await adminAuth.signOut();
                showLogin(data?.error || "Your admin session has expired.");
                return;
            }

            if (!response.ok || data?.ok !== true) {
                throw new Error(data?.error || "Could not delete registration.");
            }

            if (!permissions.registrations || dashboard.hidden) {
                return;
            }

            row.remove();
            summary.textContent = "";
            emptyMessage.hidden = tableBody.children.length !== 0;
            await loadRegistrations();

            if (!permissions.registrations || dashboard.hidden) {
                return;
            }

            if (feedback.dataset.state === "error") {
                setFeedback(
                    registrationCode + " was deleted. " + feedback.textContent,
                    "error",
                );
            } else {
                setFeedback(registrationCode + " deleted.", "success");
            }
        } catch (error) {
            setFeedback(
                error?.message || "Could not delete registration.",
                "error",
            );
        } finally {
            controls.forEach(({ control, disabled }) => {
                control.disabled = disabled;
            });
            button.textContent = originalText;
        }
    }

    async function updateRegistrationStatus(
        registrationCode,
        nextStatus,
        button,
    ) {
        const originalText = button.textContent;

        button.disabled = true;
        button.textContent = "Updating...";

        setFeedback(
            `Updating ${registrationCode}...`,
            "pending",
        );

        try {
            const adminToken =
                await adminAuth.getAccessToken();

            if (!adminToken) {
                showLogin(
                    "Your admin session has expired.",
                );
                return;
            }

            const response = await fetch(
                apiBase + "/admin/registrations/status",
                {
                    method: "PATCH",
                    headers: {
                        Authorization:
                            `Bearer ${adminToken}`,
                        "Content-Type":
                            "application/json",
                    },
                    body: JSON.stringify({
                        registrationCode,
                        status: nextStatus,
                    }),
                },
            );

            const data = await response
                .json()
                .catch(() => null);

            if (
                response.status === 401 ||
                response.status === 403
            ) {
                const message =
                    response.status === 403
                        ? data?.error ||
                          "This account is not authorized."
                        : "Your admin session has expired.";

                await adminAuth.signOut();
                showLogin(message);
                return;
            }

            if (
                !response.ok ||
                data?.ok !== true
            ) {
                throw new Error(
                    data?.error ||
                        "Could not update registration.",
                );
            }

            await loadRegistrations();

            setFeedback(
                `${registrationCode} marked ` +
                    `${statusLabels[nextStatus]}.`,
                "success",
            );
        } catch (error) {
            setFeedback(
                error.message ||
                    "Could not update registration.",
                "error",
            );
        } finally {
            button.disabled = false;
            button.textContent = originalText;
        }
    }

    async function saveAccessibilityChanges(row, button) {
        const registrationCode = row.dataset.registrationCode || "";
        const contactedInput = row.querySelector("[data-accessibility-contacted]");
        const notesInput = row.querySelector("[data-accessibility-notes]");
        const contactedSummary = row.querySelector("[data-accessibility-summary]");

        if (
            button.disabled ||
            !registrationCode ||
            !contactedInput ||
            !notesInput ||
            !contactedSummary
        ) {
            return;
        }

        button.disabled = true;
        contactedInput.disabled = true;
        notesInput.disabled = true;
        button.textContent = "Saving...";
        setFeedback(`Saving ${registrationCode} accessibility follow-up...`,
            "pending"
        );

        try {
            const adminToken = await adminAuth.getAccessToken();

            if (!adminToken) {
                showLogin("Your admin session has expired.");
                return;
            }

            const response = await fetch(
                apiBase + "/admin/registrations/accessibility",
                {
                    method: "PATCH",
                    headers: {
                        Authorization: `Bearer ${adminToken}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        registrationCode,
                        contacted: contactedInput.checked,
                        accessibilityNotes: notesInput.value,
                    }),
                },
            );

            const data = await response.json().catch(() => null);

            if (response.status === 401 || response.status === 403) {
                await adminAuth.signOut();
                showLogin(data?.error || "Your admin session has expired.");
                return;
            }

            const saved = data?.registration;

            if (
                !response.ok ||
                data?.ok !== true ||
                saved?.registrationCode !== registrationCode ||
                typeof saved?.accessibilityNotes !== "string"
            ) {
                throw new Error(
                    data?.error || "Could not save accessibility follow-up.",
                );
            }

            contactedInput.checked = Boolean(saved.accessibilityContactedAt);
            notesInput.value = saved.accessibilityNotes;
            contactedSummary.textContent = saved. accessibilityContactedAt
                ? `Discussed ${formatDate(saved.accessibilityContactedAt)}`
                : "No discussion recorded";

            setFeedback(
                `${registrationCode} accessibility follow-up saved.`,
                "success",
            );
        } catch (error) {
            setFeedback(
                error?.message || "Could not save accessibility follow-up.",
                "error",
            );
        } finally {
            button.disabled = false;
            contactedInput.disabled = false;
            notesInput.disabled = false;
            button.textContent = "Save";
        }
    }

    tableBody.addEventListener("click", function (event) {
        const target = event.target;

        if (!(target instanceof Element)) {
            return;
        }

        const button = target.closest("button[data-accessibility-save]");

        if (!button || !tableBody.contains(button)) {
            return;
        }

        const row = button.closest("tr");

        if (row) {
            void saveAccessibilityChanges(row, button);
        }
    });

    panelistTableBody.addEventListener("click", function (event) {
        const target = event.target;

        if (!(target instanceof Element)) {
            return;
        }

        const button = target.closest("button[data-panelist-save]");

        if (!button || !panelistTableBody.contains(button)) {
            return;
        }

        const row = button.closest("tr");

        if (!row) {
            return;
        }

        void savedPanelistChanges(row, button);
    });

    refreshButton.addEventListener("click", function () {
        if (activeView === "volunteers") {
            loadPanelists();
        } else {
            loadRegistrations();
        }
    });

    exportRegistrationsPdfButton.addEventListener(
        "click",
        exportRegistrationsPdf,
    );

    exportPanelistsPdfButton.addEventListener(
        "click",
        exportPanelistsPdf,
    );

    exportRegistrationsButton.addEventListener(
        "click",
        exportRegistrations,
    );

    exportPanelistsButton.addEventListener(
        "click",
        exportPanelists,
    );

    registrationViewButton.addEventListener(
        "click",
        function() {
            showAdminView("registrations");
            loadRegistrations();
        },
    );

    volunteerViewButton.addEventListener(
        "click",
        function () {
            showAdminView("volunteers");
            loadPanelists();
        },
    );

    tableBody.addEventListener(
        "click",
        function (event) {
            const target = event.target;

            if (!(target instanceof Element)) {
                return;
            }

            const button = target.closest(
                "button[data-next-status]",
            );

            if (
                !button ||
                !tableBody.contains(button)
            ) {
                return;
            }

            const row = button.closest("tr");

            const registrationCode =
                row?.dataset.registrationCode || "";

            const nextStatus =
                button.dataset.nextStatus || "";

            if (!registrationCode || !nextStatus) {
                return;
            }

            const statusLabel =
                statusLabels[nextStatus] || nextStatus;

            const approved = window.confirm(
                `Change ${registrationCode} to ` +
                    `"${statusLabel}"?`,
            );

            if (!approved) {
                return;
            }

            updateRegistrationStatus(
                registrationCode,
                nextStatus,
                button,
            );
        },
    );

    logoutButton.addEventListener(
        "click",
        async function () {
            panelistTableBody.replaceChildren();
            tableBody.replaceChildren();
            panelistSummary.textContent = "";
            summary.textContent = "";
            setPanelistFeedback("");
            setFeedback("");
            panelistTableBody.replaceChildren();
            permissions = {
                registrations: false,
                volunteers: false,
            };

            registrationViewButton.hidden = true;
            volunteerViewButton.hidden = true;
            await adminAuth.signOut();
            currentPanelists = [];
        },
    );

    console.log("Admin: registering dashboard listener");

    adminAuth.onAuthenticated(function () {
        void loadAdminAccess().catch(function (error) {
                console.error("Admin dashboard startup failed", error);

                showLogin(
                    error.message || "Could not open the dashboard.",
                );
            });
    });
})();
