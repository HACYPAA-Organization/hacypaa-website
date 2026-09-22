(function () {
    "use strict";

    const apiBase = [
        "localhost",
        "127.0.0.1",
    ].includes(window.location.hostname)
        ? "http://127.0.0.1:8787"
        : "https://checkout-api.tgp-services.workers.dev";

    const linkFeedback = document.querySelector(
        "#payment-link-feedback",
    );
    const panel = document.querySelector(
        "#payment-report-panel",
    );
    const attendeeName = document.querySelector(
        "#payment-attendee-name",
    );
    const code = document.querySelector("#payment-code");
    const amount = document.querySelector("#payment-amount");
    const form = document.querySelector("#payment-report-form");
    const button = document.querySelector(
        "#payment-report-submit",
    );
    const formFeedback = document.querySelector(
        "#payment-report-feedback",
    );
    const success = document.querySelector(
        "#payment-report-success",
    );

    if (
        !linkFeedback ||
        !panel ||
        !attendeeName ||
        !code ||
        !amount ||
        !form ||
        !button ||
        !form ||
        !formFeedback ||
        !success
    ) {
        return;
    }

    const token =
        new URLSearchParams(window.location.search)
            .get("token")
            ?.trim()
            .toLowerCase() || "";

    let busy = false;

    function setFeedback(element, message, state = "") {
        element.textContent = message;

        if (state) {
            element.dataset.state = state;
        } else {
            delete element.dataset.state;
        }
    }

    function showCompleted(message) {
        panel.hidden = true;
        success.hidden = false;
        setFeedback(linkFeedback, message, "success");
        success.focus();
    }

    async function loadRegistrations() {
        if (!/^[0-9a-f]{64}$/.test(token)) {
            setFeedback(
                linkFeedback,
                "This payment link is invalid.",
                "error",
            );
            return;
        }

        try {
            const response = await fetch(
                apiBase +
                    "/registrations/payment-link?token=" +
                    encodeURIComponent(token),
            );

            const data = await response.json().catch(() => null);

            if (!response.ok || data?.ok !== true) {
                throw new Error(
                    data?.error ||
                        "Could not verify this payment link.",
                );
            }

            const registration = data.registration;

            if (
                typeof registration?.registrationCode !==
                    "string" ||
                typeof registration.firstName !== "string" ||
                typeof registration.lastName !== "string" ||
                !Number.isSafeInteger(
                    registration.amountDueCents,
                ) ||
                typeof registration.currency !== "string"
            ) {
                throw new Error(
                    "The server returned incomplete registration details.",
                );
            }

            attendeeName.textContent =
                `${registration.firstName} ` +
                `${registration.lastName}`;

            code.textContent = registration.registrationCode;

            amount.textContent = new Intl.NumberFormat(
                "en-US",
                {
                    style: "currency",
                    currency:
                        registration.currency.toUpperCase(),
                },
            ).format(registration.amountDueCents / 100);

            if (registration.status === "confirmed") {
                showCompleted(
                    "This registration is already confirmed.",
                );
                return;
            }

            if (registration.status === "payment_reported") {
                showCompleted(
                    "Payment has already been reported.",
                );
                return;
            }

            if (registration.status === "payment_reported") {
                showCompleted(
                    "Payment has already been reported.",
                );
                return;
            }

            if (
                ![
                    "awaiting_payment",
                    "payment_not_found",
                ].includes(registration.status)
            ) {
                throw new Error(
                    "This registration cannot accept a payment report.",
                );
            }

            setFeedback(
                linkFeedback,
                "Payment link verified.",
                "success",
            );

            panel.hidden = false;
        } catch (error) {
            setFeedback(
                linkFeedback,
                error.message ||
                    "Could not verify this payment link.",
                "error",
            );
        }
    }

    form.addEventListener("submit", async function (event) {
        event.preventDefault();

        if(busy || !form.reportValidity()) {
            return;
        }

        const fields = new FormData(form);

        const paymentAccessToken = new URLSearchParams(
            window.location.search,
        ).get("token");

        const paymentReport = {
            paymentAccessToken,
            paymentMethod: String(
                fields.get("paymentMethod") || "",
            ).trim(),
            paymentSenderHandle: String(
                fields.get("paymentSenderHandle") || "",
            ).trim(),
            paymentReference: String(
                fields.get("paymentReference") || "",
            ).trim(),
        };

        busy = true;
        button.disabled = true;
        button.textContent = "Reporting...";

        setFeedback(
            formFeedback,
            "Recording your payment report...",
            "pending",
        );

        const controller = new AbortController();
        const timer = setTimeout(
            () => controller.abort(),
            15000,
        );

        try {
            const response = await fetch(
                apiBase + "/registrations/payment-report",
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON. stringify(paymentReport),
                    signal: controller.signal,
                },
            );

            const data = await response.json().catch(() => null);

            if (!response.ok || data?.ok !== true) {
                throw new Error(
                    data?.error ||
                        "Could not record the payment report.",
                );
            }

            showCompleted(
                "Payment report successfully submitted.",
            );
        } catch (error) {
            console.error("Payment report failed:", error);
            setFeedback(
                formFeedback,
                error.name == "AboutError"
                    ? "The request timed out. Try again."
                    : error.message ||
                        "Could not record the payment report.",
                    "error",
            );
        } finally {
            clearTimeout(timer);
            busy = false;
            button.disabled = false;
            button.textContent = "Report payment";
        }
    });

    loadRegistrations();
})();
