(function () {
    "use strict";

    const apiBase = [
        "localhost",
        "127.0.0.1",
    ].includes(window.location.hostname)
        ? "http://127.0.0.1:8787"
        : "https://checkout-api.tgp-services.workers.dev";

    const form = document.querySelector(
        "#panelist-form",
    );
    const submitButton = document.querySelector(
        "#panelist-submit",
    );
    const feedback = document.querySelector(
        "#panelist-feedback",
    );
    const homeGroupField = document.querySelector(
        "#panelist-home-group-field",
    );
    const homeGroupInput = document.querySelector(
        "#panelist-home-group",
    );
    const sobrietyDateInput = document.querySelector(
        "#panelist-sobriety-date",
    );

    if (
        !form ||
        !submitButton ||
        !feedback ||
        !homeGroupField ||
        !homeGroupInput ||
        !sobrietyDateInput
    ) {
        return;
    }

    let submissionKey = crypto.randomUUID();

    sobrietyDateInput.max =
        new Date().toISOString().slice(0, 10);

    function setFeedback(message, state = "") {
        feedback.textContent = message;

        if (state) {
            feedback.dataset.state = state;
        } else {
            delete feedback.dataset.state;
        }
    }

    function updateHomeGroupField() {
        const selected = form.querySelector(
            'input[name="hasHomeGroup"]:checked',
        );

        const hasHomeGroup =
            selected?.value === "yes";

        homeGroupField.hidden = !hasHomeGroup;
        homeGroupInput.required = hasHomeGroup;

        if (!hasHomeGroup) {
            homeGroupInput.value = "";
        }
    }

    form.addEventListener("change", function (event) {
        if (event.target.name === "hasHomeGroup") {
            updateHomeGroupField();
        }
    });

    form.addEventListener(
        "submit",
        async function (event) {
            event.preventDefault();

            if (!form.reportValidity()) {
                return;
            }

            const fields = new FormData(form);

            const stepPreferences = fields
                .getAll("stepPreferences")
                .map((value) => String(value));

            if (stepPreferences.length === 0) {
                setFeedback(
                    "Select at least one Step.",
                    "error",
                );

                form.querySelector(
                    'input[name="stepPreferences"]',
                )?.focus();

                return;
            }

            submitButton.disabled = true;
            submitButton.textContent = "Submitting...";

            setFeedback(
                "Submitting your panelist interest...",
                "pending",
            );

            try {
                const response = await fetch(
                    apiBase + "/panelists",
                    {
                        method: "POST",
                        headers: {
                            "Content-Type":
                                "application/json",
                        },
                        body: JSON.stringify({
                            submissionKey,
                            firstName:
                                fields.get("firstName"),
                            lastName:
                                fields.get("lastName"),
                            email: fields.get("email"),
                            phoneNumber:
                                fields.get("phoneNumber"),
                            stepPreferences,
                            sobrietyDate:
                                fields.get("sobrietyDate"),
                            hasSponsor:
                                fields.get("hasSponsor") ===
                                "yes",
                            workedSteps:
                                fields.get("workedSteps") ===
                                "yes",
                            location:
                                fields.get("location"),
                            hasHomeGroup:
                                fields.get("hasHomeGroup") ===
                                "yes",
                            homeGroup:
                                fields.get("homeGroup") || "",
                            topicPreferences:
                                fields.get(
                                    "topicPreferences",
                                ) || "",
                        }),
                    },
                );

                const data = await response
                    .json()
                    .catch(() => null);

                if (
                    !response.ok ||
                    data?.ok !== true
                ) {
                    throw new Error(
                        data?.error ||
                            "Could not submit your panelist interest.",
                    );
                }

                form.reset();
                updateHomeGroupField();

                submissionKey = crypto.randomUUID();

                setFeedback(
                    "Thank you. Your panelist interest has been submitted.",
                    "success",
                );
            } catch (error) {
                setFeedback(
                    error.message ||
                        "Could not submit your panelist interest.",
                    "error",
                );
            } finally {
                submitButton.disabled = false,
                submitButton.textContent =
                    "Submit panelist interest";
            }
        },
    );
})();