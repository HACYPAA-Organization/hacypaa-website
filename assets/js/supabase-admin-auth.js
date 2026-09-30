(function () {
    "use strict";

    const sdk = window.supabase;
    const config = window.HACYPAA_SUPABASE_CONFIG;

    const loginForm = document.querySelector("#admin-login-form");
    const emailInput = document.querySelector("#admin-email");
    const passwordInput = document.querySelector("#admin-password");
    const loginButton = document.querySelector("#admin-login-submit");
    const resetButton = document.querySelector("#admin-reset-request");
    const passwordForm = document.querySelector("#admin-password-form");
    const newPasswordInput = document.querySelector("#admin-new-password");
    const confirmPasswordInput = document.querySelector(
        "#admin-confirm-password",
    );
    const passwordButton = document.querySelector("#admin-password-submit");
    const enrollmentSection = document.querySelector("#admin-mfa-enrollment");
    const enrollmentForm = document.querySelector(
        "#admin-mfa-enrollment-form",
    );
    const enrollmentCodeInput = document.querySelector(
        "#admin-mfa-enrollment-code",
    );
    const enrollmentButton = document.querySelector(
        "#admin-mfa-enrollment-submit",
    );
    const qrImage = document.querySelector("#admin-mfa-qr");
    const manualSecret = document.querySelector("#admin-mfa-secret");
    const challengeForm = document.querySelector(
        "#admin-mfa-challenge-form",
    );
    const challengeCodeInput = document.querySelector(
        "#admin-mfa-challenge-code",
    );
    const challengeButton = document.querySelector(
        "#admin-mfa-challenge-submit",
    );
    const loginFeedback = document.querySelector("#admin-login-feedback");
    const dashboard = document.querySelector("#admin-dashboard");

    const requiredElements = [
        loginForm,
        emailInput,
        passwordInput,
        loginButton,
        resetButton,
        passwordForm,
        newPasswordInput,
        confirmPasswordInput,
        passwordButton,
        enrollmentSection,
        enrollmentForm,
        enrollmentCodeInput,
        enrollmentButton,
        qrImage,
        manualSecret,
        challengeForm,
        challengeCodeInput,
        challengeButton,
        loginFeedback,
        dashboard,
    ];

    if (
        !sdk?.createClient ||
        !config?.url ||
        !config?.publishableKey ||
        requiredElements.some((element) => !element)
    ) {
        console.error("Supabase admin authentication could not initialize.");
        return;
    }

    const client = sdk.createClient(
        config.url,
        config.publishableKey,
        {
            auth: {
                persistSession: true,
                autoRefreshToken: true,
                detectSessionInUrl: true,
            },
        },
    );

    const authenticatedListeners = new Set();
    let authenticated = false;
    let enrollmentFactorId = "";
    let passwordFlow = false;
    let routing = false;

    function setFeedback(message = "", state = "") {
        loginFeedback.textContent = message;

        if (state) {
            loginFeedback.dataset.state = state;
        } else {
            delete loginFeedback.dataset.state;
        }
    }

    function hideViews() {
        loginForm.hidden = true;
        passwordForm.hidden = true;
        enrollmentSection.hidden = true;
        challengeForm.hidden = true;
        dashboard.hidden = true;
    }

    function showLogin(message = "") {
        authenticated = false;
        hideViews();
        loginForm.hidden = false;
        passwordInput.value = "";
        setFeedback(message);
    }

    function showPasswordForm(message = "") {
        authenticated = false;
        hideViews();
        passwordForm.hidden = false;
        newPasswordInput.value = "";
        confirmPasswordInput.value = "";
        setFeedback(message);
    }

    function showEnrollment(message = "") {
        authenticated = false;
        hideViews();
        enrollmentSection.hidden = false;
        enrollmentCodeInput.value = "";
        setFeedback(message);
    }

    function showChallenge(message = "") {
        authenticated = false;
        hideViews();
        challengeForm.hidden = false;
        challengeCodeInput.value = "";
        setFeedback(message);
    }

    function notifyAuthenticated() {
        authenticated = true;
        hideViews();
        dashboard.hidden = false;
        setFeedback("");

        for (const listener of authenticatedListeners) {
            listener();
        }

        window.dispatchEvent(
            new CustomEvent("hacypaa:admin-authenticated"),
        );
    }

    function getAuthLinkType() {
        const search = new URLSearchParams(
            window.location.search
        );
        const hash = new URLSearchParams(
            window.location.hash.replace(/^#/, ""),
        );

        if (search.get("flow") === "password-reset") {
            return "recovery";
        }

        return search.get("type") || hash.get("type") || "";
    }

    function clearAuthParameters() {
        if (!window.history?.replaceState) {
            return;
        }

        window.history.replaceState(
            {},
            document.title,
            window.location.pathname,
        );
    }

    async function getAccessToken() {
        const { data, error } = await client.auth.getSession();

        if (error) {
            throw error;
        }

        return data.session?.access_token || "";
    }

    async function verifyFactor(factorId, code) {
        const challenge = await client.auth.mfa.challenge({
            factorId,
        });

        if (challenge.error) {
            throw challenge.error;
        }

        const verification = await client.auth.mfa.verify({
            factorId,
            challengeId: challenge.data.id,
            code,
        });

        if (verification.error) {
            throw verification.error;
        }
    }

    async function listTotpFactors() {
        const factors = await client.auth.mfa.listFactors();

        if (factors.error) {
            throw factors.error;
        }

        return factors.data.totp || [];
    }

    async function beginEnrollment() {
        const factors = await listTotpFactors();
        const verifiedFactor = factors.find(
            (factor) => factor.status === "verified",
        );

        if (verifiedFactor) {
            showChallenge();
            return;
        }

        for (const factor of factors) {
            if (factor.status !== "verified") {
                await client.auth.mfa.unenroll({
                    factorId: factor.id,
                });
            }
        }

        const enrollment = await client.auth.mfa.enroll({
            factorType: "totp",
            friendlyName: "HACYPAA Admin",
        });

        if (enrollment.error) {
            throw enrollment.error;
        }

        enrollmentFactorId = enrollment.data.id;
        qrImage.src = enrollment.data.totp.qr_code;
        manualSecret.textContent = enrollment.data.totp.secret;
        showEnrollment();
    }

    async function routeSession(options = {}) {
        if (routing) {
            return;
        }

        routing = true;

        try {
            const { data, error } = await client.auth.getSession();

            if (error) {
                throw error;
            }

            if (!data.session) {
                showLogin();
                return;
            }

            const linkType = getAuthLinkType();

            if (
                options.forcePassword ||
                passwordFlow ||
                linkType === "invite" ||
                linkType === "recovery"
            ) {
                passwordFlow = true;
                showPasswordForm();
                return;
            }

            const assurance =
                await client.auth.mfa.getAuthenticatorAssuranceLevel();

            if (assurance.error) {
                throw assurance.error;
            }

            if (assurance.data.currentLevel === "aal2") {
                notifyAuthenticated();
                return;
            }

            if (assurance.data.nextLevel === "aal2") {
                showChallenge();
                return;
            }

            await beginEnrollment();
        } catch (error) {
            showLogin(
                error.message || "Could not verify the admin session.",
            );
        } finally {
            routing = false;
        }
    }

    loginForm.addEventListener("submit", async function (event) {
        event.preventDefault();

        if (!loginForm.reportValidity()) {
            return;
        }

        loginButton.disabled = true;
        loginButton.textContent = "Signing in...";
        setFeedback("Checking your credentials...", "pending");

        try {
            const result = await client.auth.signInWithPassword({
                email: emailInput.value.trim(),
                password: passwordInput.value,
            });

            if (result.error) {
                throw result.error;
            }

            passwordFlow = false;
            await routeSession();
        } catch (error) {
            showLogin(error.message || "Could not sign in.");
        } finally {
            loginButton.disabled = false;
            loginButton.textContent = "Sign in";
        }
    });

    resetButton.addEventListener("click", async function () {
        if (!emailInput.reportValidity()) {
            return;
        }

        resetButton.disabled = true;
        setFeedback("Sending a password-reset email...", "pending");

        try {
            const redirectUrl = new URL(
                "/admin/",
                window.location.origin,
            );

            redirectUrl.searchParams.set(
                "flow",
                "password-reset",
            );

            const redirectTo = redirectUrl.href;

            const result = await client.auth.resetPasswordForEmail(
                emailInput.value.trim(),
                { redirectTo },
            );

            if (result.error) {
                throw result.error;
            }

            setFeedback(
                "Check your email for the password-reset link.",
                "success",
            );
        } catch (error) {
            setFeedback(
                error.message || "Could not send the reset email.",
                "error",
            );
        } finally {
            resetButton.disabled = false;
        }
    });

    passwordForm.addEventListener("submit", async function (event) {
        event.preventDefault();

        if (!passwordForm.reportValidity()) {
            return;
        }

        if (newPasswordInput.value !== confirmPasswordInput.value) {
            setFeedback("The passwords do not match.", "error");
            return;
        }

        passwordButton.disabled = true;
        passwordButton.textContent = "Saving...";

        try {
            const result = await client.auth.updateUser({
                password: newPasswordInput.value,
            });

            if (result.error) {
                throw result.error;
            }

            passwordFlow = false;
            clearAuthParameters();
            await routeSession();
        } catch (error) {
            setFeedback(
                error.message || "Could not save the password.",
                "error",
            );
        } finally {
            passwordButton.disabled = false;
            passwordButton.textContent = "Save password";
        }
    });

    enrollmentForm.addEventListener("submit", async function (event) {
        event.preventDefault();

        if (!enrollmentForm.reportValidity() || !enrollmentFactorId) {
            return;
        }

        enrollmentButton.disabled = true;
        enrollmentButton.textContent = "Verifying...";

        try {
            await verifyFactor(
                enrollmentFactorId,
                enrollmentCodeInput.value.trim(),
            );
            enrollmentFactorId = "";
            notifyAuthenticated();
        } catch (error) {
            setFeedback(
                error.message || "That authenticator code was not accepted.",
                "error",
            );
        } finally {
            enrollmentButton.disabled = false;
            enrollmentButton.textContent = "Enable authenticator";
        }
    });

    challengeForm.addEventListener("submit", async function (event) {
        event.preventDefault();

        if (!challengeForm.reportValidity()) {
            return;
        }

        challengeButton.disabled = true;
        challengeButton.textContent = "Verifying...";

        try {
            const factors = await listTotpFactors();
            const factor = factors.find(
                (candidate) => candidate.status === "verified",
            );

            if (!factor) {
                await beginEnrollment();
                return;
            }

            await verifyFactor(
                factor.id,
                challengeCodeInput.value.trim(),
            );
            notifyAuthenticated();
        } catch (error) {
            setFeedback(
                error.message || "That authenticator code was not accepted.",
                "error",
            );
        } finally {
            challengeButton.disabled = false;
            challengeButton.textContent = "Verify";
        }
    });

    client.auth.onAuthStateChange((event) => {
        if (event === "SIGNED_OUT") {
            showLogin("Dashboard locked.");
            return;
        }

        if (event === "PASSWORD_RECOVERY") {
            passwordFlow = true;
            showPasswordForm();
        }
    });

    window.HACYPAA_ADMIN_AUTH = Object.freeze({
        getAccessToken,
        onAuthenticated(listener) {
            authenticatedListeners.add(listener);

            if (authenticated) {
                queueMicrotask(listener);
            }

            return function unsubscribe() {
                authenticatedListeners.delete(listener);
            };
        },
        async signOut() {
            authenticated = false;
            enrollmentFactorId = "";
            passwordFlow = false;
            await client.auth.signOut();
            showLogin("Dashboard locked.");
        },
        showLogin,
    });

    routeSession();
})();
