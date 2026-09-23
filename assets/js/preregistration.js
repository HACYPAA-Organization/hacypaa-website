(function () {
    "use strict";

    const apiBase = [
        "localhost",
        "127.0.0.1",
    ].includes(window.location.hostname)
        ? "http://127.0.0.1:8787"
        : "https://checkout-api.tgp-services.workers.dev";

    const form = document.querySelector("#prereg-form");
    if (!form) return;

    const resendButton =
        document.querySelector("#prereg-resend");
    const costDisplay =
        document.querySelector("#prereg-cost");

    const button = document.querySelector("#prereg-submit");
    const feedback = document.querySelector("#prereg-feedback");
    const controls = form.querySelectorAll(
        "input, select, textarea",
    );

    const accommodationNone =
        form.elements.namedItem("accommodationNone");

    const accommodationChoices = [
        form.elements.namedItem("accommodationMobility"),
        form.elements.namedItem("accommodationAsl"),
    ];

    let submission = null;
    let busy = false;
    let completed = false;

    function formatAmount(amountDueCents) {
        return new Intl.NumberFormat("en-US", {
            style: "currency",
            currency: "USD",
        }).format(amountDueCents / 100);
    }

    async function loadRegistrationCost() {
        try {
            const response = await fetch(
                apiBase + "/registration/config",
            );

            const data = await response
                .json()
                .catch(() => null);

            if (
                !response.ok ||
                data?.ok !== true ||
                !Number.isInteger(data.amountDueCents)
            ) {
                return;
            }

            costDisplay.textContent =
                "Pre-registration cost: " +
                formatAmount(data.amountDueCents);
        } catch {
            // Keep the $25 fallback written in the HTML.
        }
    }

    loadRegistrationCost();

    accommodationNone?.addEventListener("change", function () {
        if (!accommodationNone.checked) return;

        accommodationChoices.forEach((choice) => {
            if (choice) choice.checked = false;
        });
    });

    accommodationChoices.forEach((choice) => {
        choice?.addEventListener("change", function () {
            if (choice.checked && accommodationNone) {
                accommodationNone.checked = false;
            }
        });
    });

    form.addEventListener("submit", async function (event) {
        event.preventDefault();

        if (
            busy ||
            completed ||
            !form.reportValidity()
        ) {
            return;
        }

        if (!submission) {
            const fields = new FormData(form);

            submission = {
                submissionKey: crypto.randomUUID(),
                firstName: String(
                    fields.get("firstName") || "",
                ).trim(),
                lastName: String(
                    fields.get("lastName") || "",
                ).trim(),
                email: String(
                    fields.get("email") || "",
                ).trim().toLowerCase(),
                phoneNumber: String(
                    fields.get("phoneNumber") || "",
                ).trim(),
                sobrietyDate: String(
                    fields.get("sobrietyDate") || "",
                ).trim(),
                location: String(
                    fields.get("location") || "",
                ).trim(),
                homeGroup: String(
                    fields.get("homeGroup") || "",
                ).trim(),
                fellowshipAa: fields.has("fellowshipAa"),
                fellowshipAlanon:
                    fields.has("fellowshipAlanon"),
                accommodationMobility:
                    fields.has("accommodationMobility"),
                accommodationAsl:
                    fields.has("accommodationAsl"),
                accommodationDetails: String(
                    fields.get("accommodationDetails") || "",
                ).trim(),
                volunteerInterest:
                    fields.get("volunteerInterest") === "yes",
                scholarshipDonation:
                    fields.get("scholarshipDonation") === "yes",
                preferredPaymentMethod: String(
                    fields.get("preferredPaymentMethod") || "",
                ).trim().toLowerCase(),
            };
        }

        busy = true;
        button.disabled = true;
        button.textContent = "Saving...";

        controls.forEach((control) => {
            control.disabled = true;
        });

        feedback.dataset.state = "pending";
        feedback.textContent =
            "Saving your registration...";

        const controller = new AbortController();
        const timer = setTimeout(
            () => controller.abort(),
            15000,
        );

        try {
            const response = await fetch(
                apiBase + "/registrations",
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify(submission),
                    signal: controller.signal,
                },
            );

            const data = await response
                .json()
                .catch(() => null);

            if (!response.ok || data?.ok !== true) {
                if (response.status === 400) {
                    submission = null;
                }

                throw new Error(
                    data?.error ||
                        "Could not save registration.",
                );
            }

            completed = true;
            form.hidden = true;

            const amountDueCents =
                Number(data.registration?.amountDueCents);
            const amount = Number.isInteger(amountDueCents)
                ? formatAmount(amountDueCents)
                : "$25.00";
            const registrationCode =
                data.registration?.registrationCode ||
                "Unavailable";

            feedback.dataset.state =
                data.emailSent ? "success" : "error";

            feedback.textContent = data.emailSent
                ? `Registration saved. Amount due: ${amount}. ` +
                `Registration code: ${registrationCode}. ` +
                `We sent your private payment link to ${submission.email}.`
                : `Registration saved. Amount due: ${amount}. ` +
                `Registration code: ${registrationCode}. ` +
                "The payment email could not be confirmed. " +
                "Use the resend button below.";

            resendButton.hidden = false;
            resendButton.disabled = false;
        } catch (error) {
            feedback.dataset.state = "error";
            feedback.textContent =
                error.name === "AbortError"
                    ? "The request timed out. Please retry."
                    : error.message ||
                      "Could not save registration.";
        } finally {
            clearTimeout(timer);
            busy = false;

            if (!completed) {
                controls.forEach((control) => {
                    control.disabled = false;
                });

                button.disabled = false;
                button.textContent = submission
                    ? "Retry registration"
                    : "Submit pre-registration";
            }
        }
    });

    resendButton.addEventListener(
    "click",
    async function () {
        if (
            busy ||
            !submission?.submissionKey ||
            !submission?.email
        ) {
            return;
        }

        busy = true;
        resendButton.disabled = true;
        resendButton.textContent = "Sending...";

        feedback.dataset.state = "pending";
        feedback.textContent =
            "Sending a new private payment link...";

        const controller = new AbortController();
        const timer = setTimeout(
            () => controller.abort(),
            15000,
        );

        try {
            const response = await fetch(
                apiBase +
                    "/registrations/resend-payment-link",
                {
                    method: "POST",
                    headers: {
                        "Content-Type":
                            "application/json",
                    },
                    body: JSON.stringify({
                        submissionKey:
                            submission.submissionKey,
                        email: submission.email,
                    }),
                    signal: controller.signal,
                },
            );

            const data = await response
                .json()
                .catch(() => null);

            if (
                !response.ok ||
                data?.ok !== true ||
                data?.emailSent !== true
            ) {
                throw new Error(
                    data?.error ||
                        "Could not resend the payment email.",
                );
            }

            feedback.dataset.state = "success";
            feedback.textContent =
                "A new private payment link was sent to " +
                submission.email +
                ". The previous link is no longer valid.";
        } catch (error) {
            feedback.dataset.state = "error";
            feedback.textContent =
                error.name === "AbortError"
                    ? "The resend request timed out. Please retry."
                    : error.message ||
                      "Could not resend the payment email.";
        } finally {
            clearTimeout(timer);
            busy = false;
            resendButton.disabled = false;
            resendButton.textContent =
                "Resend payment email";
        }
    },
);

    button.disabled = false;
})();
