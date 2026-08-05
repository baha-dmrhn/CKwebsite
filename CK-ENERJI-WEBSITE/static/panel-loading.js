(() => {
  let tries = 0;
  let checking = false;
  let redirecting = false;
  let redirectWatchdog = 0;
  const maxDelay = 5000;
  const requestTimeoutMs = 6000;
  const slowNoticeMs = 15000;
  const message = document.getElementById("panelLoadingMessage");
  const retryButton = document.getElementById("panelLoadingRetry");
  const steps = [...document.querySelectorAll("[data-loading-step]")];

  function setStage(stage, detail) {
    steps.forEach((step, index) => {
      step.classList.toggle("is-done", index < stage);
      step.classList.toggle("is-active", index === stage);
      const marker = step.querySelector("span");
      if (marker) marker.textContent = index < stage ? "✓" : String(index + 1);
    });
    if (message && detail) message.textContent = detail;
  }

  function targetUrl() {
    const current = new URL(window.location.href);
    let target = current;
    if (current.pathname === "/panel-hazirlaniyor") {
      const requested = current.searchParams.get("next") || "/login";
      target = new URL(requested, window.location.origin);
      if (target.origin !== window.location.origin) {
        target = new URL("/login", window.location.origin);
      }
    }
    target.searchParams.delete("next");
    target.searchParams.set("ck_ready", Date.now().toString());
    return target;
  }

  function showSlowNotice() {
    if (redirecting) return;
    setStage(0, "Sunucu beklenenden uzun sürede açılıyor. Kontrol sürüyor.");
    if (retryButton) retryButton.hidden = false;
  }

  async function clearStaleLoadingWorker() {
    const jobs = [];
    if ("serviceWorker" in navigator) {
      jobs.push(
        navigator.serviceWorker.getRegistrations().then((registrations) =>
          Promise.all(registrations.map((registration) => registration.unregister()))
        )
      );
    }
    if ("caches" in window) {
      jobs.push(
        caches.keys().then((keys) =>
          Promise.all(
            keys
              .filter((key) => key.startsWith("ck-enerji-shell-"))
              .map((key) => caches.delete(key))
          )
        )
      );
    }
    await Promise.race([
      Promise.allSettled(jobs),
      new Promise((resolve) => window.setTimeout(resolve, 1200)),
    ]);
  }

  async function retry() {
    if (checking || redirecting) return;
    checking = true;
    tries += 1;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      const response = await fetch(`/health?loading=${Date.now()}`, {
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      const payload = response.ok ? await response.json() : null;
      if (payload?.status === "ok") {
        setStage(1, "Sunucu hazır. Panel yükleniyor…");
        const target = targetUrl();
        redirecting = true;
        setStage(2, "Panel hazır. Oturum açılıyor…");
        await clearStaleLoadingWorker();
        window.clearTimeout(redirectWatchdog);
        redirectWatchdog = window.setTimeout(() => {
          window.location.replace(target.href);
        }, 5000);
        window.location.replace(target.href);
        return;
      }
    } catch (_) {
      // Render cold-start veya geçici bağlantı hatasında hazırlık ekranında kal.
    } finally {
      window.clearTimeout(timeout);
      checking = false;
    }
    window.setTimeout(retry, Math.min(1200 + tries * 450, maxDelay));
  }

  retryButton?.addEventListener("click", () => {
    retryButton.hidden = true;
    setStage(0, "Sunucu yeniden kontrol ediliyor…");
    retry();
  });
  window.addEventListener("online", retry);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) retry();
  });
  setStage(0, "Sunucu uyandırılıyor…");
  window.setTimeout(showSlowNotice, slowNoticeMs);
  window.setTimeout(retry, 900);
})();
