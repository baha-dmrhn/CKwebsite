(() => {
  "use strict";
  const byId = (id) => document.getElementById(id);
  const storagePrefix = "ck-tv-preferences:";
  const slideKeys = ["overview", "market", "dam", "production", "consumption"];
  const defaultProfile = "Varsayılan";

  const userKey = () => String(window.__ckTvUserKey || "local").toLowerCase();
  const userLabel = () => String(window.__ckTvUserLabel || "yerel").trim() || "yerel";
  const storageKey = () => `${storagePrefix}${userKey()}`;
  const normalize = (raw) => {
    const slides = [...new Set(Array.isArray(raw?.slides) ? raw.slides.filter((key) => slideKeys.includes(key)) : [])];
    const selected = slides.length ? slides : [...slideKeys];
    return { mode: raw?.mode === "fixed" ? "fixed" : "rotate", slides: selected, fixedSlide: selected.includes(raw?.fixedSlide) ? raw.fixedSlide : selected[0] };
  };
  const normalizeName = (value) => String(value || "").trim().replace(/\s+/g, " ").slice(0, 40) || defaultProfile;
  function normalizePreferences(raw) {
    const profiles = {};
    if (raw && typeof raw.profiles === "object") Object.entries(raw.profiles).slice(0, 12).forEach(([name, settings]) => {
      const clean = normalizeName(name); if (!profiles[clean]) profiles[clean] = normalize(settings);
    });
    if (!Object.keys(profiles).length) profiles[defaultProfile] = normalize(raw);
    const activeProfile = profiles[normalizeName(raw?.activeProfile)] ? normalizeName(raw.activeProfile) : Object.keys(profiles)[0];
    return { activeProfile, profiles };
  }
  function readPreferences() { try { return normalizePreferences(JSON.parse(localStorage.getItem(storageKey()) || "null")); } catch { return normalizePreferences(null); } }
  function activeSettings(preferences) {
    const normalized = normalizePreferences(preferences);
    return normalized.profiles[normalized.activeProfile] || normalize(null);
  }
  function apply(preferences) {
    const normalized = normalizePreferences(preferences);
    try { localStorage.setItem(storageKey(), JSON.stringify(normalized)); } catch { /* local fallback */ }
    window.__ckTvPreferences = normalized;
    window.__ckTvSettings = activeSettings(normalized);
    window.dispatchEvent(new CustomEvent("ck-tv-settings-change", { detail: window.__ckTvSettings }));
    return normalized;
  }
  async function readServerPreferences() {
    const response = await fetch("/api/tv-settings", { credentials: "include" });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 401) return readPreferences();
    if (!response.ok) throw new Error(payload.error || "TV tercihleri okunamadı.");
    if (payload.userKey) window.__ckTvUserKey = payload.userKey;
    return apply(payload.preferences || { ["profiles"]: { [defaultProfile]: payload.settings }, activeProfile: defaultProfile });
  }
  async function saveServerPreferences(preferences) {
    const normalized = apply(preferences);
    const response = await fetch("/api/tv-settings", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ preferences: normalized }) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "TV tercihleri kaydedilemedi.");
    if (payload.userKey) window.__ckTvUserKey = payload.userKey;
    return apply(payload.preferences || normalized);
  }
  function currentPreferences() {
    const preferences = normalizePreferences(window.__ckTvPreferences || readPreferences());
    if (!preferences.profiles[preferences.activeProfile]) return normalizePreferences(null);
    return preferences;
  }
  function fillForm(preferences = currentPreferences()) {
    const settings = activeSettings(preferences);
    const profileSelect = byId("tvProfile");
    if (profileSelect) { profileSelect.innerHTML = Object.keys(preferences.profiles).map((name) => `<option value="${name.replace(/[&<>\"]/g, "")}">${name}</option>`).join(""); profileSelect.value = preferences.activeProfile; }
    document.querySelectorAll('input[name="tvSlide"]').forEach((input) => { input.checked = settings.slides.includes(input.value); });
    document.querySelectorAll('input[name="tvMode"]').forEach((input) => { input.checked = input.value === settings.mode; });
    if (byId("tvFixedSlide")) byId("tvFixedSlide").value = settings.fixedSlide;
    if (byId("tvSettingsUser")) byId("tvSettingsUser").textContent = `Tercihler ${userLabel()} kullanıcısı için saklanır.`;
  }
  function formSettings() {
    const slides = [...document.querySelectorAll('input[name="tvSlide"]:checked')].map((input) => input.value);
    return normalize({ mode: document.querySelector('input[name="tvMode"]:checked')?.value, slides, fixedSlide: byId("tvFixedSlide")?.value || slides[0] });
  }
  function formPreferences() {
    const preferences = normalizePreferences(currentPreferences());
    const profileName = preferences.activeProfile || defaultProfile;
    if (!preferences.profiles[profileName]) preferences.profiles[profileName] = normalize(null);
    preferences.activeProfile = profileName;
    preferences.profiles[profileName] = formSettings();
    return preferences;
  }
  function openPanel() { const panel = byId("tvSettingsPanel"); if (!panel) return; byId("tvLoading")?.classList.add("hidden"); byId("tvSettingsToggle").checked = true; fillForm(); panel.classList.add("open"); panel.setAttribute("aria-hidden", "false"); byId("tvSettings")?.setAttribute("aria-expanded", "true"); }
  function closePanel() { const panel = byId("tvSettingsPanel"); if (!panel) return; byId("tvSettingsToggle").checked = false; panel.classList.remove("open"); panel.setAttribute("aria-hidden", "true"); byId("tvSettings")?.setAttribute("aria-expanded", "false"); }
  async function persist(preferences) { try { return await saveServerPreferences(preferences); } catch (error) { if (byId("tvSettingsUser")) byId("tvSettingsUser").textContent = `${error.message || "Sunucuya ulaşılamadı."} Bu cihazdaki yedek uygulandı.`; return apply(preferences); } }
  function setStatus(message, state = "") { const status = byId("tvSettingsStatus"); if (!status) return; status.textContent = message; status.dataset.state = state; }
  async function saveAndApply() {
    const button = byId("tvSettingsSave");
    if (!button || button.disabled) return;
    button.disabled = true;
    button.textContent = "Kaydediliyor…";
    setStatus("Tercihler uygulanıyor…", "pending");
    try {
      const saved = await persist(formPreferences());
      fillForm(saved);
      setStatus("Kaydedildi ve uygulandı.", "success");
      window.setTimeout(closePanel, 220);
    } catch (error) {
      setStatus(error.message || "Tercihler uygulanamadı.", "error");
    } finally {
      button.disabled = false;
      button.textContent = "Kaydet ve uygula";
    }
  }
  function bindSettingsPanel() {
    byId("tvSettings")?.addEventListener("click", (event) => { event.preventDefault(); if (event.currentTarget.getAttribute("aria-disabled") === "true") return; byId("tvSettingsPanel")?.classList.contains("open") ? closePanel() : openPanel(); });
    byId("tvSettingsClose")?.addEventListener("click", closePanel);
    byId("tvProfile")?.addEventListener("change", async (event) => { const preferences = formPreferences(); preferences.activeProfile = event.target.value; fillForm(await persist(preferences)); });
    byId("tvProfileNew")?.addEventListener("click", async () => {
      const input = byId("tvProfileName");
      const typedName = String(input?.value || "").trim();
      if (!typedName) { setStatus("Yeni profil için bir ad yazın.", "error"); input?.focus(); return; }
      const name = normalizeName(typedName);
      const preferences = formPreferences();
      if (!preferences.profiles[name]) preferences.profiles[name] = normalize(formSettings());
      preferences.activeProfile = name;
      fillForm(await persist(preferences));
      if (input) input.value = "";
      setStatus(`“${name}” profili açıldı.`, "success");
    });
    byId("tvProfileDelete")?.addEventListener("click", async () => { const preferences = formPreferences(); if (Object.keys(preferences.profiles).length <= 1) return; delete preferences.profiles[preferences.activeProfile]; preferences.activeProfile = Object.keys(preferences.profiles)[0]; fillForm(await persist(preferences)); });
    byId("tvSettingsSave")?.addEventListener("click", saveAndApply);
    byId("tvSettingsReset")?.addEventListener("click", async () => { const preferences = currentPreferences(); preferences.profiles[preferences.activeProfile] = normalize(null); fillForm(await persist(preferences)); });
    byId("tvSettingsPanel")?.addEventListener("click", (event) => { if (event.target === byId("tvSettingsPanel")) closePanel(); });
    document.addEventListener("keydown", (event) => { if (event.key === "Escape") closePanel(); });
    apply(readPreferences());
  }
  window.__ckTvReloadSettings = async () => { apply(readPreferences()); try { await readServerPreferences(); } catch { apply(readPreferences()); } };
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", bindSettingsPanel) : bindSettingsPanel();
})();
