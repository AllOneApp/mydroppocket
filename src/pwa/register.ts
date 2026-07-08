// Guarded PWA service-worker registration. Never registers in Lovable preview / dev / iframes.
export function registerPwa() {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;

  const url = new URL(window.location.href);
  const host = window.location.hostname;
  const inIframe = window.self !== window.top;
  const isPreview =
    host.startsWith("id-preview--") ||
    host.startsWith("preview--") ||
    host === "lovableproject.com" ||
    host.endsWith(".lovableproject.com") ||
    host === "lovableproject-dev.com" ||
    host.endsWith(".lovableproject-dev.com") ||
    host === "beta.lovable.dev" ||
    host.endsWith(".beta.lovable.dev");
  const killSwitch = url.searchParams.get("sw") === "off";
  const isProd = import.meta.env.PROD;

  if (!isProd || inIframe || isPreview || killSwitch) {
    // Unregister any existing app SW so stale caches don't linger in preview/dev.
    navigator.serviceWorker
      .getRegistrations()
      .then((regs) => {
        regs.forEach((r) => {
          const swUrl = r.active?.scriptURL || r.installing?.scriptURL || r.waiting?.scriptURL || "";
          if (swUrl.endsWith("/sw.js")) void r.unregister();
        });
      })
      .catch(() => undefined);
    return;
  }

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  });
}