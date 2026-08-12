const menuButton = document.querySelector(".menu-toggle");
const mobileMenu = document.querySelector(".mobile-nav");

if (menuButton && mobileMenu) {
  const closeMenu = () => {
    mobileMenu.classList.remove("is-open");
    menuButton.setAttribute("aria-expanded", "false");
    menuButton.setAttribute("aria-label", "Open menu");
    document.body.classList.remove("menu-open");
  };

  menuButton.addEventListener("click", () => {
    const willOpen = !mobileMenu.classList.contains("is-open");

    mobileMenu.classList.toggle("is-open", willOpen);
    menuButton.setAttribute("aria-expanded", String(willOpen));
    menuButton.setAttribute(
      "aria-label",
      willOpen ? "Close menu" : "Open menu",
    );
    document.body.classList.toggle("menu-open", willOpen);
  });

  mobileMenu.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", closeMenu);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMenu();
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth > 1100) closeMenu();
  });
}
