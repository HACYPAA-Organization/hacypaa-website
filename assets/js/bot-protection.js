(function () {
  "use strict";
  const apiBase = ["localhost", "127.0.0.1"].includes(window.location.hostname)
    ? "http://127.0.0.1:8787" : "https://checkout-api.tgp-services.workers.dev";
  const actions = {
    "/registrations": "register", "/panelists": "panelist",
    "/registrations/resend-payment-link": "resend_payment_link",
    "/registrations/payment-report": "payment_report",
    "/checkout/shipping-quote": "checkout_quote", "/checkout/session": "checkout",
  };
  const nativeFetch = window.fetch.bind(window);
  let configuration, scriptReady;

  function loadConfiguration() {
    if (!configuration) configuration = nativeFetch(apiBase + "/public/config", { signal: AbortSignal.timeout(10000) })
      .then(async response => {
        if (!response.ok) throw new Error("Verification is temporarily unavailable. Please try again.");
        const config = await response.json();
        if (config.required !== false && !config.siteKey) throw new Error("Verification is temporarily unavailable. Please try again later.");
        return config;
      }).catch(error => { configuration = null; throw error; });
    return configuration;
  }

  function loadScript() {
    if (window.turnstile) return Promise.resolve();
    if (!scriptReady) scriptReady = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      const timer = window.setTimeout(() => fail(), 10000);
      function fail() { window.clearTimeout(timer); script.remove(); scriptReady = null;
        reject(new Error("Verification could not load. Check your connection and try again.")); }
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.onload = () => { window.clearTimeout(timer); resolve(); };
      script.onerror = fail;
      document.head.appendChild(script);
    });
    return scriptReady;
  }

  function challengeHost(action) {
    const selector = action.startsWith("checkout") ? "#checkout-status" : action === "panelist" ? "#panelist-feedback" :
      action === "payment_report" ? "#payment-report-feedback" :
      document.querySelector("#payment-link-feedback") ? "#payment-link-feedback" : "#prereg-feedback";
    const feedback = document.querySelector(selector);
    const host = document.createElement("div");
    host.className = "hacypaa-verification";
    host.setAttribute("aria-label", "Verify your submission");
    if (feedback) feedback.insertAdjacentElement("afterend", host);
    else document.body.appendChild(host);
    return host;
  }

  async function getToken(action, config, signal) {
    await loadScript();
    if (signal?.aborted) throw new DOMException("Request cancelled", "AbortError");
    return new Promise((resolve, reject) => {
      const host = challengeHost(action); let widgetId, finished = false;
      const timer = window.setTimeout(() => finish(new Error("Verification timed out. Please try again.")), 60000);
      function finish(error, token) {
        if (finished) return; finished = true;
        window.clearTimeout(timer); signal?.removeEventListener("abort", onAbort);
        if (widgetId !== undefined) window.turnstile.remove(widgetId);
        host.remove();
        if (error) reject(error); else resolve(token);
      }
      function onAbort() { finish(new DOMException("Request cancelled", "AbortError")); }
      signal?.addEventListener("abort", onAbort, { once: true });
      try {
        widgetId = window.turnstile.render(host, {
          sitekey: config.siteKey, action, appearance: "interaction-only",
          callback: token => finish(null, token),
          "error-callback": () => { finish(new Error("Verification failed. Please try again.")); return true; },
          "expired-callback": () => finish(new Error("Verification expired. Please try again.")),
        });
      } catch (error) { finish(error); }
    });
  }

  window.HACYPAAProtectedFetch = async function (input, options = {}) {
    const url = new URL(typeof input === "string" ? input : input.url, window.location.href);
    const action = (options.method || "GET").toUpperCase() === "POST" &&
      url.origin === new URL(apiBase).origin && actions[url.pathname];
    if (!action) return nativeFetch(input, options);
    const config = await loadConfiguration();
    if (config.required === false) return nativeFetch(input, options);
    const token = await getToken(action, config, options.signal);
    const body = JSON.parse(options.body);
    return nativeFetch(input, { ...options, body: JSON.stringify({ ...body, turnstileToken: token }) });
  };
})();
