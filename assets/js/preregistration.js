(function () {
    "use strict";

    const apiBase = "http://127.0.0.1:8787";
    const form = document.querySelector("#prereg-form");
    if (!form) return;

    const button = document.querySelector("#prereg-submit");
    const feedback = document.querySelector("#prereg-feedback");
    const confirmation = document.querySelector("#prereg-confirmation");
    const code = document.querySelector("#prereg-code");
    const amount = document.querySelector("#prereg-amount");
    const paymentStatus = document.querySelector("#prereg-payment-status");
    const inputs = form.querySelectorAll("input");

    const statuses = {
        awaiting_payment: "Payment has not been confirmed.",
        payment_reported: "Payment reported. Awaiting verification.",
        confirmed: "Payment confirmed. You are registered.",
        payment_not_found: "Payment could not be verified. Contact registration.",
        cancelled: "This registration is cancelled.",
    };

    let submission = null;
    let busy = false;
    let completed = false;

    form.addEventListener("submit", async function (event) {
        event.preventDefault();
        if (busy || completed || !form.reportValidity()) return;

        if (!submission) {
            const fields = new FormData(form);

            submission = {
                submissionKey: crypto.randomUUID(),
                firstName: fields.get("firstName").trim(),
                lastName: fields.get("lastName").trim(),
                email: fields.get("email").trim().toLowerCase(),
            };
        }

        busy = true;
        button.disabled = true;
        button.textContent = "Saving...";

        inputs.forEach((input) => {
            input.disabled = true;
        });

        feedback.dataset.state = "pending";
        feedback.textContent = "Saving your registration...";

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);

        try {
            const response = await fetch(apiBase + "/registrations", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(submission),
                signal: controller.signal,
            });

            const data = await response.json().catch(() => null);

            if (!response.ok || data?.ok !== true) {
                if (response.status === 400) {
                    submission = null;

                    inputs.forEach((input) => {
                        input.disabled = false;
                    });
                }

                throw new Error(
                    data?.error || "Could not confirm registration.",
                );
            }

            const registration = data.registration;

            if (
                typeof registration?.registrationCode !== "string" ||
                !registration.registrationCode ||
                !Number.isSafeInteger(registration.amountDueCents) ||
                registration.amountDueCents < 0 ||
                registration.currency !== "usd" ||
                !Object.hasOwn(statuses, registration.status)
            ) {
                throw new Error(
                    "The server returned an incomplete confirmation.",
                );
            }

            const fee = new Intl.NumberFormat("en-US", {
                style: "currency",
                currency: registration.currency,
            }).format(registration.amountDueCents / 100);

            code.textContent = registration.registrationCode;
            amount.textContent = "Registration fee: " + fee;
            paymentStatus.textContent = statuses[registration.status];

            feedback.textContent = "";
            form.style.display = "none";
            confirmation.hidden = false;
            completed = true;
            confirmation.focus();
        } catch (error) {
            feedback.dataset.state = "error";

            feedback.textContent =
                (error.name === "AbortError"
                    ? "The request timed out."
                    : error.message || "Could not confirm registration.") +
                (submission
                    ? " Keep this page open and retry."
                    : " Check your details.");
        } finally {
            clearTimeout(timer);
            busy = false;
            button.disabled = completed;

            button.textContent = completed
                ? "Saved"
                : submission
                    ? "Retry registration"
                    : "Save registration";
        }
    });

    button.disabled = false;
})();