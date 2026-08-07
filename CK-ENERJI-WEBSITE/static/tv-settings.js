(() => {
  "use strict";

  const byId = (id) => document.getElementById(id);
  const storagePrefix = "ck-tv-settings:";
  const slideKeys = ["overview", "market", "dam", "production", "consumption"];

  function userKey() {
    return String(window.__ckTvUserKey || "local").toLowerCase();
  }

  function storageKey() {
    return `${storagePrefix}${userKey()}`;
  }

  function normalize(raw) {
    const selected = Array.isArray(raw && raw.slides)
      ? raw.slides.filter((key) => slideKeys.indexOf(key) !== -1)
      : [];
    const slides = selected.length ? [...new Set(selected)] : [...slideKeys];
    const fixedSlide = slides.indexOf(raw && raw.fixedSlide) !== -1
      ? raw.fixedSlide
      : slides[0];
    return {
      mode: raw && raw.mode === "fixed" ? "fixed" : "rotate",
      slides,
      fixedSlide,
    };
  }

  function readSettings() {
    try {
      return normalize(JSON.parse(localStorage.getItem(storageKey()) || "null"));
    } catch {
      return normalize(null);
    }
  }

  function writeSettings(settings) {
    const normalized = normalize(settings);
    try {
      localStorage.setItem(storageKey(), JSON.stringify(normalized));
    } catch {
      // Depolama kapalıysa yine de aynı sayfa oturumunda uygula.
    }
    window.__ckTvSettings = normalized;
    window.dispatchEvent(new CustomEvent("ck-tv-settings-change", {
      detail: normalized,
    }));
    return normalized;
  }

  function fillForm(settings) {
    document.querySelectorAll('input[name="tvSlide"]').forEach((input) => {
      input.checked = settings.slides.includes(input.value);
    });
    document.querySelectorAll('input[name="tvMode"]').forEach((input) => {
      input.checked = input.value === settings.mode;
    });
    if (byId("tvFixedSlide")) byId("tvFixedSlide").value = settings.fixedSlide;
    if (byId("tvSettingsUser")) {
      byId("tvSettingsUser").textContent = `Bu tercih ${userKey()} kullanıcısı için saklanır.`;
    }
  }

  function readForm() {
    const selectedSlides = Array.from(
      document.querySelectorAll('input[name="tvSlide"]:checked'),
    ).map((input) => input.value);
    const checkedMode = document.querySelector('input[name="tvMode"]:checked');
    const mode = checkedMode ? checkedMode.value : "rotate";
    return normalize({
      mode,
      slides: selectedSlides,
      fixedSlide: (byId("tvFixedSlide") && byId("tvFixedSlide").value) || selectedSlides[0],
    });
  }

  function openPanel() {
    const panel = byId("tvSettingsPanel");
    const button = byId("tvSettings");
    if (!panel) return;
    fillForm(readSettings());
    panel.classList.add("open");
    panel.setAttribute("aria-hidden", "false");
    if (button) button.setAttribute("aria-expanded", "true");
  }

  function closePanel() {
    const panel = byId("tvSettingsPanel");
    const button = byId("tvSettings");
    if (!panel) return;
    panel.classList.remove("open");
    panel.setAttribute("aria-hidden", "true");
    if (button) button.setAttribute("aria-expanded", "false");
  }

  function bindSettingsPanel() {
    const button = byId("tvSettings");
    const panel = byId("tvSettingsPanel");
    if (button) button.addEventListener("click", (event) => {
      event.preventDefault();
      if (panel && panel.classList.contains("open")) closePanel();
      else openPanel();
    });
    if (byId("tvSettingsClose")) byId("tvSettingsClose").addEventListener("click", closePanel);
    if (byId("tvSettingsSave")) byId("tvSettingsSave").addEventListener("click", () => {
      writeSettings(readForm());
      closePanel();
    });
    if (byId("tvSettingsReset")) byId("tvSettingsReset").addEventListener("click", () => {
      const defaults = writeSettings({ mode: "rotate", slides: slideKeys, fixedSlide: "overview" });
      fillForm(defaults);
    });
    if (panel) panel.addEventListener("click", (event) => {
      if (event.target === panel) closePanel();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closePanel();
    });
    window.__ckTvSettings = readSettings();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindSettingsPanel);
  } else {
    bindSettingsPanel();
  }
})();
