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

//Cloudflare analytics: public pages on the live website only.

(() => {
  const publicPages = [
    "/",
    "/about/",
    "/hotel/",
    "/program/",
    "/events/",
    "/get-involved/",
    "/registration/",
    "/merch/",
  ];

  const path = window.location.pathname.replace(/index\.html$/, "");
  const isProduction = ["hacypaa.us", "www.hacypaa.us"].includes(
    window.location.hostname,
  );

  if (!isProduction || !publicPages.includes(path)) return;

  const analytics = document.createElement("script");
  analytics.type = "module";
  analytics.src = "https://static.cloudflareinsights.com/beacon.min.js";
  analytics.dataset.cfBeacon = JSON.stringify({
    token: "f95f36165401491aa3dba8ff7d5606de",
  });

  document.body.appendChild(analytics);
})();