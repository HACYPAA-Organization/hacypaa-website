(function () {
  "use strict";

  const checkoutButton = document.querySelector("[data-checkout-open]");
  const products = Array.isArray(window.HACYPAA_PRODUCTS)
    ? window.HACYPAA_PRODUCTS
    : [];

  const productGrid = document.querySelector("#product-grid");
  const productDialog = document.querySelector("#product-dialog");
  const productDialogContent = document.querySelector(
    "#product-dialog-content",
  );
  const cartDialog = document.querySelector("#cart-dialog");
  const cartItems = document.querySelector("#cart-items");
  const cartSubtotal = document.querySelector("#cart-subtotal");
  const toast = document.querySelector("#merch-toast");
  const storageKey = "hacypaa-merch-cart-v2";

  const descriptions = {
    "Divine Paradox Band Hoodie":
      "Heavyweight fleece with front and back Divine Paradox artwork.",
    "Divine Paradox Double Puppy Tee":
      "Garment-dyed Comfort Colors tee with the double puppy graphic.",
    "Choose Your Own Conception Graphic Tee":
      "Garment-dyed Comfort Colors tee featuring Choose Your Own Conception.",
  };

  let cart = loadCart();
  let activeProduct = null;
  let selectedColorId = null;
  let selectedSizeId = null;
  let selectedQuantity = 1;
  let toastTimer = null;

  function formatMoney(cents) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(cents / 100);
  }

  function safeImage(url) {
    try {
      const parsed = new URL(url);
      if (
        parsed.protocol === "https:" &&
        parsed.hostname === "images-api.printify.com"
      ) {
        return parsed.href;
      }
    } catch (error) {
      return "";
    }
    return "";
  }

  function getGroups(product) {
    return {
      color: product.options.find(function (option) {
        return option.type === "color";
      }),
      size: product.options.find(function (option) {
        return option.type === "size";
      }),
    };
  }

  function optionNumber(value) {
    return Number.parseInt(String(value), 10);
  }

  function findVariant(product, colorId, sizeId) {
    return product.variants.find(function (variant) {
      return (
        !variant.outOfStock &&
        variant.options.includes(optionNumber(colorId)) &&
        variant.options.includes(optionNumber(sizeId))
      );
    });
  }

  function availableVariants(product) {
    return product.variants.filter(function (variant) {
      return !variant.outOfStock;
    });
  }

  function priceLabel(product) {
    const prices = availableVariants(product).map(function (variant) {
      return variant.retailPrice;
    });
    const minimum = Math.min.apply(null, prices);
    const maximum = Math.max.apply(null, prices);
    return minimum === maximum
      ? formatMoney(minimum)
      : "From " + formatMoney(minimum);
  }

  function optionLabel(product, optionId) {
    for (const group of product.options) {
      const item = group.items.find(function (candidate) {
        return optionNumber(candidate.externalId) === optionNumber(optionId);
      });
      if (item) return item.label;
    }
    return "";
  }

  function variantLabels(product, variant) {
    const groups = getGroups(product);
    const color = groups.color.items.find(function (item) {
      return variant.options.includes(optionNumber(item.externalId));
    });
    const size = groups.size.items.find(function (item) {
      return variant.options.includes(optionNumber(item.externalId));
    });
    return {
      color: color ? color.label : "",
      size: size ? size.label : "",
    };
  }

  function renderProducts() {
    if (!productGrid) return;
    productGrid.replaceChildren();

    products.forEach(function (product, index) {
      const article = document.createElement("article");
      article.className = "product-card";

      const imageWrap = document.createElement("div");
      imageWrap.className = "product-card-image";

      const image = document.createElement("img");
      image.src = safeImage(product.image);
      image.alt = product.title;
      image.width = 900;
      image.height = 900;
      image.loading = index === 0 ? "eager" : "lazy";
      image.decoding = "async";
      imageWrap.append(image);

      const copy = document.createElement("div");
      copy.className = "product-card-copy";

      const title = document.createElement("h3");
      title.textContent = product.title;

      const price = document.createElement("span");
      price.className = "product-price";
      price.textContent = priceLabel(product);

      const meta = document.createElement("p");
      meta.className = "product-card-meta";
      meta.textContent =
        descriptions[product.title] || "Official HACYPAA XI merchandise.";

      copy.append(title, price, meta);

      const button = document.createElement("button");
      button.className = "product-open";
      button.type = "button";
      button.dataset.productOpen = String(product.id);
      button.textContent = "Choose options";

      article.append(imageWrap, copy, button);
      productGrid.append(article);
    });
  }

  function buildOptionGroup(group) {
    const fieldset = document.createElement("fieldset");
    fieldset.className = "product-option";

    const legend = document.createElement("legend");
    legend.textContent = group.type === "color" ? "Color" : "Size";

    const list = document.createElement("div");
    list.className = "option-list";

    group.items.forEach(function (item) {
      const button = document.createElement("button");
      button.className = "option-button";
      button.type = "button";
      button.dataset.optionType = group.type;
      button.dataset.optionValue = String(item.externalId);
      button.setAttribute("aria-pressed", "false");

      if (group.type === "color") {
        const dot = document.createElement("span");
        dot.className = "color-dot";
        dot.style.background = item.values && item.values[0]
          ? item.values[0]
          : "transparent";
        dot.setAttribute("aria-hidden", "true");
        button.append(dot);
      }

      button.append(document.createTextNode(item.label));
      list.append(button);
    });

    fieldset.append(legend, list);
    return fieldset;
  }

  function buildProductDialog(product) {
    const groups = getGroups(product);
    const firstVariant = availableVariants(product)[0];

    if (!firstVariant || !groups.color || !groups.size) return;

    const firstLabels = variantLabels(product, firstVariant);
    const firstColor = groups.color.items.find(function (item) {
      return item.label === firstLabels.color;
    });
    const firstSize = groups.size.items.find(function (item) {
      return item.label === firstLabels.size;
    });

    activeProduct = product;
    selectedColorId = optionNumber(firstColor.externalId);
    selectedSizeId = optionNumber(firstSize.externalId);
    selectedQuantity = 1;

    const layout = document.createElement("div");
    layout.className = "product-dialog-layout";

    const visual = document.createElement("div");
    visual.className = "product-dialog-visual";
    const image = document.createElement("img");
    image.id = "active-product-image";
    image.alt = product.title;
    image.width = 1000;
    image.height = 1000;
    image.src = safeImage(firstVariant.image || product.image);
    visual.append(image);

    const copy = document.createElement("div");
    copy.className = "product-dialog-copy";

    const overline = document.createElement("p");
    overline.className = "merch-overline";
    overline.textContent = "Official HACYPAA XI merchandise";

    const title = document.createElement("h2");
    title.textContent = product.title;

    const price = document.createElement("p");
    price.className = "product-dialog-price";
    price.id = "active-product-price";
    price.textContent = formatMoney(firstVariant.retailPrice);

    const options = document.createElement("div");
    options.id = "active-product-options";
    options.append(buildOptionGroup(groups.color), buildOptionGroup(groups.size));

    const purchaseRow = document.createElement("div");
    purchaseRow.className = "product-purchase-row";

    const quantity = document.createElement("div");
    quantity.className = "quantity-control";
    quantity.setAttribute("aria-label", "Quantity");

    const minus = document.createElement("button");
    minus.type = "button";
    minus.dataset.quantityChange = "-1";
    minus.setAttribute("aria-label", "Decrease quantity");
    minus.textContent = "−";

    const output = document.createElement("output");
    output.id = "active-product-quantity";
    output.textContent = "1";

    const plus = document.createElement("button");
    plus.type = "button";
    plus.dataset.quantityChange = "1";
    plus.setAttribute("aria-label", "Increase quantity");
    plus.textContent = "+";

    quantity.append(minus, output, plus);

    const add = document.createElement("button");
    add.className = "merch-button merch-button-red product-add";
    add.type = "button";
    add.dataset.addToCart = "";

    purchaseRow.append(quantity, add);
    copy.append(overline, title, price, options, purchaseRow);
    layout.append(visual, copy);
    productDialogContent.replaceChildren(layout);
    updateProductSelection();
  }

  function sizeIsAvailable(product, colorId, sizeId) {
    return Boolean(findVariant(product, colorId, sizeId));
  }

  function chooseFirstAvailableSize(product, colorId) {
    const groups = getGroups(product);
    const available = groups.size.items.find(function (item) {
      return sizeIsAvailable(product, colorId, item.externalId);
    });
    return available ? optionNumber(available.externalId) : null;
  }

  function updateProductSelection() {
    if (!activeProduct || !productDialogContent) return;

    if (!sizeIsAvailable(activeProduct, selectedColorId, selectedSizeId)) {
      selectedSizeId = chooseFirstAvailableSize(activeProduct, selectedColorId);
    }

    const variant = findVariant(
      activeProduct,
      selectedColorId,
      selectedSizeId,
    );

    productDialogContent
      .querySelectorAll("[data-option-type]")
      .forEach(function (button) {
        const value = optionNumber(button.dataset.optionValue);
        const isColor = button.dataset.optionType === "color";
        const selected = isColor
          ? value === selectedColorId
          : value === selectedSizeId;

        button.setAttribute("aria-pressed", String(selected));
        if (!isColor) {
          button.disabled = !sizeIsAvailable(
            activeProduct,
            selectedColorId,
            value,
          );
        }
      });

    const image = productDialogContent.querySelector("#active-product-image");
    const price = productDialogContent.querySelector("#active-product-price");
    const quantity = productDialogContent.querySelector(
      "#active-product-quantity",
    );
    const add = productDialogContent.querySelector("[data-add-to-cart]");

    if (variant) {
      image.src = safeImage(variant.image || activeProduct.image);
      price.textContent = formatMoney(variant.retailPrice);
      add.disabled = false;
      add.textContent =
        "Add to cart — " +
        formatMoney(variant.retailPrice * selectedQuantity);
    } else {
      price.textContent = "Unavailable";
      add.disabled = true;
      add.textContent = "Unavailable";
    }

    quantity.textContent = String(selectedQuantity);
  }

  function addActiveProductToCart() {
    const variant = findVariant(
      activeProduct,
      selectedColorId,
      selectedSizeId,
    );
    if (!variant) return;

    const labels = variantLabels(activeProduct, variant);
    const key =
      activeProduct.printifyProductId + ":" + variant.printifyVariantId;
    const existing = cart.find(function (item) {
      return item.key === key;
    });

    if (existing) {
      existing.quantity = Math.min(10, existing.quantity + selectedQuantity);
    } else {
      cart.push({
        key: key,
        productId: activeProduct.printifyProductId,
        variantId: variant.printifyVariantId,
        title: activeProduct.title,
        color: labels.color,
        size: labels.size,
        price: variant.retailPrice,
        image: safeImage(variant.image || activeProduct.image),
        quantity: selectedQuantity,
      });
    }

    saveCart();
    renderCart();
    productDialog.close();
    showToast(activeProduct.title + " added to cart.");
  }

  function loadCart() {
    try {
      const parsed = JSON.parse(localStorage.getItem(storageKey) || "[]");
      if (!Array.isArray(parsed)) return [];

      return parsed.filter(function (item) {
        return (
          item &&
          typeof item.key === "string" &&
          typeof item.title === "string" &&
          Number.isInteger(item.price) &&
          Number.isInteger(item.quantity) &&
          item.quantity > 0
        );
      });
    } catch (error) {
      return [];
    }
  }

  function saveCart() {
    try {
      localStorage.setItem(storageKey, JSON.stringify(cart));
    } catch (error) {
      return;
    }
  }

  function cartCount() {
    return cart.reduce(function (total, item) {
      return total + item.quantity;
    }, 0);
  }

  function cartTotal() {
    return cart.reduce(function (total, item) {
      return total + item.price * item.quantity;
    }, 0);
  }

  function renderCart() {
    document.querySelectorAll("[data-cart-count]").forEach(function (count) {
      count.textContent = String(cartCount());
    });

    if (!cartItems || !cartSubtotal) return;
    cartItems.replaceChildren();

    if (!cart.length) {
      const empty = document.createElement("p");
      empty.className = "cart-empty";
      empty.textContent =
        "Your cart is empty. The paradox remains wearable, unfortunately.";
      cartItems.append(empty);
    }

    cart.forEach(function (item) {
      const article = document.createElement("article");
      article.className = "cart-item";

      const image = document.createElement("img");
      image.src = safeImage(item.image);
      image.alt = "";
      image.width = 220;
      image.height = 220;

      const copy = document.createElement("div");
      copy.className = "cart-item-copy";

      const title = document.createElement("h3");
      title.textContent = item.title;

      const options = document.createElement("p");
      options.className = "cart-item-options";
      options.textContent = item.color + " / " + item.size;

      const actions = document.createElement("div");
      actions.className = "cart-item-actions";

      const quantity = document.createElement("div");
      quantity.className = "cart-quantity";
      quantity.setAttribute("aria-label", "Quantity for " + item.title);

      const minus = document.createElement("button");
      minus.type = "button";
      minus.dataset.cartQuantity = "-1";
      minus.dataset.cartKey = item.key;
      minus.disabled = item.quantity <= 1;
      minus.setAttribute("aria-label", "Decrease quantity");
      minus.textContent = "−";

      const output = document.createElement("output");
      output.textContent = String(item.quantity);

      const plus = document.createElement("button");
      plus.type = "button";
      plus.dataset.cartQuantity = "1";
      plus.dataset.cartKey = item.key;
      plus.disabled = item.quantity >= 10;
      plus.setAttribute("aria-label", "Increase quantity");
      plus.textContent = "+";

      quantity.append(minus, output, plus);

      const price = document.createElement("strong");
      price.className = "cart-item-price";
      price.textContent = formatMoney(item.price * item.quantity);

      actions.append(quantity, price);

      const remove = document.createElement("button");
      remove.className = "cart-remove";
      remove.type = "button";
      remove.dataset.cartRemove = item.key;
      remove.textContent = "Remove";

      copy.append(title, options, actions, remove);
      article.append(image, copy);
      cartItems.append(article);
    });

    cartSubtotal.textContent = formatMoney(cartTotal());

    if (checkoutButton) {
      checkoutButton.disabled = cart.length === 0;
    }
    
  }

  function showToast(message) {
    if (!toast) return;
    window.clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.add("is-visible");
    toastTimer = window.setTimeout(function () {
      toast.classList.remove("is-visible");
    }, 2400);
  }

  function openCart() {
    const mobileMenu = document.querySelector(".mobile-nav");
    const menuButton = document.querySelector(".menu-toggle");
    if (mobileMenu) mobileMenu.classList.remove("is-open");
    if (menuButton) {
      menuButton.setAttribute("aria-expanded", "false");
      menuButton.setAttribute("aria-label", "Open menu");
    }
    document.body.classList.remove("menu-open");
    renderCart();
    if (!cartDialog.open) cartDialog.showModal();
  }

  if (productGrid) {
    productGrid.addEventListener("click", function (event) {
      const button = event.target.closest("[data-product-open]");
      if (!button) return;
      const product = products.find(function (candidate) {
        return String(candidate.id) === button.dataset.productOpen;
      });
      if (!product) return;
      buildProductDialog(product);
      productDialog.showModal();
    });
  }

  if (productDialogContent) {
    productDialogContent.addEventListener("click", function (event) {
      const option = event.target.closest("[data-option-type]");
      const quantity = event.target.closest("[data-quantity-change]");
      const add = event.target.closest("[data-add-to-cart]");

      if (option && !option.disabled) {
        const value = optionNumber(option.dataset.optionValue);
        if (option.dataset.optionType === "color") {
          selectedColorId = value;
        } else {
          selectedSizeId = value;
        }
        updateProductSelection();
      }

      if (quantity) {
        selectedQuantity = Math.max(
          1,
          Math.min(
            10,
            selectedQuantity + optionNumber(quantity.dataset.quantityChange),
          ),
        );
        updateProductSelection();
      }

      if (add && !add.disabled) addActiveProductToCart();
    });
  }

  document.querySelectorAll("[data-product-close]").forEach(function (button) {
    button.addEventListener("click", function () {
      productDialog.close();
    });
  });

  document.querySelectorAll("[data-cart-open]").forEach(function (button) {
    button.addEventListener("click", openCart);
  });

  document.querySelectorAll("[data-cart-close]").forEach(function (button) {
    button.addEventListener("click", function () {
      cartDialog.close();
    });
  });

  if (cartItems) {
    cartItems.addEventListener("click", function (event) {
      const quantity = event.target.closest("[data-cart-quantity]");
      const remove = event.target.closest("[data-cart-remove]");

      if (quantity) {
        const item = cart.find(function (candidate) {
          return candidate.key === quantity.dataset.cartKey;
        });
        if (item) {
          item.quantity = Math.max(
            1,
            Math.min(
              10,
              item.quantity + optionNumber(quantity.dataset.cartQuantity),
            ),
          );
        }
      }

      if (remove) {
        cart = cart.filter(function (item) {
          return item.key !== remove.dataset.cartRemove;
        });
      }

      saveCart();
      renderCart();
    });
  }

  [productDialog, cartDialog].forEach(function (dialog) {
    if (!dialog) return;
    dialog.addEventListener("click", function (event) {
      if (event.target === dialog) dialog.close();
    });
  });

  window.addEventListener("hacypaa:cart-cleared", function() {
    cart= [];
    saveCart();
    renderCart();
  });

  renderProducts();
  renderCart();
})();
