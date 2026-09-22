(function () {
    "use strict";

    const apiBase = [
        "localhost",
        "127.0.0.1",
    ].includes(window.location.hostname)
        ? "http://127.0.0.1:8787"
        : "https://checkout-api.tgp-services.workers.dev";

    const loginForm =
        document.querySelector("#admin-login-form");
    const tokenInput =
        document.querySelector("#admin-token");
    const loginButton =
        document.querySelector("#admin-login-submit");
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

    if (
        !loginForm ||
        !tokenInput ||
        !loginButton ||
        !loginFeedback ||
        !dashboard ||
        !refreshButton ||
        !logoutButton ||
        !summary ||
        !feedback ||
        !tableBody ||
        !emptyMessage
    ) {
        return;
    }

    let adminToken =
        sessionStorage.getItem("hacypaaPreregAdminToken") || "";

    function showLogin(message = "") {
        loginForm.hidden = false;
        dashboard.hidden = true;
        tokenInput.value = "";
        loginFeedback.textContent = message;
    }

    function showDashboard () {
        loginForm.hidden = true;
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

    const statusLabels = {
        awaiting_payment: "Awaiting payment",
        payment_reported: "Payment reported",
        confirmed: "Confirmed",
        payment_not_found: "Payment not found",
        cancelled: "Cancelled",
    };

    const paymentLabels = {
        venmo: "Venmo",
        cash_app: "Cash App",
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
                registration.felloshipAa
                    ? "Alcoholics Anonymous"
                    : null,
                registration.felloshipAlanon
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
                    `Accommodations: ${accommodations}`,
                    `Volunteer: ${
                        registration.volunteerInterest ? "Yes" : "No"
                    }`,
                    `Scholarship donation: ${
                        registration.scholashipDonation ? "Yes" : "No"
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
            addCell(row, formatDate(registration.createdAt));


            const actionsCell = addCell(row, "");

            actionsCell.classList.add("admin-row-actions");

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

            tableBody.append(row);
        }
    }

    async function loadRegistrations() {
        if (!adminToken) {
            showLogin();
            return;
        }

        refreshButton.disabled = true;
        loginFeedback.textContent = "Checking access...";
        setFeedback("Loading registrations...", "pending");

        try {
            const response = await fetch(
                apiBase + "/admin/registrations",
                {
                    headers: {
                        Authorization: `Bearer ${adminToken}`,
                    },
                },
            );

            const data = await response.json().catch(() => null);

            if (response.status === 401) {
                adminToken = "";
                sessionStorage.removeItem(
                    "hacypaaPreregAdminToken",
                );
                showLogin("That access token was not accepted.");
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
            const response = await fetch(
                apiBase + "/admin/registrations/status",
                {
                    method: "PATCH",
                    headers: {
                        Authorization:
                            `Bearer ${adminToken}`,
                        "Content-Type":
                            "applications/json",
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

            if (response.status === 401) {
                adminToken = "";

                sessionStorage.removeItem(
                    "hacypaaPreregAdminToken",
                );

                showLogin(
                    "Your admin session has expired.",
                );

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

    loginForm.addEventListener(
        "submit",
        async function (event) {
            event.preventDefault();

            if (!loginForm.reportValidity()) {
                return;
            }

            adminToken = tokenInput.value.trim();

            if (!adminToken) {
                return;
            }

            loginButton.disabled = true;
            loginButton.textContent = "Opening...";

            sessionStorage.setItem(
                "hacypaaPreregAdminToken",
                adminToken,
            );

            await loadRegistrations();

            loginButton.disabled = false;
            loginButton.textContent = "Open dashboard";
        },
    );

    refreshButton.addEventListener("click", function () {
        loadRegistrations();
    });

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

    logoutButton.addEventListener("click", function () {
        adminToken = "";

        sessionStorage.removeItem(
            "hacypaaPreregAdminToken",
        );

        tableBody.replaceChildren();
        summary.textContent = "";
        setFeedback("");
        showLogin("Dashboard locked.");
    });

    if (adminToken) {
        loadRegistrations();
    } else {
        showLogin();
    }
})();
