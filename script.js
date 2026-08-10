const menuButton = document.querySelector(".menu-toggle");
    const mobileMenu = document.querySelector(".mobile-nav");

    function closeMenu() {
      mobileMenu.classList.remove("is-open");
      menuButton.setAttribute("aria-expanded", "false");
      menuButton.setAttribute("aria-label", "Open menu");
    }

    menuButton.addEventListener("click", () => {
      const willOpen = !mobileMenu.classList.contains("is-open");
      mobileMenu.classList.toggle("is-open", willOpen);
      menuButton.setAttribute("aria-expanded", String(willOpen));
      menuButton.setAttribute("aria-label", willOpen ? "Close menu" : "Open menu");
    });

    mobileMenu.querySelectorAll("a").forEach((link) => link.addEventListener("click", closeMenu));
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeMenu();
    });