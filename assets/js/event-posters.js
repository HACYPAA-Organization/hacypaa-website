(() => {
    document.querySelectorAll(".scaryoke-poster-gallery").forEach((gallery) => {
        const cards = Array.from(
            gallery.querySelectorAll(":scope > .event-poster-frame"),
        );

        const controls = gallery.querySelector(".poster-carousel-controls");
        const previousButton = gallery.querySelector("[data-poster-prev]");
        const nextButton = gallery.querySelector("[data-poster-next]");
        const counter = gallery.querySelector("[data-poster-count]");

        if (
            cards.length <2 ||
            !controls ||
            !previousButton ||
            !nextButton ||
            !counter
        ) {
            return;
        }

        let currentIndex = 0;

        function showCard(index) {
            currentIndex = (index + cards.length) % cards.length;

            cards.forEach((card, cardIndex) => {
                const isActive = cardIndex === currentIndex;
                card.classList.toggle("is-active", isActive);

                if (isActive) {
                    card.removeAttribute("aria-hidden");
                    card.removeAttribute("tabindex");
                } else {
                    card.setAttribute("aria-hidden", "true");
                    card.setAttribute("tabindex", "-1");
                }
            });

            counter.textContent =
                `Flyer ${currentIndex + 1} of ${cards.length}`;
        }

        previousButton.addEventListener("click", () => {
            showCard(currentIndex - 1);
        });

        nextButton.addEventListener("click",() => {
            showCard(currentIndex + 1);
        });

        showCard(0);
        gallery.classList.add("is-ready");
        controls.hidden = false;
    });
})();