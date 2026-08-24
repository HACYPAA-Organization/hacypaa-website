(function() {
    "use strict";

    const storageKey = "hacypaa-merch-cart-v2";
    const checkoutApi = "http://127.0.0.1:8787";
    const stripePublishableKey = "pk_test_51U82LpM0AC70O1UBmLUALv7KZvdV8GvbUvTNJn9tJ9RMQmuOUX0VyOj69a5yGuojELAfpTlHVssYZJO9MGJQcsyw00jOVw0ENc";

    const checkoutButton = document.querySelector("[data-checkout-open]");
    const checkoutDialog = document.querySelector("#checkout-dialog");
    const checkoutContainer = document. querySelector("#checkout");
    const checkoutStatus = document.querySelector("#checkout-status");

    let checkoutInstance = null;

    function readCart() {
        try {
            const cart = JSON.parse(localStorage.getItem(storageKey) || "[]");
            return Array.isArray(cart) ? cart : [];
        } catch {
            return [];
        }
    }

    async function fetchClientSecret() {
        const cart = readCart();

        const items = cart.map(function (item) {
            return {
                productId: item.productId,
                variantId: item.variantId,
                quantity: item.quantity,
            };
        });

        const response = await fetch(checkoutApi + "/checkout/session", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ items: items }),
        });

        const { clientSecret } = await response.json();
        return clientSecret;
    }

    async function openCheckout() {
        if (!readCart().length || checkoutInstance) return;

        checkoutButton.disabled = true;
        checkoutStatus.hidden = false;
        checkoutStatus.textContent = "Loading secure checkout...";

        if (!checkoutDialog.open) {
            checkoutDialog.showModal();
        }

        try {
            const stripe = Stripe(stripePublishableKey);

            checkoutInstance = await stripe.createEmbeddedCheckoutPage({
                fetchClientSecret: fetchClientSecret,
            });

            checkoutInstance.mount("#checkout");
            checkoutStatus.hidden = true;
        } catch (error) {
            checkoutStatus.hidden = false;
            checkoutStatus.textContent =
                error instanceof Error ? error.message : "Checkout failed to load";

            checkoutButton.disabled = false;
        }
    }

    function closeCheckout() {
        if (checkoutInstance) {
            checkoutInstance.destroy();
            checkoutInstance = null;
        }

        checkoutContainer.replaceChildren();
        checkoutDialog.closest();
        checkoutButton.disabled = readCart().length === 0;
    }

    checkoutButton?.addEventListener("click", openCheckout);

    document
        .querySelectorAll("[data-checkout-close]")
        .forEach(function (button) {
            button.addEventListener("click", closeCheckout);
        });
})();