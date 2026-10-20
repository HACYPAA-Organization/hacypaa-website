(function () {
    "use strict";

    const motionPreference = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
    );

    if (
        motionPreference.matches ||
        !document.body ||
        typeof Element.prototype.animate !== "function" ||
        document.querySelector("#halloween-rain")
    ) {
        return;
    }

    const layer = document.createElement("div");
    layer.id = "halloween-rain";
    layer.setAttribute("aria-hidden", "true");

    Object.assign(layer.style, {
        position: "fixed",
        inset: "0",
        overflow: "hidden",
        pointerEvents: "none",
        userSelect: "none",
        zIndex: "1000",
    });

    document.body.append(layer);

    const symbols = [
        "\u{1F383}",
        "\u{1F47B}",
        "\u{1F480}",
        "\u{1F608}",
    ];
    const smallScreen = window.matchMedia("(max-width: 700px)").matches;
    const count = smallScreen ? 20 : 40;
    const animations = [];

    for (let index = 0; index < count; index += 1) {
        const particle = document.createElement("span");
        particle.textContent =
            symbols[Math.floor(Math.random() * symbols.length)];

        Object.assign(particle.style, {
            position: "absolute",
            top: "-64px",
            left: (2 + ((index + 0.5) / count) * 96) + "%",
            fontSize: ((smallScreen ? 22 : 28) + Math.random() * 14) + "px",
            lineHeight: "1",
            fontFamily:
                '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif',
            filter: "drop-shadow(0 3px 5px rgba(0, 0, 0, 0.3))",
            opacity: "0",
        });

        layer.append(particle);

        const drift = Math.round(Math.random() * 180 - 90);
        const rotation = Math.round(Math.random() * 240 - 120);

        animations.push(particle.animate([
            {
                offset: 0,
                opacity: 0,
                transform: "translate3d(0, 0, 0) rotate(0deg)",
            },
            { offset: 0.12, opacity: 1 },
            { offset: 0.7, opacity: 1 },
            {
                offset: 1,
                opacity: 0,
                transform:
                    "translate3d(" + drift +
                    "px, calc(100vh + 128px), 0) rotate(" + rotation + "deg)",
            },
        ], {
            duration: 4000 + Math.random() * 2000,
            delay: Math.random() * 4000,
            easing: "linear",
            fill: "both",
        }));
    }

    let cleanupTimer;

    function cleanup() {
        window.clearTimeout(cleanupTimer);
        motionPreference.removeEventListener("change", handleMotionChange);
        window.removeEventListener("pagehide", cleanup);
        animations.forEach((animation) => animation.cancel());
        layer.remove();
    }

    function handleMotionChange(event) {
        if (event.matches) {
            cleanup();
        }
    }

    motionPreference.addEventListener("change", handleMotionChange);
    window.addEventListener("pagehide", cleanup, { once: true });
    cleanupTimer = window.setTimeout(cleanup, 10300);
})();