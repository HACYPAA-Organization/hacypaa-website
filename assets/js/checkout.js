(function () {
    "use strict";

    const storageKey = "hacypaa-merch-cart-v2";
    const checkoutApi = [
        "localhost",
        "127.0.0.1",
    ].includes(window.location.hostname)
        ? "http://127.0.0.1:8787"
        : "https://checkout-api.tgp-services.workers.dev";
    const stripePublishableKey =
    "pk_live_51U82LpM0AC70O1UBhevzm4CAYh0N9JX501HQ7ri4hQy0066vuBUWay1xAbjUBXwdsXN0T0qQl3LeuTqqdnlFcXn300Rs2Yczbb";

    const checkoutButton = document.querySelector("[data-checkout-open]");
    const checkoutDialog = document.querySelector("#checkout-dialog");
    const checkoutContainer = document.querySelector("#checkout");
    const checkoutStatus = document.querySelector("#checkout-status");
    const checkoutHeading = document.querySelector(
        "#checkout-dialog .cart-heading h2",
    );

    const shippingForm = document.querySelector(
        "#checkout-shipping-form",
    );

    const shippingOptionsContainer = document.querySelector(
        "#checkout-shipping-options",
    );

    let checkoutInstance = null;
    let checkoutStarting = false;
    let shippingSelection = null;
    let shippingQuoteVersion = 0;

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

    function renderShippingOptions(options, address) {
        shippingSelection = null;
        shippingOptionsContainer.replaceChildren();

        const fieldset = document.createElement("fieldset");
        const legend = document.createElement("legend");
        legend.textContent = "Choose shipping";
        fieldset.append(legend);

        const continueButton = document.createElement("button");
        continueButton.type = "button";
        continueButton.className = "merch-button merch-button-red";
        continueButton.textContent = "Continue to payment";
        continueButton.disabled = true;

        options.forEach(function (option) {
            const label = document.createElement("label");
            const radio = document.createElement("input");

            radio.type = "radio";
            radio.name = "checkoutShippingMethod";
            radio.value = String(option.method);
            radio.required = true;

            radio.addEventListener("change", function () {
                if (!radio.checked) {
                    return;
                }

                shippingSelection = {
                    address: { ...address },
                    method: option.method,
                };

                continueButton.disabled = false;
            });

            label.append(
                radio,
                document.createTextNode(
                    option.label +
                    " — " +
                    formatMoney(option.amountCents),
                ),
            );

            fieldset.append(label);
        });

        continueButton.addEventListener("click", async function () {
            if (checkoutStarting) {
                return;
            }

            continueButton.disabled = true;

            try {
                await startStripeCheckout();
            } finally {
                continueButton.disabled = !shippingSelection;
            }
        });

        shippingOptionsContainer.append(fieldset, continueButton);
        shippingOptionsContainer.hidden = false;

        requestAnimationFrame(function () {
            if (!checkoutDialog.open) return;

            const headingHeight =
                checkoutDialog.querySelector(".cart-heading")?.offsetHeight || 0;

            const optionsTop =
                checkoutDialog.scrollTop +
                shippingOptionsContainer.getBoundingClientRect().top -
                checkoutDialog.getBoundingClientRect().top -
                checkoutDialog.clientTop -
                headingHeight -
                16;

            checkoutDialog.scrollTo({
                top: optionsTop,
                behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
                    ? "auto"
                    : "smooth",
            });
        });
    }

    shippingForm.addEventListener("input", function () {
        shippingQuoteVersion += 1;
        shippingSelection = null;
        shippingOptionsContainer.replaceChildren();
        shippingOptionsContainer.hidden = true;
    });

    shippingForm.addEventListener("submit", async function (event) {
        event.preventDefault();

        const button = shippingForm.querySelector('[type="submit"]');

        if (button.disabled || !shippingForm.reportValidity()) {
            return;
        }

        const version = ++shippingQuoteVersion;

        const address = Object.fromEntries(
            [...new FormData(shippingForm)].map(function ([key, value]) {
                return [key, String(value).trim()];
            }),
        );

        address.state = address.state.toUpperCase();
        address.country = "US";

        shippingSelection = null;
        shippingOptionsContainer.replaceChildren();
        shippingOptionsContainer.hidden = true;

        button.disabled = true;
        button.textContent = "Calculating...";
        checkoutStatus.hidden = false;
        checkoutStatus.textContent = "Calculating shipping options...";

        try {
            const items = readCart().map(function (item) {
                return {
                    productId: item.productId,
                    variantId: item.variantId,
                    quantity: item.quantity,
                };
            });

            if (!items.length) {
                throw new Error("Your cart is empty.");
            }

            const response = await fetch(
                checkoutApi + "/checkout/shipping-quote",
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({ items, address }),
                },
            );

            const payload = await response.json().catch(function () {
                return {};
            });

            if (version !== shippingQuoteVersion) {
                return;
            }

            if (
                !response.ok ||
                !Array.isArray(payload.options) ||
                !payload.options.length
            ) {
                throw new Error(
                    payload.error || "Could not calculate shippings.",
                );
            }

            renderShippingOptions(payload.options, address);
            checkoutStatus.textContent = "Choose a shipping method.";
        } catch (error) {
            if (version === shippingQuoteVersion) {
                checkoutStatus.textContent =
                    error instanceof Error
                        ? error.message
                        : "Could not calculate shipping.";
            }
        } finally {
            button.disabled = false;
            button.textContent = "Calculate shipping";
        }
    });

    async function fetchClientSecret() {
        if (
            !shippingSelection ||
            ![1, 4].includes(shippingSelection.method)
        ) {
            throw new Error("Choose a shipping method before continuing.");
        }
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
            body: JSON.stringify({
                items,
                shipping: shippingSelection,
            }),
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

    function openCheckout() {
        if (!readCart().length || checkoutInstance) {
            return;
        }

        shippingQuoteVersion += 1;
        shippingSelection = null;

        shippingOptionsContainer.replaceChildren();
        shippingOptionsContainer.hidden = true;
        checkoutContainer.replaceChildren();

        shippingForm.hidden = false;
        checkoutStatus.hidden = true;
        checkoutStatus.textContent = "";
        checkoutButton.disabled = true;

        if (checkoutHeading) {
            checkoutHeading.textContent = "Delivery and shipping";
        }

        const cartDialog = document.querySelector("#cart-dialog");

        if (cartDialog?.open) {
            cartDialog.close();
        }

        if (!checkoutDialog.open) {
            checkoutDialog.showModal();
        }

        shippingForm.querySelector("input")?.focus();
    }

    async function startStripeCheckout() {
        if (
            checkoutStarting ||
            checkoutInstance ||
            !checkoutDialog.open
        ) {
            return;
        }

        if (
            !readCart().length ||
            !shippingSelection ||
            ![1, 4].includes(shippingSelection.method)
        ) {
            checkoutStatus.hidden = false;
            checkoutStatus.textContent =
                "Review your cart and choose a shipping method.";
            return;
        }

        checkoutStarting = true;
        const version = shippingQuoteVersion;

        shippingForm.hidden = true;
        shippingOptionsContainer.hidden = true;
        checkoutContainer.replaceChildren();

        checkoutStatus.hidden = false;
        checkoutStatus.textContent = "Loading secure checkout...";

        if (checkoutHeading) {
            checkoutHeading.textContent = "Checkout";
        }

        try {
            const stripe = Stripe(stripePublishableKey);

            const instance = await stripe.createEmbeddedCheckoutPage({
                fetchClientSecret,
            });

            if (
                version !== shippingQuoteVersion ||
                !checkoutDialog.open
            ) {
                instance.destroy();
                return;
            }

            checkoutInstance = instance;
            checkoutInstance.mount("#checkout");
            checkoutStatus.hidden = true;
        } catch (error) {
            if (checkoutInstance) {
                checkoutInstance.destroy();
                checkoutInstance = null;
            }

            checkoutContainer.replaceChildren();

            if (
                version !== shippingQuoteVersion ||
                !checkoutDialog.open
            ) {
                return;
            }

            shippingForm.hidden = false;
            shippingOptionsContainer.hidden = !shippingSelection;

            if (checkoutHeading) {
                checkoutHeading.textContent = "Delivery and shipping";
            }

            checkoutStatus.hidden = false;
            checkoutStatus.textContent =
                error instanceof Error
                    ? error.message
                    : "could not open secure checkout.";
        } finally {
            checkoutStarting = false;
        }
    }

    function closeCheckout() {

        shippingQuoteVersion += 1;
        shippingSelection = null;
        shippingForm.hidden = true;
        shippingOptionsContainer.replaceChildren();
        shippingOptionsContainer.hidden = true;


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

    checkoutDialog.addEventListener("cancel", function (event) {
        event.preventDefault();
        closeCheckout();
    });

})();