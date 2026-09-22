(function () {
    "use strict";

    const apiBase = "http://127.0.0.1:8787";
    const form = document.querySelector("#prereg-form");
    if (!form) return;

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

            if (
                typeof data.paymentUrl !== "string" ||
                !data.paymentUrl
            ) {
                throw new Error(
                    "The server did not return a payment link.",
                );
            }

            completed = true;
            feedback.dataset.state = "success";
            feedback.textContent =
                "Registration saved. Opening payment instructions...";

            window.location.assign(data.paymentUrl);
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
                    : "Continue to payment";
            }
        }
    });

    button.disabled = false;
})();