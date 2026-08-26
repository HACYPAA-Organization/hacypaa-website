(function () {
    "use strict";

    const storageKey = "hacypaa-merch-cart-v2";
    const checkoutApi = "http://127.0.0.1:8787";
    const stripePublishableKey =
    "pk_test_51U82LpM0AC70O1UBmLUALv7KZvdV8GvbUvTNJn9tJ9RMQmuOUX0VyOj69a5yGuojELAfpTlHVssYZJO9MGJQcsyw00jOVw0ENc";

    const checkoutButton = document.querySelector("[data-checkout-open]");
    const checkoutDialog = document.querySelector("#checkout-dialog");
    const checkoutContainer = document.querySelector("#checkout");
    const checkoutStatus = document.querySelector("#checkout-status");
    const checkoutHeading = document.querySelector(
        "#checkout-dialog .cart-heading h2",
    );

    let checkoutInstance = null;

    function formatMoney(cents, currency = "usd") {
        return new Intl.NumberFormat("en-US", {
            style: "currency",
            currency: currency.toUpperCase(),
        }).format(cents/ 100);
    }

    function readCart() {
        try {
            const cart = JSON.parse(localStorage.getItem(storageKey) || "[]");
            return Array.isArray(cart) ? cart : [];
        } catch {
            return[];
        }
    }

    function clearPaidCart() {
        localStorage.removeItem(storageKey);
        window.dispatchEvent(new Event("hacypaa:cart-cleared"));
    }

    async function fetchClientSecret() {
        const cart = readCart();

        const items = cart.map(function (item) {
            return {
                productId: item.productId,
                variantId: item.variantId,
                quantity: item. quantity,
            };
        });

        const response = await fetch(checkoutApi + "/checkout/session", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ items: items }),
        });

        const payload = await response.json().catch(function () {
            return {};
        });

        if (!response.ok || !payload.clientSecret) {
            throw new Error(
                payload.error || "Could not start secure checkout",
            );
        }

        return payload.clientSecret;
    }

    function renderConfirmation(data) {
        checkoutContainer.replaceChildren();
        checkoutStatus.hidden = true;

        if (checkoutHeading) {
            checkoutHeading.textContent = "Order confirmed";
        }

        const confirmation = document.createElement("section");
        confirmation.className = "checkout-confirmation";
        confirmation.setAttribute("aria-live", "polite");

        const overline = document.createElement("p");
        overline.className = "merch-overline";
        overline.textContent = "Payment confirmed";

        const title = document.createElement("h3");
        title.textContent = "Thank you for supporting HACYPAA.";

        const message = document.createElement("p");
        message.className = "checkout-confirmation-message";
        message.textContent = data.customerEmail
            ? "Payment was received for " + data.customerEmail + "."
            : "Your payment was received successfully.";

        const itemList = document.createElement("ul");
        itemList.className = "checkout-confirmation-items";

        data.items.forEach(function (item) {
            const listItem = document.createElement("li");

            const description = document.createElement("span");
            description.textContent = item.description;

            const details = document.createElement("strong");
            details.textContent =
                "Qty. " +
                item.quantity +
                " - " +
                formatMoney(item.amountTotal, data.currency);

            listItem.append(description, details);
            itemList.append(listItem);
        });

        const total = document.createElement("div");
        total.className = "checkout-confirmation-total";

        const totalLabel = document.createElement("span");
        totalLabel.textContent = "Total paid";

        const totalAmount = document.createElement("strong");
        totalAmount.textContent = formatMoney(
            data.amountTotal,
            data.currency,
        );

        total.append(totalLabel, totalAmount);

        const homeLink = document.createElement("a");
        homeLink.className = "merch-button merch-button-red";
        homeLink.href = "/";
        homeLink.textContent = "Return to HACYPAA";

        confirmation.append(
            overline,
            title,
            message,
            itemList,
            total,
            homeLink,
        );

        checkoutContainer.append(confirmation);
    }

    async function verifyReturnedCheckout() {
        const parameters = new URLSearchParams(window.location.search);

        if(parameters.get("checkout") !== "complete") {
            return;
        }

        const sessionID = parameters.get("session_id");

        if (!sessionID) {
            return;
        }
        
        if(!checkoutDialog.open) {
            checkoutDialog.showModal();
        }

        checkoutStatus.hidden = false;
        checkoutStatus.textContent = "Verifying payment...";

        try {
            const response = await fetch(
                checkoutApi +
                "/checkout/session-status?session_id=" +
                encodeURIComponent(sessionID),
            );

            const data = await response.json().catch(function () {
                return {};
            });

            if (!response.ok) {
                throw new Error(
                    data.error || "Could not verify payment",
                );
            }

            if (data.paid !== true) {
                checkoutStatus.textContent =
                data.status === "open"
                    ? "Payment was not completed. Your cart is still waiting."
                    : "Payment has not been confirmed. Your cart was not cleared.";

                checkoutButton.disabled = readCart().length === 0;
                return;
            }

            clearPaidCart();
            checkoutButton.disabled = true;
            renderConfirmation(data);

            window.history.replaceState(
                {},
                document.title,
                window.location.pathname,
            );
        } catch (error) {
            checkoutStatus.hidden = false;
            checkoutStatus.textContent =
                error instanceof Error
                ? error.message
                : "Could not verify payment";

            checkoutButton.disabled = readCart().length === 0;
        }
    }

    async function openCheckout() {
        if (!readCart().length || checkoutInstance) {
            return;
        }

        checkoutButton.disabled = true;
        checkoutContainer.replaceChildren();

        if (checkoutHeading) {
            checkoutHeading.textContent = "Checkout";
        }

        checkoutStatus.hidden = false;
        checkoutStatus.textContent = "Loading secure checkout...";

        if (!checkoutDialog.open) {
            checkoutDialog.showModal();
        }

        try {
            const stripe = Stripe(stripePublishableKey);

            checkoutInstance =
            await stripe.createEmbeddedCheckoutPage({
                fetchClientSecret: fetchClientSecret,
            });
            
            checkoutInstance.mount("#checkout");
            checkoutStatus.hidden = true;
        } catch (error) {
            checkoutStatus.hidden = false;
            checkoutStatus.textContent = 
                error instanceof Error 
                    ? error.message
                    : "Checkout failed to load";

            checkoutButton.disabled = false;
        }
    }

    function closeCheckout() {
        if (checkoutInstance) {
            checkoutInstance.destroy();
            checkoutInstance = null;
        }

        checkoutContainer.replaceChildren();

        if (checkoutDialog.open) {
            checkoutDialog.close();
        }

        checkoutButton.disabled = readCart().length === 0;
    }

    checkoutButton?.addEventListener("click", openCheckout);

    document
        .querySelectorAll("[data-checkout-close]")
        .forEach(function (button) {
            button.addEventListener("click", closeCheckout);
        });

        void verifyReturnedCheckout();
})();